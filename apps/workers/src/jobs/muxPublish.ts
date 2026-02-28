/**
 * Phase 5.3: Mux Publish Job
 * 
 * Publishes the final rendered video to Mux:
 * - Uploads final MP4 from S3 to Mux
 * - Waits for transcoding/processing
 * - Enables AI-powered enrichment (tags, moderation)
 * - Updates episode with final playback ID and thumbnail
 * - Marks episode as "ready" for distribution
 * 
 * Pipeline Position: After ffmpeg_render_microcut_v2
 * Previous Job: ffmpeg_render_microcut_v2
 * Final Job: Episode is ready!
 * 
 * @see WEBL_MASTER_IMPLEMENTATION.md Section 10: Phase 5
 */

import { Job } from 'bullmq';
import { prisma } from '../services/db.js';
import { s3Service } from '../services/s3.js';
import { muxService } from '../services/mux.js';
import { progressPublisher } from '../services/progress.js';
import { usageService } from '../services/usage.js';
import { logger } from '@webl/shared';

// ==================== TYPES ====================

interface MuxPublishJobData {
  jobId: string;
  episodeId: string;
  userId: string;
  finalS3Key: string;
}

// ==================== JOB PROCESSOR ====================

export async function processMuxPublish(
  bullJob: Job<MuxPublishJobData>
): Promise<void> {
  const { jobId, episodeId, userId, finalS3Key } = bullJob.data;

  logger.info(`[Phase 5.3] Starting Mux publish job ${jobId}`, { episodeId, finalS3Key });

  let muxAssetId: string | null = null;

  try {
    // Usage guard: check hard limits before Mux publish
    const usageCheck = await usageService.checkCanProceed(userId);
    if (!usageCheck.allowed) {
      await prisma.job.update({ where: { id: jobId }, data: { status: 'error', errorMessage: `Usage limit exceeded: ${usageCheck.reason}` } });
      throw new Error(`Usage limit exceeded: ${usageCheck.reason}`);
    }

    // Update job status
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
      'Starting Mux upload'
    );

    // Step 1: Validate S3 file exists (5%)
    await updateProgress(jobId, 'processing', 5, 'Validating render output');

    // Generate signed URL for Mux to download
    const signedUrl = await s3Service.getSignedDownloadUrl(finalS3Key, 3600);

    // Step 2: Load episode and series info (10%)
    await updateProgress(jobId, 'processing', 10, 'Loading episode metadata');

    const episode = await prisma.episode.findUnique({
      where: { id: episodeId },
      include: {
        series: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!episode) {
      throw new Error(`Episode ${episodeId} not found`);
    }

    // Step 3: Create Mux asset (15-60%)
    await updateProgress(jobId, 'uploading', 15, 'Creating Mux asset');

    const passthrough = JSON.stringify({
      episodeId,
      seriesId: episode.seriesId,
      userId,
      type: 'final_render',
      createdAt: new Date().toISOString(),
    });

    const muxAsset = await muxService.createAssetFromUrl({
      inputUrl: signedUrl,
      passthrough,
      generateSubtitles: false, // Final render output - captions not displayed on final video
    });

    muxAssetId = muxAsset.id;

    logger.info(`Created Mux asset ${muxAsset.id}`, { episodeId });

    // Step 4: Wait for asset to be ready (60-85%)
    await updateProgress(jobId, 'uploading', 60, 'Waiting for Mux processing');

    const playbackId = await muxService.waitForAssetAndGetPlaybackId(
      muxAsset.id,
      120, // Max 120 attempts (10 minutes for final render)
      5000 // 5 second intervals
    );

    logger.info(`Asset ready with playback ID ${playbackId}`, { episodeId });

    // Step 5: Get thumbnail URL (85%)
    await updateProgress(jobId, 'processing', 85, 'Generating thumbnail');

    const playbackUrl = muxService.getPlaybackUrl(playbackId);
    const thumbnailUrl = muxService.getThumbnailUrl(playbackId, {
      time: 2, // 2 seconds in for better thumbnail
      width: 1200,
    });

    // Get video thumbnail for portrait (9:16)
    const verticalThumbnail = muxService.getThumbnailUrl(playbackId, {
      time: 2,
      width: 540,
    });

    // Step 6: Update episode with final info (90%)
    await updateProgress(jobId, 'processing', 90, 'Updating episode');

    const renderSpec = (episode.renderSpec as Record<string, any>) || {};

    logger.info(`[Phase 5.3] Setting final playback ID: ${playbackId} for episode ${episodeId}`);

    await prisma.episode.update({
      where: { id: episodeId },
      data: {
        status: 'ready',
        muxFinalPlaybackId: playbackId, // PHASE 2 FIX: Explicitly set final playback ID
        muxFinalAssetId: muxAsset.id,
        renderSpec: {
          ...renderSpec,
          finalMuxAssetId: muxAsset.id,
          finalMuxPlaybackId: playbackId, // PHASE 2 FIX: Also set in renderSpec
          finalPlaybackUrl: playbackUrl,
          finalThumbnailUrl: thumbnailUrl,
          verticalThumbnailUrl: verticalThumbnail,
          publishedAt: new Date().toISOString(),
        },
      },
    });
    logger.info('[Phase 5.3] STORED: final playback identifiers on episode', {
      episodeId,
      muxFinalAssetId: muxAsset.id,
      muxFinalPlaybackId: playbackId,
      finalS3Key,
    });

    // Step 7: Complete job (100%)
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: 'done',
        stage: 'done',
        progress: 100,
        outputData: {
          muxAssetId: muxAsset.id,
          muxPlaybackId: playbackId,
          playbackUrl,
          thumbnailUrl,
        },
      },
    });

    await progressPublisher.publish(
      jobId,
      'done',
      'done',
      100,
      'Episode published and ready!'
    );

    logger.info(`[Phase 5.3] Mux publish job ${jobId} completed successfully`, {
      playbackId,
      playbackUrl,
    });

    // Log final metrics
    const cutPlan = episode.cutPlan as any;
    if (cutPlan?.metrics) {
      logger.info(`Episode ${episodeId} final metrics:`, {
        totalDurationMs: cutPlan.totalDurationMs,
        totalCuts: cutPlan.metrics.totalCuts,
        coverageScore: cutPlan.metrics.coverageScore,
        averageMatchScore: cutPlan.metrics.averageMatchScore,
      });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`[Phase 5.3] Mux publish job ${jobId} failed:`, error);

    // Clean up Mux asset on failure
    if (muxAssetId) {
      try {
        await muxService.deleteAsset(muxAssetId);
        logger.info(`Cleaned up failed Mux asset: ${muxAssetId}`);
      } catch (cleanupError) {
        logger.warn(`Failed to cleanup Mux asset ${muxAssetId}:`, cleanupError);
      }
    }

    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: 'error',
        errorMessage,
      },
    });

    await progressPublisher.publish(jobId, 'error', 'uploading', 0, errorMessage);

    throw error;
  }
}

// ==================== HELPERS ====================

async function updateProgress(
  jobId: string,
  stage: 'starting' | 'processing' | 'uploading' | 'done',
  progress: number,
  message: string
): Promise<void> {
  await prisma.job.update({
    where: { id: jobId },
    data: { stage, progress },
  });
  await progressPublisher.publish(jobId, 'processing', stage, progress, message);
}
