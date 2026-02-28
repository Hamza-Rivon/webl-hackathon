/**
 * B-Roll Ingest Job (Phase 2.1)
 *
 * Uploads original B-roll clip to Mux and waits for it to be ready.
 * This is the entry point for Phase 2: B-Roll Chunk Processing.
 *
 * Flow:
 * 1. Get S3 signed URL for the B-roll clip
 * 2. Create Mux asset from the URL
 * 3. Wait for asset to be ready
 * 4. Update SlotClip with Mux asset info (ID, playback ID, duration, dimensions)
 * 5. Trigger broll_chunking job
 *
 * Dependencies: None (can run in parallel for multiple clips)
 * Next Job: broll_chunking
 */

import { Job } from 'bullmq';
import { prisma } from '../services/db.js';
import { s3Service } from '../services/s3.js';
import { muxService } from '../services/mux.js';
import { progressPublisher } from '../services/progress.js';
import { usageService } from '../services/usage.js';
import { queues } from '../queue.js';
import { logger } from '@webl/shared';

// ==================== TYPES ====================

interface BrollIngestJobData {
  jobId: string;
  episodeId: string;
  userId: string;
  slotClipId: string;
  s3Key: string;
}

type SlotRequirementsJson = {
  workflow?: string;
  slots?: Array<{ slotType?: string; priority?: string }>;
} | null;

// ==================== JOB PROCESSOR ====================

export async function processBrollIngest(bullJob: Job<BrollIngestJobData>): Promise<void> {
  const { jobId, episodeId, userId, slotClipId, s3Key } = bullJob.data;

  logger.info(`Starting B-roll ingest job ${jobId} for slot clip ${slotClipId}`, {
    episodeId,
    s3Key,
  });

  // Check if this is an A-roll slot (needs transcription)
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

  try {
    // Usage guard: check hard limits before external API calls
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
      'Starting B-roll ingest'
    );

    // Step 1: Get signed URL for S3 file (10%)
    await updateProgress(jobId, 'downloading', 10, 'Generating S3 signed URL');

    const signedUrl = await s3Service.getSignedDownloadUrl(s3Key, 7200); // 2 hour expiry
    logger.debug(`Generated signed URL for B-roll ${s3Key}`);

    // Step 2: Create Mux asset (20%)
    await updateProgress(jobId, 'uploading', 20, 'Creating Mux asset');

    const passthrough = `episode:${episodeId}:broll:${slotClipId}`;

    // Enable transcription for A-roll clips (needed for semantic matching)
    // B-roll clips don't need transcription (no audio)
    const assetInfo = await muxService.createAssetFromUrl({
      inputUrl: signedUrl,
      passthrough,
      generateSubtitles: isARoll, // Enable for A-roll, disable for B-roll
      language: isARoll ? 'en' : undefined,
    });

    logger.info(`Created Mux asset ${assetInfo.id} for B-roll clip ${slotClipId}`, {
      episodeId,
    });

    // Step 3: Wait for asset to be ready (20-80%)
    await updateProgress(jobId, 'processing', 30, 'Waiting for Mux to process asset');

    const readyAsset = await muxService.waitForAssetReady(assetInfo.id, 120, 3000);
    const playbackId = readyAsset.playbackIds?.[0]?.id ?? null;

    if (!playbackId) {
      throw new Error(`No playback ID available for asset ${assetInfo.id}`);
    }

    logger.info(`Mux asset ${assetInfo.id} is ready with playback ID ${playbackId}`);

    // Step 4: Extract video metadata (80%)
    await updateProgress(jobId, 'analyzing', 80, 'Extracting video metadata');

    const videoTrack = readyAsset.tracks?.find((t) => t.type === 'video');

    // Determine orientation from dimensions
    const orientation = determineOrientation(videoTrack?.maxWidth, videoTrack?.maxHeight);

    // Step 5: Update SlotClip with Mux info (90%)
    await updateProgress(jobId, 'processing', 90, 'Updating slot clip');

    await prisma.slotClip.update({
      where: { id: slotClipId },
      data: {
        muxAssetId: assetInfo.id,
        muxPlaybackId: playbackId,
        duration: readyAsset.duration,
        width: videoTrack?.maxWidth,
        height: videoTrack?.maxHeight,
        orientation,
      },
    });

    logger.info(`Updated slot clip ${slotClipId} with Mux asset ${assetInfo.id}`);

    // Step 6: Complete job (100%)
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: 'done',
        stage: 'done',
        progress: 100,
        outputData: {
          muxAssetId: assetInfo.id,
          muxPlaybackId: playbackId,
          duration: readyAsset.duration,
        },
      },
    });

    await progressPublisher.publish(jobId, 'done', 'done', 100, 'B-roll ingest complete');

    if (isARoll && isArollFirst) {
      logger.info(
        `Skipping A-roll enrichment/chunking for slot clip ${slotClipId} in A-roll-first workflow`
      );
      return;
    }

    // Phase 2.3: Trigger slot_clip_enrichment job (NEW)
    const enrichmentJob = await prisma.job.create({
      data: {
        type: 'slot_clip_enrichment',
        status: 'pending',
        episodeId,
        userId,
        inputData: {
          slotClipId,
          muxAssetId: assetInfo.id,
        },
      },
    });

    await queues.slotClipEnrichment.add('slot-clip-enrichment', {
      jobId: enrichmentJob.id,
      episodeId,
      userId,
      slotClipId,
      muxAssetId: assetInfo.id,
    });

    logger.info(`Queued slot_clip_enrichment job ${enrichmentJob.id}`);

    // Step 7: Trigger broll_chunking job (can run in parallel with enrichment)
    const chunkingJob = await prisma.job.create({
      data: {
        type: 'broll_chunking',
        status: 'pending',
        episodeId,
        userId,
        inputData: {
          slotClipId,
          muxAssetId: assetInfo.id,
          duration: readyAsset.duration,
        },
      },
    });

    await queues.brollChunking.add('broll-chunking', {
      jobId: chunkingJob.id,
      episodeId,
      userId,
      slotClipId,
      muxAssetId: assetInfo.id,
      duration: readyAsset.duration ?? 0,
    });

    logger.info(
      `Queued broll_chunking job ${chunkingJob.id} for slot clip ${slotClipId}`
    );

    logger.info(`B-roll ingest job ${jobId} completed successfully`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`B-roll ingest job ${jobId} failed:`, error);

    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: 'error',
        errorMessage,
      },
    });

    await progressPublisher.publish(jobId, 'error', 'processing', 0, errorMessage);

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

function determineOrientation(
  width?: number,
  height?: number
): 'portrait' | 'landscape' | 'square' | undefined {
  if (!width || !height) return undefined;

  const ratio = width / height;
  if (ratio > 1.1) return 'landscape';
  if (ratio < 0.9) return 'portrait';
  return 'square';
}
