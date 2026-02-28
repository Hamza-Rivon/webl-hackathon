/**
 * B-Roll Chunk Ingest Job (Phase 2.3)
 *
 * Uploads a single chunk to Mux and waits for it to be ready.
 * This job runs in parallel for multiple chunks (batches of 10).
 *
 * Flow:
 * 1. Get S3 signed URL for the chunk
 * 2. Create Mux asset from the URL
 * 3. Wait for asset to be ready
 * 4. Update BrollChunk with Mux asset info
 * 5. Trigger broll_chunk_enrichment job
 *
 * Dependencies: broll_chunking
 * Next Job: broll_chunk_enrichment
 */

import { Job } from 'bullmq';
import { prisma } from '../services/db.js';
import { s3Service } from '../services/s3.js';
import { muxService } from '../services/mux.js';
import { progressPublisher } from '../services/progress.js';
import { usageService } from '../services/usage.js';
import { queues } from '../queue.js';
import { logger, CHUNK_DURATION_SECONDS } from '@webl/shared';

// ==================== TYPES ====================

interface BrollChunkIngestJobData {
  jobId: string;
  episodeId: string;
  userId: string;
  slotClipId: string;
  chunkId: string;
  chunkIndex: number;
}

// ==================== JOB PROCESSOR ====================

export async function processBrollChunkIngest(
  bullJob: Job<BrollChunkIngestJobData>
): Promise<void> {
  const { jobId, episodeId, userId, slotClipId, chunkId, chunkIndex } = bullJob.data;

  logger.info(`Starting chunk ingest job ${jobId} for chunk ${chunkIndex}`, {
    episodeId,
    slotClipId,
    chunkId,
  });

  // Check if this is an A-roll chunk (needs transcription)
  const slotClip = await prisma.slotClip.findUnique({
    where: { id: slotClipId },
    select: { slotType: true },
  });

  const isARollChunk = slotClip?.slotType === 'a_roll_face';

  try {
    // Usage guard: check hard limits before external API calls
    const usageCheck = await usageService.checkCanProceed(userId);
    if (!usageCheck.allowed) {
      await prisma.job.update({ where: { id: jobId }, data: { status: 'error', errorMessage: `Usage limit exceeded: ${usageCheck.reason}` } });
      throw new Error(`Usage limit exceeded: ${usageCheck.reason}`);
    }

    await prisma.episode.updateMany({
      where: {
        id: episodeId,
        status: {
          in: ['voiceover_cleaned', 'collecting_clips', 'needs_more_clips'],
        },
      },
      data: { status: 'chunking_clips' },
    });

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
      `Starting chunk ${chunkIndex} ingest`
    );

    // Step 1: Get chunk info (10%)
    await updateProgress(jobId, 'downloading', 10, 'Fetching chunk info');

    const chunk = await prisma.brollChunk.findUnique({
      where: { id: chunkId },
      select: { s3Key: true, durationMs: true },
    });

    if (!chunk?.s3Key) {
      throw new Error(`BrollChunk ${chunkId} has no S3 key`);
    }

    // Step 2: Get signed URL for S3 file (20%)
    await updateProgress(jobId, 'downloading', 20, 'Generating S3 signed URL');

    const signedUrl = await s3Service.getSignedDownloadUrl(chunk.s3Key, 7200); // 2 hour expiry
    logger.debug(`Generated signed URL for chunk ${chunkIndex}`);

    // Step 3: Create Mux asset (30%)
    await updateProgress(jobId, 'uploading', 30, 'Creating Mux asset');

    const passthrough = `episode:${episodeId}:chunk:${chunkId}`;

    // Enable transcription for A-roll chunks (needed for exact wording per chunk)
    // B-roll chunks don't need transcription (no audio)
    const assetInfo = await muxService.createAssetFromUrl({
      inputUrl: signedUrl,
      passthrough,
      generateSubtitles: isARollChunk, // Enable for A-roll chunks, disable for B-roll
      language: isARollChunk ? 'en' : undefined,
    });

    logger.info(`Created Mux asset ${assetInfo.id} for chunk ${chunkIndex}`, {
      episodeId,
      chunkId,
    });

    // Step 4: Wait for asset to be ready (30-80%)
    await updateProgress(jobId, 'processing', 40, 'Waiting for Mux to process chunk');

    const readyAsset = await muxService.waitForAssetReady(assetInfo.id, 120, 3000);
    const playbackId = readyAsset.playbackIds?.[0]?.id ?? null;

    if (!playbackId) {
      throw new Error(`No playback ID available for asset ${assetInfo.id}`);
    }

    logger.info(`Mux asset ${assetInfo.id} is ready with playback ID ${playbackId}`);

    // Step 5: Generate thumbnail URL (80%)
    await updateProgress(jobId, 'analyzing', 80, 'Generating thumbnail');

    // Thumbnail at middle of chunk
    const thumbnailUrl = muxService.getThumbnailUrl(playbackId, {
      time: CHUNK_DURATION_SECONDS / 2,
      width: 640,
      format: 'jpg',
    });

    // Step 6: Update BrollChunk with Mux info (90%)
    await updateProgress(jobId, 'processing', 90, 'Updating chunk record');

    await prisma.brollChunk.update({
      where: { id: chunkId },
      data: {
        muxAssetId: assetInfo.id,
        muxPlaybackId: playbackId,
        thumbnailUrl,
      },
    });

    logger.info(`Updated chunk ${chunkIndex} with Mux asset ${assetInfo.id}`);

    // Step 7: Complete job (100%)
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: 'done',
        stage: 'done',
        progress: 100,
        outputData: {
          muxAssetId: assetInfo.id,
          muxPlaybackId: playbackId,
          thumbnailUrl,
        },
      },
    });

    await progressPublisher.publish(
      jobId,
      'done',
      'done',
      100,
      `Chunk ${chunkIndex} ingest complete`
    );

    // Step 8: Trigger broll_chunk_enrichment job (only if slot clip is already enriched)
    // If slot clip is not enriched yet, the chunk enrichment will be queued by slotClipEnrichment
    const slotClipForEnrichment = await prisma.slotClip.findUnique({
      where: { id: slotClipId },
      select: {
        aiTags: true,
        aiSummary: true,
      },
    });

    const isSlotClipEnriched = slotClipForEnrichment?.aiTags && slotClipForEnrichment.aiTags.length > 0;

    if (isSlotClipEnriched) {
      // Slot clip is already enriched, queue chunk enrichment in refinement mode
      // This will do full chunk-level Mux AI analysis since we have the Mux asset ready
      const enrichmentJob = await prisma.job.create({
        data: {
          type: 'broll_chunk_enrichment',
          status: 'pending',
          episodeId,
          userId,
          inputData: {
            slotClipId,
            chunkId,
            chunkIndex,
            muxAssetId: assetInfo.id,
            muxPlaybackId: playbackId,
          },
          batchId: slotClipId, // Group by slot clip
          batchIndex: chunkIndex,
        },
      });

      await queues.brollChunkEnrichment.add('broll-chunk-enrichment', {
        jobId: enrichmentJob.id,
        episodeId,
        userId,
        slotClipId,
        chunkId,
        chunkIndex,
        muxAssetId: assetInfo.id,
        muxPlaybackId: playbackId,
        enrichmentMode: 'refinement', // Use refinement mode since we have Mux asset and slot clip is enriched
      });

      logger.info(
        `Queued broll_chunk_enrichment job ${enrichmentJob.id} for chunk ${chunkIndex} (refinement mode)`
      );
    } else {
      // Slot clip not enriched yet - chunk enrichment will be queued by slotClipEnrichment
      logger.info(
        `Skipping chunk enrichment queue for chunk ${chunkIndex} - slot clip ${slotClipId} not enriched yet (will be queued by slotClipEnrichment)`
      );
    }

    // For A-roll chunks: Trigger transcription job to extract exact wording per chunk
    if (isARollChunk) {
      const transcriptJob = await prisma.job.create({
        data: {
          type: 'aroll_chunk_transcript',
          status: 'pending',
          episodeId,
          userId,
          inputData: {
            slotClipId,
            chunkId,
            chunkIndex,
            muxAssetId: assetInfo.id,
            muxPlaybackId: playbackId,
          },
        },
      });

      await queues.arollChunkTranscript.add('aroll-chunk-transcript', {
        jobId: transcriptJob.id,
        episodeId,
        userId,
        slotClipId,
        chunkId,
        chunkIndex,
        muxAssetId: assetInfo.id,
        muxPlaybackId: playbackId,
      });

      logger.info(
        `Queued aroll_chunk_transcript job ${transcriptJob.id} for A-roll chunk ${chunkIndex}`
      );
    }

    // Phase 5.1: Wake up render orchestrator to check if any episodes are now eligible for render
    try {
      const { renderOrchestrator } = await import('../services/renderOrchestrator.js');
      await renderOrchestrator.wakeUp();
    } catch (error) {
      // Log but don't fail - orchestrator wake-up is non-critical
      logger.debug(`Failed to wake up render orchestrator after chunk ingest: ${error}`);
    }

    logger.info(`Chunk ingest job ${jobId} completed successfully`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`Chunk ingest job ${jobId} failed:`, error);

    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: 'error',
        errorMessage,
      },
    });

    await progressPublisher.publish(jobId, 'error', 'processing', 0, errorMessage);

    // Best-effort recovery: even if this chunk fails (e.g. transient 429),
    // re-check readiness so episodes with sufficient usable chunks can progress.
    try {
      const { triggerSemanticMatchingSafely } = await import('../services/episodeReadiness.js');
      const triggerResult = await triggerSemanticMatchingSafely(episodeId, userId);
      if (triggerResult.triggered) {
        logger.info(
          `Episode ${episodeId}: triggered semantic matching ${triggerResult.jobId} after chunk ingest failure`
        );
      } else {
        logger.debug(
          `Episode ${episodeId}: not ready to trigger semantic matching after chunk ingest failure: ${triggerResult.reason}`
        );
      }
    } catch (triggerError) {
      logger.debug(
        `Chunk ingest job ${jobId}: readiness recovery trigger failed (non-fatal): ${triggerError}`
      );
    }

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
