/**
 * Phase 3.3: Cut Plan Validation Job
 *
 * Purpose: Validate MicroCutPlanV2 invariants before rendering.
 *
 * Pipeline Position: After cut_plan_generation
 * Dependencies: cutPlan stored on episode
 * Triggers: render orchestration
 */

import { Job } from 'bullmq';
import { prisma } from '../services/db.js';
import { progressPublisher } from '../services/progress.js';
import { logger } from '@webl/shared';
import { MicroCutPlanV2Schema } from '@webl/shared';

interface CutPlanValidationJobData {
  jobId: string;
  episodeId: string;
  userId: string;
}

const AROLL_PREVIEW_CHUNK_ID = 'aroll_clean_preview';

export async function processCutPlanValidation(
  bullJob: Job<CutPlanValidationJobData>
): Promise<void> {
  const { jobId, episodeId } = bullJob.data;

  logger.info(`[Phase 3.3] Starting cut plan validation job ${jobId}`, {
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
      'Starting cut plan validation'
    );

    await updateProgress(jobId, 'processing', 10, 'Loading cut plan');

    const episode = await prisma.episode.findUnique({
      where: { id: episodeId },
      select: {
        cutPlan: true,
        cleanVoiceoverDuration: true,
        renderSpec: true,
      },
    });

    if (!episode) {
      throw new Error(`Episode ${episodeId} not found`);
    }

    if (!episode.cutPlan) {
      throw new Error(`Episode ${episodeId} has no cut plan`);
    }

    const cutPlan = MicroCutPlanV2Schema.parse(episode.cutPlan);
    const cleanVoiceoverDurationMs = Math.round(
      (episode.cleanVoiceoverDuration ?? 0) * 1000
    );
    logger.info('[Phase 3.3] RECEIVED: cut plan for validation', {
      episodeId,
      cutCount: cutPlan.cuts.length,
      totalDurationMs: cutPlan.totalDurationMs,
      cleanVoiceoverDurationMs,
    });

    await updateProgress(jobId, 'processing', 40, 'Validating duration and timeline');

    if (cutPlan.totalDurationMs !== cleanVoiceoverDurationMs) {
      throw new Error(
        `totalDurationMs mismatch: ${cutPlan.totalDurationMs}ms vs ${cleanVoiceoverDurationMs}ms`
      );
    }

    if (cutPlan.cuts.length === 0) {
      throw new Error('Cut plan has no cuts');
    }

    let expectedStart = 0;
    let summedDuration = 0;

    for (const cut of cutPlan.cuts) {
      const computedDuration = cut.endMs - cut.startMs;
      if (computedDuration !== cut.durationMs) {
        throw new Error(`Cut ${cut.cutIndex} duration mismatch`);
      }
      if (cut.startMs !== expectedStart) {
        throw new Error(`Cut ${cut.cutIndex} timeline gap/overlap`);
      }
      if (cut.voiceoverStartMs !== cut.startMs || cut.voiceoverEndMs !== cut.endMs) {
        throw new Error(`Cut ${cut.cutIndex} voiceover mismatch`);
      }
      expectedStart = cut.endMs;
      summedDuration += cut.durationMs;
    }

    if (summedDuration !== cutPlan.totalDurationMs) {
      throw new Error(
        `Sum of cut durations mismatch: ${summedDuration}ms vs ${cutPlan.totalDurationMs}ms`
      );
    }

    await updateProgress(jobId, 'processing', 70, 'Validating chunk references');

    const renderSpec = episode.renderSpec as Record<string, unknown> | null;
    const arollPreviewS3Key =
      typeof renderSpec?.arollCleanPreviewS3Key === 'string'
        ? renderSpec.arollCleanPreviewS3Key
        : null;
    const arollPreviewDurationMs =
      typeof renderSpec?.arollCleanPreviewDuration === 'number'
        ? Math.round(renderSpec.arollCleanPreviewDuration * 1000)
        : cleanVoiceoverDurationMs;

    const chunkIds = cutPlan.cuts
      .map((cut) => cut.chunkId)
      .filter((chunkId) => chunkId !== AROLL_PREVIEW_CHUNK_ID);
    const chunks = await prisma.brollChunk.findMany({
      where: { id: { in: chunkIds } },
      select: {
        id: true,
        s3Key: true,
        durationMs: true,
      },
    });
    const chunkMap = new Map<string, { id: string; s3Key: string | null; durationMs: number }>(
      chunks.map((chunk: { id: string; s3Key: string | null; durationMs: number }) => [chunk.id, chunk])
    );

    for (const cut of cutPlan.cuts) {
      if (cut.chunkId === AROLL_PREVIEW_CHUNK_ID) {
        if (!arollPreviewS3Key) {
          throw new Error(`Missing cleaned A-roll preview key for cut ${cut.cutIndex}`);
        }
        if (cut.chunkS3Key !== arollPreviewS3Key) {
          throw new Error(`A-roll preview S3 key mismatch for cut ${cut.cutIndex}`);
        }
        if (cut.clipEndMs > arollPreviewDurationMs) {
          throw new Error(`A-roll preview clip exceeds duration for cut ${cut.cutIndex}`);
        }
        continue;
      }

      const chunk = chunkMap.get(cut.chunkId);
      if (!chunk?.s3Key) {
        throw new Error(`Missing chunk S3 key for cut ${cut.cutIndex}`);
      }
      if (chunk.s3Key !== cut.chunkS3Key) {
        throw new Error(`Chunk S3 key mismatch for cut ${cut.cutIndex}`);
      }
      if (cut.clipEndMs > chunk.durationMs) {
        throw new Error(`Clip exceeds chunk duration for cut ${cut.cutIndex}`);
      }
    }

    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: 'done',
        stage: 'done',
        progress: 100,
        outputData: {
          cutCount: cutPlan.cuts.length,
          totalDurationMs: cutPlan.totalDurationMs,
        },
      },
    });

    await progressPublisher.publish(
      jobId,
      'done',
      'done',
      100,
      'Cut plan validation complete'
    );

    await prisma.episode.update({
      where: { id: episodeId },
      data: {
        status: 'cut_plan_ready',
        // Validation confirms a fresh plan state; clear stale render intent.
        renderRequested: false,
        renderRequestedAt: null,
        renderJobId: null,
      },
    });
    logger.info('[Phase 3.3] STORED: cut plan validation success', {
      episodeId,
      cutCount: cutPlan.cuts.length,
      totalDurationMs: cutPlan.totalDurationMs,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`[Phase 3.3] Cut plan validation job ${jobId} failed:`, error);

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
  await prisma.job.update({
    where: { id: jobId },
    data: { stage, progress },
  });
  await progressPublisher.publish(jobId, 'processing', stage, progress, message);
}
