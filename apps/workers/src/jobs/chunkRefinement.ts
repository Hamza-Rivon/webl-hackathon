/**
 * Chunk Refinement Job (Phase 2.4)
 * 
 * Enriches top candidate chunks (identified by semantic matching) with full Mux AI analysis.
 * This is the second stage of two-stage enrichment.
 */

import { Job } from 'bullmq';
import { prisma } from '../services/db.js';
import { progressPublisher } from '../services/progress.js';
import { queues } from '../queue.js';
import { logger } from '@webl/shared';
import { config } from '../config.js';

interface ChunkRefinementJobData {
  jobId: string;
  episodeId: string;
  userId: string;
  chunkIds: string[]; // Top candidate chunks to refine
}

export async function processChunkRefinement(
  bullJob: Job<ChunkRefinementJobData>
): Promise<void> {
  const { jobId, episodeId, userId, chunkIds } = bullJob.data;

  logger.info(`Starting chunk refinement job ${jobId} for ${chunkIds.length} chunks`, {
    episodeId,
  });

  try {
    await prisma.job.update({
      where: { id: jobId },
      data: { status: 'processing', stage: 'starting', progress: 0 },
    });

    await progressPublisher.publish(
      jobId,
      'processing',
      'starting',
      0,
      `Starting refinement for ${chunkIds.length} chunks`
    );

    // Create refinement jobs for each chunk
    let processedCount = 0;
    for (let i = 0; i < chunkIds.length; i++) {
      const chunkId = chunkIds[i];
      if (!chunkId) continue;

      const progress = Math.round((i / chunkIds.length) * 90);
      await updateProgress(
        jobId,
        'processing',
        progress,
        `Creating refinement jobs (${i + 1}/${chunkIds.length})`
      );

      const chunk = await prisma.brollChunk.findUnique({
        where: { id: chunkId },
        select: {
          slotClipId: true,
          chunkIndex: true,
          muxAssetId: true,
          muxPlaybackId: true,
        },
      });

      const useRunpod = config.ai.provider === 'runpod';
      if (!chunk) {
        logger.warn(`Chunk ${chunkId} not found, skipping refinement`);
        continue;
      }
      if (!useRunpod && !chunk?.muxAssetId) {
        logger.warn(`Chunk ${chunkId} has no Mux asset ID, skipping refinement`);
        continue;
      }

      // Create enrichment job with refinement mode
      const enrichmentJob = await prisma.job.create({
        data: {
          type: 'broll_chunk_enrichment',
          status: 'pending',
          episodeId,
          userId,
          inputData: {
            slotClipId: chunk.slotClipId,
            chunkId,
            chunkIndex: chunk.chunkIndex,
            muxAssetId: chunk.muxAssetId,
            muxPlaybackId: chunk.muxPlaybackId,
            enrichmentMode: 'refinement',
          },
        },
      });

      await queues.brollChunkEnrichment.add('broll-chunk-enrichment', {
        jobId: enrichmentJob.id,
        episodeId,
        userId,
        slotClipId: chunk.slotClipId,
        chunkId,
        chunkIndex: chunk.chunkIndex,
        muxAssetId: chunk.muxAssetId,
        muxPlaybackId: chunk.muxPlaybackId,
        enrichmentMode: 'refinement',
      });

      processedCount++;
    }

    // Complete job
    await prisma.job.update({
      where: { id: jobId },
      data: { status: 'done', stage: 'done', progress: 100 },
    });

    await progressPublisher.publish(
      jobId,
      'done',
      'done',
      100,
      `Triggered refinement for ${processedCount} chunks`
    );

    logger.info(`Chunk refinement job ${jobId} completed, triggered ${processedCount} refinement jobs`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`Chunk refinement job ${jobId} failed:`, error);

    await prisma.job.update({
      where: { id: jobId },
      data: { status: 'error', errorMessage },
    });

    await progressPublisher.publish(jobId, 'error', 'processing', 0, errorMessage);

    throw error;
  }
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
