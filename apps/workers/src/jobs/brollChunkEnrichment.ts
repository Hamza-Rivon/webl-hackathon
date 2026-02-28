/**
 * B-Roll Chunk Enrichment Job (Phase 2.4)
 *
 * Uses @mux/ai to analyze each chunk and extract:
 * - AI tags (descriptive keywords)
 * - AI summary (brief description)
 * - Moderation scores (safety check)
 *
 * This is the KEY job that leverages Mux AI capabilities to understand
 * the visual content of each chunk for semantic matching later.
 *
 * Flow:
 * 1. Use @mux/ai workflows.getSummaryAndTags() for AI analysis
 * 2. Use @mux/ai workflows.getModerationScores() for content safety
 * 3. Update BrollChunk with AI data and moderation status
 * 4. Trigger broll_chunk_embedding job
 *
 * Dependencies: broll_chunk_ingest
 * Next Job: broll_chunk_embedding
 */

import { Job } from 'bullmq';
import { prisma } from '../services/db.js';
import { progressPublisher } from '../services/progress.js';
import { queues } from '../queue.js';
import { logger } from '@webl/shared';
import { config } from '../config.js';
import { usageService } from '../services/usage.js';
import { s3Service } from '../services/s3.js';
import { analyzeVideoWithRunpod } from '../services/runpodVideoAnalysis.js';

// Import @mux/ai workflows
import { workflows } from '@mux/ai';

// ==================== TYPES ====================

interface BrollChunkEnrichmentJobData {
  jobId: string;
  episodeId: string;
  userId: string;
  slotClipId: string;
  chunkId: string;
  chunkIndex: number;
  muxAssetId?: string;
  muxPlaybackId?: string;
  enrichmentMode?: 'initial' | 'refinement'; // Default: 'initial'
}

// Moderation thresholds (can be adjusted)
const MODERATION_THRESHOLDS = {
  sexual: 0.7,
  violence: 0.8,
  hate: 0.7,
  harassment: 0.7,
  selfHarm: 0.8,
};

function exceedsModerationThreshold(maxScores: {
  sexual?: number;
  violence?: number;
  hate?: number;
  harassment?: number;
  selfHarm?: number;
}): boolean {
  return (
    (maxScores.violence ?? 0) > MODERATION_THRESHOLDS.violence ||
    (maxScores.sexual ?? 0) > MODERATION_THRESHOLDS.sexual ||
    (maxScores.hate ?? 0) > MODERATION_THRESHOLDS.hate ||
    (maxScores.harassment ?? 0) > MODERATION_THRESHOLDS.harassment ||
    (maxScores.selfHarm ?? 0) > MODERATION_THRESHOLDS.selfHarm
  );
}

// ==================== JOB PROCESSOR ====================

export async function processBrollChunkEnrichment(
  bullJob: Job<BrollChunkEnrichmentJobData>
): Promise<void> {
  const { jobId, episodeId, userId, slotClipId, chunkId, chunkIndex, muxAssetId, enrichmentMode } =
    bullJob.data;

  logger.info(`Starting chunk enrichment job ${jobId} for chunk ${chunkIndex}`, {
    episodeId,
    slotClipId,
    chunkId,
    muxAssetId,
  });

  try {
    // Usage guard: check hard limits before Mux AI calls
    const usageCheck = await usageService.checkCanProceed(userId);
    if (!usageCheck.allowed) {
      await prisma.job.update({ where: { id: jobId }, data: { status: 'error', errorMessage: `Usage limit exceeded: ${usageCheck.reason}` } });
      throw new Error(`Usage limit exceeded: ${usageCheck.reason}`);
    }

    // Update job status to processing
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: 'processing',
        stage: 'starting',
        progress: 0,
      },
    });

    await progressPublisher.publish(
      jobId,
      'processing',
      'starting',
      0,
      `Starting chunk ${chunkIndex} AI enrichment (mode: ${enrichmentMode || 'initial'})`
    );

    const mode = enrichmentMode || 'initial';

    if (mode === 'initial') {
      // Phase 2.3: Initial enrichment - inherit from slot clip (no Mux AI call)
      await updateProgress(jobId, 'processing', 10, 'Inheriting AI data from slot clip');

      const slotClip = await prisma.slotClip.findUnique({
        where: { id: slotClipId },
        select: {
          aiTags: true,
          aiSummary: true,
          moderationStatus: true,
          duration: true,
          chunkCount: true,
        },
      });

      if (!slotClip?.aiTags || slotClip.aiTags.length === 0) {
        throw new Error(`Slot clip ${slotClipId} has not been enriched yet. Run slot_clip_enrichment first.`);
      }

      // Calculate position context
      const totalChunks = slotClip.chunkCount || 1;
      const chunkPosition = chunkIndex / totalChunks;
      const positionLabel = chunkPosition < 0.33 ? 'beginning' : chunkPosition < 0.66 ? 'middle' : 'end';

      // Inherit + add position context
      const chunkTags = [
        ...slotClip.aiTags,
        `${positionLabel} of clip`,
        `chunk ${chunkIndex + 1} of ${totalChunks}`,
      ];

      const chunkSummary = `${positionLabel.charAt(0).toUpperCase() + positionLabel.slice(1)} section: ${slotClip.aiSummary}`;

      // Get current chunk to preserve metadata
      const chunk = await prisma.brollChunk.findUnique({
        where: { id: chunkId },
      });
      const chunkMetadata = ((chunk as any)?.metadata as Record<string, any>) || {};

      await prisma.brollChunk.update({
        where: { id: chunkId },
        data: {
          aiTags: chunkTags,
          aiSummary: chunkSummary,
          moderationStatus: slotClip.moderationStatus,
          metadata: chunkMetadata, // Preserve existing metadata
        } as any,
      });

      logger.info(`Chunk ${chunkIndex} inherited AI data from slot clip with position context`);
    } else {
      // Phase 2.4: Refinement mode - full chunk-level analysis (Mux AI or Runpod Qwen3-VL)
      const useRunpod = config.ai.provider === 'runpod';
      if (!useRunpod && !muxAssetId) {
        throw new Error(`muxAssetId required for refinement mode when not using Runpod`);
      }

      // Step 1: Get AI summary and tags (10-50%)
      await updateProgress(
        jobId,
        'analyzing',
        10,
        useRunpod
          ? 'Analyzing chunk with Runpod Qwen3-VL (tags & summary)'
          : 'Analyzing chunk with @mux/ai (tags & summary)'
      );

      // Check if this is an A-roll chunk (has audio/transcript)
      const slotClip = await prisma.slotClip.findUnique({
        where: { id: slotClipId },
        select: { slotType: true },
      });

      const isARollChunk = slotClip?.slotType === 'a_roll_face';

      // Get chunk transcript if available (for A-roll chunks)
      const chunk = await prisma.brollChunk.findUnique({
        where: { id: chunkId },
        select: {
          s3Key: true,
          metadata: true,
        },
      });

      const chunkMetadata = ((chunk as any)?.metadata as { transcript?: string; words?: any[] }) || null;
      const transcript = chunkMetadata?.transcript || null;
      let aiResult: { tags: string[]; description: string };
      let moderationResult: {
        maxScores: {
          sexual: number;
          violence: number;
          hate?: number;
          harassment?: number;
          selfHarm?: number;
        };
        exceedsThreshold: boolean;
      };

      if (useRunpod) {
        if (!chunk?.s3Key) {
          throw new Error(`Chunk ${chunkId} is missing s3Key for Runpod analysis`);
        }

        const signedUrl = await s3Service.getSignedDownloadUrl(chunk.s3Key, 7200);
        logger.info('[Runpod][chunk-enrichment] request', {
          model: config.vllm.model,
          endpointHost: (() => {
            try {
              return new URL(config.vllm.baseUrl).host;
            } catch {
              return config.vllm.baseUrl || null;
            }
          })(),
          chunkId,
          chunkIndex,
          isARollChunk,
        });
        await usageService.recordUsage(userId, {
          openAiChatCalls: 1,
        });

        const runpodResult = await analyzeVideoWithRunpod({
          videoUrl: signedUrl,
          transcript: isARollChunk && transcript ? transcript : null,
        });

        aiResult = {
          tags: runpodResult.tags,
          description: runpodResult.description,
        };
        moderationResult = {
          maxScores: runpodResult.moderationScores,
          exceedsThreshold: exceedsModerationThreshold(runpodResult.moderationScores),
        };
      } else {
        logger.info(`Calling @mux/ai getSummaryAndTags for asset ${muxAssetId} (refinement mode)`);

        await usageService.recordUsage(userId, {
          muxAiSummaryCalls: 1,
        });
        const summaryResult = await workflows.getSummaryAndTags(muxAssetId!, {
          provider: 'openai',
          tone: 'neutral',
          includeTranscript: isARollChunk && transcript ? true : false,
        });

        await usageService.recordUsage(userId, {
          muxAiModerationCalls: 1,
        });
        logger.info(`Calling @mux/ai getModerationScores for asset ${muxAssetId}`);
        const moderation = await workflows.getModerationScores(muxAssetId!, {
          provider: 'openai',
        });

        aiResult = {
          tags: summaryResult.tags,
          description: summaryResult.description,
        };
        moderationResult = {
          maxScores: moderation.maxScores,
          exceedsThreshold: moderation.exceedsThreshold,
        };
      }

      logger.info(`Received AI analysis for chunk ${chunkIndex} (refinement):`, {
        provider: useRunpod ? 'runpod' : 'mux',
        tags: aiResult.tags,
        description: aiResult.description,
      });

      await updateProgress(jobId, 'analyzing', 50, 'AI analysis complete');

      // Step 2: moderation already computed from provider call (50-80%)
      await updateProgress(jobId, 'analyzing', 50, 'Running content moderation');

      logger.info(`Received moderation scores for chunk ${chunkIndex}:`, {
        provider: useRunpod ? 'runpod' : 'mux',
        maxScores: moderationResult.maxScores,
        exceedsThreshold: moderationResult.exceedsThreshold,
      });

      await updateProgress(jobId, 'analyzing', 80, 'Moderation complete');

      // Step 3: Determine moderation status (80%)
      let moderationStatus = 'safe';
      const maxScores = moderationResult.maxScores;

      if (
        moderationResult.exceedsThreshold ||
        exceedsModerationThreshold(maxScores)
      ) {
        moderationStatus = 'review';
        logger.warn(`Chunk ${chunkIndex} flagged for review`, { maxScores });
      }

      // Step 4: Update BrollChunk with AI data (90%)
      await updateProgress(jobId, 'processing', 90, 'Updating chunk with AI data');

      // Update chunk with AI data and preserve transcript metadata
      await prisma.brollChunk.update({
        where: { id: chunkId },
        data: {
          aiTags: aiResult.tags ?? [],
          aiSummary: aiResult.description ?? null,
          moderationStatus,
          moderationScores: maxScores,
          // Preserve transcript metadata if it exists
          metadata: chunkMetadata || {},
        } as any,
      });
    }

    // Get updated chunk data for output
    const updatedChunk = await prisma.brollChunk.findUnique({
      where: { id: chunkId },
      select: {
        aiTags: true,
        aiSummary: true,
        moderationStatus: true,
        moderationScores: true,
      },
    });

    logger.info(`Updated chunk ${chunkIndex} with AI enrichment data (mode: ${mode})`);

    // Step 5: Complete job (100%)
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: 'done',
        stage: 'done',
        progress: 100,
        outputData: {
          enrichmentMode: mode,
          aiTags: updatedChunk?.aiTags || [],
          aiSummary: updatedChunk?.aiSummary || null,
          moderationStatus: updatedChunk?.moderationStatus || 'safe',
          moderationScores: updatedChunk?.moderationScores || null,
        },
      },
    });

    await progressPublisher.publish(
      jobId,
      'done',
      'done',
      100,
      `Chunk ${chunkIndex} enrichment complete`
    );

    // Step 6: Trigger broll_chunk_embedding job (only for initial mode, refinement will re-embed)
    if (mode === 'initial') {
      const embeddingJob = await prisma.job.create({
        data: {
          type: 'broll_chunk_embedding',
          status: 'pending',
          episodeId,
          userId,
          inputData: {
            slotClipId,
            chunkId,
            chunkIndex,
          },
          batchId: slotClipId, // Group by slot clip
          batchIndex: chunkIndex,
        },
      });

      await queues.brollChunkEmbedding.add('broll-chunk-embedding', {
        jobId: embeddingJob.id,
        episodeId,
        userId,
        slotClipId,
        chunkId,
        chunkIndex,
        isRefinement: false,
      });

      logger.info(
        `Queued broll_chunk_embedding job ${embeddingJob.id} for chunk ${chunkIndex}`
      );
    } else {
      // Refinement mode: trigger re-embedding with updated tags
      const embeddingJob = await prisma.job.create({
        data: {
          type: 'broll_chunk_embedding',
          status: 'pending',
          episodeId,
          userId,
          inputData: {
            slotClipId,
            chunkId,
            chunkIndex,
            isRefinement: true,
          },
          batchId: slotClipId,
          batchIndex: chunkIndex,
        },
      });

      await queues.brollChunkEmbedding.add('broll-chunk-embedding', {
        jobId: embeddingJob.id,
        episodeId,
        userId,
        slotClipId,
        chunkId,
        chunkIndex,
        isRefinement: true,
      });

      logger.info(
        `Queued broll_chunk_embedding job ${embeddingJob.id} for chunk ${chunkIndex} (refinement re-embedding)`
      );
    }

    logger.info(`Chunk enrichment job ${jobId} completed successfully`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`Chunk enrichment job ${jobId} failed:`, error);

    // Check if it's a rate limit error
    if (errorMessage.includes('rate limit') || errorMessage.includes('429')) {
      logger.warn(`Rate limit hit for chunk ${chunkIndex}, will retry`);
      // BullMQ will automatically retry based on job options
    }

    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: 'error',
        errorMessage,
      },
    });

    await progressPublisher.publish(jobId, 'error', 'analyzing', 0, errorMessage);

    throw error;
  }
}

// ==================== HELPERS ====================

async function updateProgress(
  jobId: string,
  stage: 'starting' | 'downloading' | 'uploading' | 'processing' | 'analyzing' | 'done',
  progress: number,
  message: string
): Promise<void> {
  await prisma.job.update({
    where: { id: jobId },
    data: { stage, progress },
  });
  await progressPublisher.publish(jobId, 'processing', stage, progress, message);
}
