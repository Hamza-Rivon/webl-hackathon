/**
 * Phase 1.1: Voiceover Ingest Job
 *
 * Purpose: Upload voiceover to Mux (transcription handled by Deepgram)
 * 
 * Pipeline Position: Entry point for voiceover processing
 * Dependencies: None
 * Triggers: voiceover_transcript job
 * 
 * Key Steps:
 * 1. Get S3 signed URL for voiceover file
 * 2. Create Mux asset
 * 3. Wait for asset to be ready
 * 4. Update episode with rawVoiceoverMuxAssetId
 * 5. Trigger voiceover_transcript job
 */

import { Job } from 'bullmq';
import { prisma } from '../services/db.js';
import { s3Service } from '../services/s3.js';
import { muxService } from '../services/mux.js';
import { progressPublisher } from '../services/progress.js';
import { usageService } from '../services/usage.js';
import { logger } from '@webl/shared';

// ==================== TYPES ====================

interface VoiceoverIngestJobData {
  jobId: string;
  episodeId: string;
  userId: string;
  s3Key: string;
}

// ==================== JOB PROCESSOR ====================

export async function processVoiceoverIngest(bullJob: Job<VoiceoverIngestJobData>): Promise<void> {
  const { jobId, episodeId, userId, s3Key } = bullJob.data;

  logger.info(`[Phase 1.1] Starting voiceover ingest job ${jobId}`, { episodeId, s3Key });
  logger.info('[Phase 1.1] RECEIVED: job data', { jobId, episodeId, userId, s3Key });

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
      'Starting voiceover ingest'
    );

    // Step 1: Get signed URL for S3 file (10%)
    await updateProgress(jobId, 'downloading', 10, 'Generating S3 signed URL');

    const signedUrl = await s3Service.getSignedDownloadUrl(s3Key, 7200); // 2 hour expiry
    logger.info('[Phase 1.1] DOING: generated signed URL for raw audio (audio not altered)', { s3Key });

    // Step 2: Create Mux asset (20%)
    await updateProgress(jobId, 'uploading', 20, 'Creating Mux asset');

    const passthrough = `episode:${episodeId}:voiceover`;

    const assetInfo = await muxService.createAssetFromUrl({
      inputUrl: signedUrl,
      passthrough,
      generateSubtitles: false, // Deepgram handles transcription
      language: 'en',
    });

    logger.info('[Phase 1.1] RECEIVED: Mux asset created (audio not altered, same file)', { episodeId, muxAssetId: assetInfo.id });

    // Step 3: Wait for asset to be ready (20-70%)
    await updateProgress(jobId, 'processing', 30, 'Waiting for Mux to process asset');

    const readyAsset = await muxService.waitForAssetReady(assetInfo.id, 120, 3000);
    const playbackId = readyAsset.playbackIds?.[0]?.id ?? null;

    if (!playbackId) {
      throw new Error(`No playback ID available for asset ${assetInfo.id}`);
    }

    logger.info(`Mux asset ${assetInfo.id} is ready with playback ID ${playbackId}`);

    // Step 4: Update episode with raw voiceover info (80%)
    await updateProgress(jobId, 'analyzing', 80, 'Updating episode with voiceover info');

    await prisma.episode.update({
      where: { id: episodeId },
      data: {
        rawVoiceoverS3Key: s3Key,
        rawVoiceoverMuxAssetId: assetInfo.id,
        rawVoiceoverDuration: readyAsset.duration,
        status: 'voiceover_uploaded',
      },
    });

    logger.info('[Phase 1.1] STORED: episode raw voiceover (no transcript yet)', {
      episodeId,
      rawVoiceoverS3Key: s3Key,
      rawVoiceoverMuxAssetId: assetInfo.id,
      rawVoiceoverDuration: readyAsset.duration,
    });

    // Step 5: Complete job (100%)
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

    await progressPublisher.publish(
      jobId,
      'done',
      'done',
      100,
      'Voiceover ingest complete'
    );

    // Step 6: Trigger next job - voiceover_transcript
    logger.info(`[Phase 1.1] Triggering voiceover_transcript job for episode ${episodeId}`);
    
    // Create next job in database
    const transcriptJob = await prisma.job.create({
      data: {
        type: 'voiceover_transcript',
        status: 'pending',
        userId,
        episodeId,
        inputData: {
          s3Key,
        },
      },
    });

    // Queue it for processing
    const { queues } = await import('../queue.js');
    await queues.voiceoverTranscript.add('voiceover-transcript', {
      jobId: transcriptJob.id,
      episodeId,
      userId,
      s3Key,
    });

    logger.info(`[Phase 1.1] Voiceover ingest job ${jobId} completed successfully`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`[Phase 1.1] Voiceover ingest job ${jobId} failed:`, error);

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
