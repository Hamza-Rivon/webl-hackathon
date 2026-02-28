/**
 * Slot Clip Enrichment Job (Phase 2.2)
 * 
 * Analyzes entire slot clip once with Mux AI, then chunks inherit the data.
 * This reduces Mux AI calls from 58 per episode to ~6-8 per episode.
 */

import { Job } from 'bullmq';
import { prisma } from '../services/db.js';
import { progressPublisher } from '../services/progress.js';
import { queues } from '../queue.js';
import { logger } from '@webl/shared';
import { usageService } from '../services/usage.js';
import { workflows } from '@mux/ai';

interface SlotClipEnrichmentJobData {
  jobId: string;
  episodeId: string;
  userId: string;
  slotClipId: string;
  muxAssetId: string;
}

type SlotRequirementsJson = {
  workflow?: string;
  slots?: Array<{ slotType?: string; priority?: string }>;
} | null;

const MODERATION_THRESHOLDS = {
  sexual: 0.7,
  violence: 0.8,
  hate: 0.7,
  harassment: 0.7,
  selfHarm: 0.8,
};

export async function processSlotClipEnrichment(
  bullJob: Job<SlotClipEnrichmentJobData>
): Promise<void> {
  const { jobId, episodeId, userId, slotClipId, muxAssetId } = bullJob.data;

  logger.info(`Starting slot clip enrichment job ${jobId}`, {
    episodeId,
    slotClipId,
    muxAssetId,
  });

  try {
    // Usage guard: check hard limits before Mux AI calls
    const usageCheck = await usageService.checkCanProceed(userId);
    if (!usageCheck.allowed) {
      await prisma.job.update({ where: { id: jobId }, data: { status: 'error', errorMessage: `Usage limit exceeded: ${usageCheck.reason}` } });
      throw new Error(`Usage limit exceeded: ${usageCheck.reason}`);
    }

    await prisma.job.update({
      where: { id: jobId },
      data: { status: 'processing', stage: 'starting', progress: 0 },
    });

    await progressPublisher.publish(jobId, 'processing', 'starting', 0, 'Starting slot clip AI enrichment');

    // Step 1: Get slot clip info
    const slotClip = await prisma.slotClip.findUnique({
      where: { id: slotClipId },
      select: {
        slotType: true,
        episode: {
          select: {
            template: {
              select: {
                slotRequirements: true,
              },
            },
          },
        },
      },
    });

    const isARoll = slotClip?.slotType === 'a_roll_face';
    const isArollFirst =
      isArollFirstTemplate((slotClip?.episode?.template?.slotRequirements ?? null) as SlotRequirementsJson);

    if (isARoll && isArollFirst) {
      logger.info(
        `Skipping slot clip enrichment for A-roll slot ${slotClipId} in A-roll-first workflow`
      );
      await prisma.job.update({
        where: { id: jobId },
        data: { status: 'done', stage: 'done', progress: 100 },
      });
      await progressPublisher.publish(
        jobId,
        'done',
        'done',
        100,
        'Skipped enrichment for A-roll-first workflow'
      );
      return;
    }

    // Step 2: Get AI summary and tags (10-50%)
    await updateProgress(jobId, 'analyzing', 10, 'Analyzing slot clip with @mux/ai');

    await usageService.recordUsage(userId, {
      muxAiSummaryCalls: 1,
    });
    const aiResult = await workflows.getSummaryAndTags(muxAssetId, {
      provider: 'openai',
      tone: 'neutral',
      includeTranscript: isARoll, // ✅ Include transcript for A-roll slots (Mux auto-generates subtitles)
    });

    logger.info(`Received AI analysis for slot clip:`, {
      tags: aiResult.tags,
      description: aiResult.description,
    });

    await updateProgress(jobId, 'analyzing', 50, 'AI analysis complete');

    // Step 3: Get moderation scores (50-80%)
    await updateProgress(jobId, 'analyzing', 50, 'Running content moderation');

    await usageService.recordUsage(userId, {
      muxAiModerationCalls: 1,
    });
    const moderationResult = await workflows.getModerationScores(muxAssetId, {
      provider: 'openai',
    });

    logger.info(`Received moderation scores:`, {
      maxScores: moderationResult.maxScores,
      exceedsThreshold: moderationResult.exceedsThreshold,
    });

    await updateProgress(jobId, 'analyzing', 80, 'Moderation complete');

    // Step 4: Determine moderation status
    let moderationStatus = 'safe';
    const maxScores = moderationResult.maxScores;

    if (
      moderationResult.exceedsThreshold ||
      maxScores.violence > MODERATION_THRESHOLDS.violence ||
      maxScores.sexual > MODERATION_THRESHOLDS.sexual
    ) {
      moderationStatus = 'review';
      logger.warn(`Slot clip ${slotClipId} flagged for review`, { maxScores });
    }

    // Step 5: Update SlotClip with AI data (90%)
    await updateProgress(jobId, 'processing', 90, 'Updating slot clip with AI data');

    await prisma.slotClip.update({
      where: { id: slotClipId },
      data: {
        aiTags: aiResult.tags,
        aiSummary: aiResult.description,
        moderationStatus,
      },
    });

    logger.info(`Updated slot clip ${slotClipId} with AI data`);

    // Step 6: Complete job (100%)
    await prisma.job.update({
      where: { id: jobId },
      data: { status: 'done', stage: 'done', progress: 100 },
    });

    await progressPublisher.publish(jobId, 'done', 'done', 100, 'Slot clip enrichment complete');

    // Step 7: Trigger chunk enrichment jobs (chunks inherit from parent)
    await triggerChunkEnrichmentJobs(episodeId, userId, slotClipId);

    logger.info(`Slot clip enrichment job ${jobId} completed successfully`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`Slot clip enrichment job ${jobId} failed:`, error);

    await prisma.job.update({
      where: { id: jobId },
      data: { status: 'error', errorMessage },
    });

    await progressPublisher.publish(jobId, 'error', 'analyzing', 0, errorMessage);
    throw error;
  }
}

function isArollFirstTemplate(slotRequirements: SlotRequirementsJson): boolean {
  if (slotRequirements?.workflow === 'aroll_clean_then_broll') return true;
  const slots = slotRequirements?.slots;
  if (!Array.isArray(slots) || slots.length === 0) return false;
  const requiredSlots = slots.filter((slot) => slot.priority === 'required');
  if (requiredSlots.length === 0) return false;
  return requiredSlots[0]?.slotType === 'a_roll_face';
}

async function triggerChunkEnrichmentJobs(
  episodeId: string,
  userId: string,
  slotClipId: string
): Promise<void> {
  // Get all chunks for this slot clip, including Mux asset info
  const chunks = await prisma.brollChunk.findMany({
    where: { slotClipId },
    select: { 
      id: true, 
      chunkIndex: true,
      muxAssetId: true,
      muxPlaybackId: true,
    },
    orderBy: { chunkIndex: 'asc' },
  });

  // Get all existing pending/processing chunk enrichment jobs for this episode to avoid duplicates
  const existingJobs = await prisma.job.findMany({
    where: {
      type: 'broll_chunk_enrichment',
      episodeId,
      status: { in: ['pending', 'processing'] },
    },
    select: {
      id: true,
      inputData: true,
    },
  });

  // Create a set of chunk IDs that already have enrichment jobs
  const chunksWithExistingJobs = new Set(
    existingJobs
      .map((job: { id: string; inputData: unknown }) => (job.inputData as any)?.chunkId)
      .filter((id: unknown): id is string => typeof id === 'string')
  );

  // Create enrichment jobs for each chunk
  for (const chunk of chunks) {
    // Check if chunk already has a pending or processing enrichment job
    // (to avoid duplicates if brollChunkIngest already queued one)
    if (chunksWithExistingJobs.has(chunk.id)) {
      logger.info(
        `Skipping chunk enrichment job for chunk ${chunk.chunkIndex} - job already exists`
      );
      continue;
    }

    const enrichmentJob = await prisma.job.create({
      data: {
        type: 'broll_chunk_enrichment',
        status: 'pending',
        episodeId,
        userId,
        inputData: {
          slotClipId,
          chunkId: chunk.id,
          chunkIndex: chunk.chunkIndex,
          ...(chunk.muxAssetId && chunk.muxPlaybackId
            ? { muxAssetId: chunk.muxAssetId, muxPlaybackId: chunk.muxPlaybackId }
            : {}),
        },
        batchId: slotClipId,
        batchIndex: chunk.chunkIndex,
      },
    });

    // If chunk has Mux asset ready, use refinement mode for full chunk-level analysis
    // Otherwise use initial mode to inherit from slot clip
    const enrichmentMode = chunk.muxAssetId && chunk.muxPlaybackId ? 'refinement' : 'initial';

    await queues.brollChunkEnrichment.add('broll-chunk-enrichment', {
      jobId: enrichmentJob.id,
      episodeId,
      userId,
      slotClipId,
      chunkId: chunk.id,
      chunkIndex: chunk.chunkIndex,
      ...(chunk.muxAssetId && chunk.muxPlaybackId
        ? { 
            muxAssetId: chunk.muxAssetId, 
            muxPlaybackId: chunk.muxPlaybackId,
            enrichmentMode: 'refinement',
          }
        : {
            enrichmentMode: 'initial',
          }),
    });

    logger.info(
      `Queued chunk enrichment job ${enrichmentJob.id} for chunk ${chunk.chunkIndex} (${enrichmentMode} mode)`
    );
  }

  logger.info(`Triggered ${chunks.length} chunk enrichment jobs for slot clip ${slotClipId}`);
}

async function updateProgress(
  jobId: string,
  stage: 'starting' | 'processing' | 'analyzing' | 'done',
  progress: number,
  message: string
): Promise<void> {
  await prisma.job.update({ where: { id: jobId }, data: { stage, progress } });
  await progressPublisher.publish(jobId, 'processing', stage, progress, message);
}
