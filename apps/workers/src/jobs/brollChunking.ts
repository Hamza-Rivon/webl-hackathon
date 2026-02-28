/**
 * B-Roll Chunking Job (Phase 2.2)
 *
 * Splits B-roll video into configurable chunks (default 2 seconds) using FFmpeg.
 * Each chunk is saved to S3 and a BrollChunk record is created.
 *
 * Flow:
 * 1. Download original B-roll from S3
 * 2. Calculate number of chunks (based on CHUNK_DURATION_SECONDS)
 * 3. Create BrollChunk database records
 * 4. Extract each chunk using FFmpeg
 * 5. Upload chunks to S3
 * 6. Update SlotClip with chunk count
 * 7. Queue broll_chunk_ingest jobs in batches of 10
 *
 * Dependencies: broll_ingest
 * Next Job: broll_chunk_ingest (batched)
 */

import { Job } from 'bullmq';
import { prisma } from '../services/db.js';
import { s3Service } from '../services/s3.js';
import { progressPublisher } from '../services/progress.js';
import { incrementUsage } from '../services/usage.js';
import { queues } from '../queue.js';
import { logger, CHUNK_DURATION_SECONDS, CHUNK_DURATION_MS } from '@webl/shared';
import ffmpeg from 'fluent-ffmpeg';
import { unlink } from 'fs/promises';
// cuid is available from @prisma/client

// ==================== TYPES ====================

interface BrollChunkingJobData {
  jobId: string;
  episodeId: string;
  userId: string;
  slotClipId: string;
  muxAssetId: string;
  duration: number;
}

interface ChunkRecord {
  id: string;
  chunkIndex: number;
  startMs: number;
  endMs: number;
  durationMs: number;
}

type SlotRequirementsJson = {
  workflow?: string;
  slots?: Array<{ slotType?: string; priority?: string }>;
} | null;

// ==================== CONSTANTS ====================

const BATCH_SIZE = 10; // Process chunks in batches of 10

// ==================== JOB PROCESSOR ====================

export async function processBrollChunking(bullJob: Job<BrollChunkingJobData>): Promise<void> {
  const { jobId, episodeId, userId, slotClipId, muxAssetId, duration } = bullJob.data;

  logger.info(`Starting B-roll chunking job ${jobId} for slot clip ${slotClipId}`, {
    episodeId,
    muxAssetId,
    duration,
  });

  // Check if this is an A-roll slot (needs audio preserved for transcription)
  const slotClip = await prisma.slotClip.findUnique({
    where: { id: slotClipId },
    select: {
      slotType: true,
      s3Key: true,
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
      'Starting B-roll chunking'
    );

    // Step 1: Get SlotClip info (5%)
    await updateProgress(jobId, 'downloading', 5, 'Fetching slot clip info');

    if (!slotClip) {
      throw new Error(`SlotClip ${slotClipId} not found`);
    }

    if (!slotClip.s3Key) {
      throw new Error(`SlotClip ${slotClipId} has no S3 key`);
    }

    if (isARoll && isArollFirst) {
      logger.info(
        `Skipping chunking for A-roll slot clip ${slotClipId} in A-roll-first workflow`
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
        'Skipped chunking for A-roll-first workflow'
      );
      return;
    }

    // Step 2: Download original from S3 (10%)
    await updateProgress(jobId, 'downloading', 10, 'Downloading original video');

    const tempInputPath = `/tmp/${slotClipId}_original.mp4`;
    await s3Service.downloadFile(slotClip.s3Key, tempInputPath);

    logger.debug(`Downloaded B-roll to ${tempInputPath}`);

    // Step 3: Calculate number of chunks (15%)
    await updateProgress(jobId, 'processing', 15, 'Calculating chunks');

    // Calculate chunks - merge remainder into last chunk to avoid tiny trailing chunks
    const totalDurationMs = duration * 1000;
    const chunkDurationMs = CHUNK_DURATION_MS;
    const fullChunks = Math.floor(totalDurationMs / chunkDurationMs);
    const remainderMs = totalDurationMs % chunkDurationMs;

    const hasRemainder = remainderMs > 0;
    const numChunks = fullChunks > 0 ? fullChunks : 1;
    const mergeRemainderIntoLastChunk = fullChunks > 0 && hasRemainder;

    if (fullChunks === 0) {
      logger.warn(
        `Video duration (${duration}s) is less than minimum chunk size (${CHUNK_DURATION_SECONDS}s). Creating a single chunk.`
      );
    } else {
      const remainderNote = mergeRemainderIntoLastChunk
        ? `remainder merged into last chunk (${remainderMs}ms)`
        : 'no remainder';
      logger.info(`Will create ${numChunks} chunks for ${duration}s video (${remainderNote})`);
    }

    // Step 4: Create BrollChunk records (20%)
    await updateProgress(jobId, 'processing', 20, `Creating ${numChunks} chunk records`);

    const chunkRecords: ChunkRecord[] = [];
    for (let i = 0; i < numChunks; i++) {
      const startMs = i * chunkDurationMs;
      const isLastChunk = i === numChunks - 1;
      const endMs = isLastChunk && mergeRemainderIntoLastChunk
        ? totalDurationMs
        : Math.min((i + 1) * chunkDurationMs, totalDurationMs);
      const durationMs = endMs - startMs;

      const chunk = await prisma.brollChunk.create({
        data: {
          episodeId,
          slotClipId,
          chunkIndex: i,
          startMs,
          endMs,
          durationMs,
        },
      });

      chunkRecords.push({
        id: chunk.id,
        chunkIndex: i,
        startMs,
        endMs,
        durationMs,
      });
    }

    logger.info(`Created ${chunkRecords.length} BrollChunk records`);

    // Gap 1 Fix: Increment episode revision when chunks are created
    // This invalidates any existing cut plan and resets render requests
    await prisma.episode.update({
      where: { id: episodeId },
      data: {
        revision: { increment: 1 },
        renderRequested: false,
      },
    });

    logger.info(`Incremented episode revision for ${episodeId} (new chunks created)`);

    // Track chunk usage for the user (non-blocking)
    await incrementUsage(userId, 'chunks', chunkRecords.length);

    // Step 5: Extract each chunk with FFmpeg (20-80%)
    await updateProgress(jobId, 'processing', 25, 'Extracting chunks with FFmpeg');

    const tempChunkPaths: string[] = [];

    for (let i = 0; i < chunkRecords.length; i++) {
      const chunk = chunkRecords[i]!;
      const progressPercent = 25 + Math.floor((i / chunkRecords.length) * 55);

      await updateProgress(
        jobId,
        'processing',
        progressPercent,
        `Extracting chunk ${i + 1}/${chunkRecords.length}`
      );

      const tempOutputPath = `/tmp/${chunk.id}.mp4`;
      tempChunkPaths.push(tempOutputPath);

      await extractChunk(tempInputPath, tempOutputPath, chunk.startMs, chunk.durationMs, isARoll);

      logger.debug(`Extracted chunk ${i + 1}/${chunkRecords.length} to ${tempOutputPath}`);
    }

    // Step 6: Upload chunks to S3 (80-90%)
    await updateProgress(jobId, 'uploading', 80, 'Uploading chunks to S3');

    for (let i = 0; i < chunkRecords.length; i++) {
      const chunk = chunkRecords[i]!;
      const tempOutputPath = tempChunkPaths[i]!;
      const progressPercent = 80 + Math.floor((i / chunkRecords.length) * 10);

      await updateProgress(
        jobId,
        'uploading',
        progressPercent,
        `Uploading chunk ${i + 1}/${chunkRecords.length}`
      );

      const s3ChunkKey = `chunks/${episodeId}/${slotClipId}/${chunk.id}.mp4`;

      await s3Service.uploadFile(tempOutputPath, s3ChunkKey, 'video/mp4');

      await prisma.brollChunk.update({
        where: { id: chunk.id },
        data: { s3Key: s3ChunkKey },
      });

      logger.debug(`Uploaded chunk ${i + 1}/${chunkRecords.length} to S3: ${s3ChunkKey}`);
    }

    // Step 7: Clean up temp files (90%)
    await updateProgress(jobId, 'processing', 90, 'Cleaning up temp files');

    await unlink(tempInputPath);
    for (const tempPath of tempChunkPaths) {
      await unlink(tempPath);
    }

    logger.debug('Cleaned up temp files');

    // Step 8: Update SlotClip with chunk count (95%)
    await updateProgress(jobId, 'processing', 95, 'Updating slot clip');

    await prisma.slotClip.update({
      where: { id: slotClipId },
      data: { chunkCount: numChunks },
    });

    // Step 9: Complete job (100%)
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: 'done',
        stage: 'done',
        progress: 100,
        outputData: {
          numChunks,
          chunkIds: chunkRecords.map((c) => c.id),
        },
      },
    });

    await progressPublisher.publish(
      jobId,
      'done',
      'done',
      100,
      `Created ${numChunks} chunks`
    );

    // Step 10: Queue broll_chunk_ingest jobs in batches
    await queueChunkIngestJobs(episodeId, userId, slotClipId, chunkRecords);

    logger.info(`B-roll chunking job ${jobId} completed successfully`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`B-roll chunking job ${jobId} failed:`, error);

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

/**
 * Extract a chunk from the video using FFmpeg
 * 
 * @param inputPath - Path to input video file
 * @param outputPath - Path to output chunk file
 * @param startMs - Start time in milliseconds
 * @param durationMs - Duration in milliseconds
 * @param preserveAudio - If true, preserve audio track (for A-roll chunks that need transcription)
 */
async function extractChunk(
  inputPath: string,
  outputPath: string,
  startMs: number,
  durationMs: number,
  preserveAudio: boolean = false
): Promise<void> {
  return new Promise((resolve, reject) => {
    const outputOptions = [
      '-c:v libx264', // H.264 codec
      '-preset fast', // Fast encoding
      '-crf 23', // Quality (lower = better, 18-28 is good range)
    ];

    if (preserveAudio) {
      // Preserve audio for A-roll chunks (needed for Mux ASR transcription)
      outputOptions.push('-c:a aac', '-b:a 128k'); // AAC audio codec
    } else {
      // Remove audio for B-roll chunks (no audio needed)
      outputOptions.push('-an');
    }

    ffmpeg(inputPath)
      .setStartTime(startMs / 1000)
      .setDuration(durationMs / 1000)
      .outputOptions(outputOptions)
      .output(outputPath)
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .run();
  });
}

/**
 * Queue broll_chunk_ingest jobs in batches
 */
async function queueChunkIngestJobs(
  episodeId: string,
  userId: string,
  slotClipId: string,
  chunkRecords: ChunkRecord[]
): Promise<void> {
  logger.info(
    `Queuing ${chunkRecords.length} chunk ingest jobs in batches of ${BATCH_SIZE}`
  );

  // Create jobs in batches to avoid overwhelming the queue
  for (let i = 0; i < chunkRecords.length; i += BATCH_SIZE) {
    const batch = chunkRecords.slice(i, i + BATCH_SIZE);

    for (const chunk of batch) {
      const chunkIngestJob = await prisma.job.create({
        data: {
          type: 'broll_chunk_ingest',
          status: 'pending',
          episodeId,
          userId,
          inputData: {
            slotClipId,
            chunkId: chunk.id,
            chunkIndex: chunk.chunkIndex,
          },
          batchId: slotClipId, // Group by slot clip
          batchIndex: chunk.chunkIndex,
          batchTotal: chunkRecords.length,
        },
      });

      await queues.brollChunkIngest.add('broll-chunk-ingest', {
        jobId: chunkIngestJob.id,
        episodeId,
        userId,
        slotClipId,
        chunkId: chunk.id,
        chunkIndex: chunk.chunkIndex,
      });
    }

    logger.debug(`Queued batch ${Math.floor(i / BATCH_SIZE) + 1} of chunk ingest jobs`);
  }

  logger.info(`Queued all ${chunkRecords.length} chunk ingest jobs`);
}
