/**
 * Jobs Routes
 *
 * Job status and management endpoints for the ffmpeg render pipeline.
 */

import { Router, Request, Response } from 'express';
import { getUserId } from '../middleware/clerk.js';
import { prisma } from '@webl/prisma';
import { sseSubscriber, queueService, type JobProgress } from '../services/index.js';
import { logger } from '@webl/shared';

export const jobsRouter = Router();

// ==================== HELPER FUNCTIONS ====================

/**
 * Get human-readable job type label
 */
function getJobTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    creative_edit_plan: 'Creative Edit Plan',
    ffmpeg_render_microcut_v2: 'Rendering Video',
    mux_publish: 'Publishing Video',
  };
  return labels[type] || type;
}

function getSingleParamValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

// ==================== ROUTES ====================

/**
 * GET /api/jobs - List user's jobs
 */
jobsRouter.get('/', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { episodeId, status, type, limit = '50' } = req.query;

  try {
    const jobs = await prisma.job.findMany({
      where: {
        userId,
        ...(episodeId && { episodeId: episodeId as string }),
        ...(status && { status: status as 'pending' | 'processing' | 'done' | 'error' | 'cancelled' }),
        ...(type && { type: type as any }),
      },
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit as string, 10),
    });

    // Add labels to jobs
    const jobsWithLabels = jobs.map((job: typeof jobs[0]) => ({
      ...job,
      typeLabel: getJobTypeLabel(job.type),
    }));

    res.json(jobsWithLabels);
  } catch (error) {
    logger.error('Failed to list jobs:', error);
    res.status(500).json({ error: 'Failed to fetch jobs' });
  }
});

/**
 * GET /api/jobs/active - Get user's active (in-progress) jobs
 */
jobsRouter.get('/active', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const jobs = await prisma.job.findMany({
      where: {
        userId,
        status: { in: ['pending', 'processing'] },
      },
      include: {
        episode: {
          select: { id: true, title: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    const jobsWithLabels = jobs.map((job: typeof jobs[0]) => ({
      ...job,
      typeLabel: getJobTypeLabel(job.type),
    }));

    res.json(jobsWithLabels);
  } catch (error) {
    logger.error('Failed to get active jobs:', error);
    res.status(500).json({ error: 'Failed to fetch active jobs' });
  }
});

/**
 * GET /api/jobs/:id - Get job status
 */
jobsRouter.get('/:id', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const job = await prisma.job.findFirst({
      where: { id: req.params.id, userId },
    });

    if (!job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }

    res.json({
      ...job,
      typeLabel: getJobTypeLabel(job.type),
    });
  } catch (error) {
    logger.error(`Failed to get job ${req.params.id}:`, error);
    res.status(500).json({ error: 'Failed to fetch job' });
  }
});

/**
 * GET /api/jobs/:id/progress - SSE stream for job progress
 *
 * Uses Redis Pub/Sub for real-time progress updates.
 */
jobsRouter.get('/:id/progress', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const jobId = getSingleParamValue(req.params.id);
  if (!jobId) {
    res.status(400).json({ error: 'Job ID required' });
    return;
  }

  // Verify job exists and belongs to user
  const job = await prisma.job.findFirst({
    where: { id: jobId, userId },
  });

  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

  // Send initial status
  const initialProgress: JobProgress = {
    jobId: job.id,
    status: job.status as JobProgress['status'],
    stage: job.stage,
    progress: job.progress,
    timestamp: job.updatedAt.getTime(),
  };
  res.write(`data: ${JSON.stringify(initialProgress)}\n\n`);

  // If job is already complete, close connection
  if (sseSubscriber.isTerminalStatus(job.status)) {
    logger.debug(`Job ${jobId} already in terminal state, closing SSE`);
    res.end();
    return;
  }

  // Subscribe to Redis channel for real-time updates
  const unsubscribe = sseSubscriber.subscribe(jobId, (progress: JobProgress) => {
    // Forward progress to SSE client
    res.write(`data: ${JSON.stringify(progress)}\n\n`);

    // Close connection on job complete/fail
    if (sseSubscriber.isTerminalStatus(progress.status)) {
      logger.debug(`Job ${jobId} reached terminal state, closing SSE`);
      unsubscribe();
      res.end();
    }
  });

  // Clean up on client disconnect
  req.on('close', () => {
    logger.debug(`Client disconnected from job ${jobId} progress stream`);
    unsubscribe();
  });

  // Keep connection alive with periodic heartbeat
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 30000);

  req.on('close', () => {
    clearInterval(heartbeat);
  });
});

/**
 * POST /api/jobs/:id/retry - Retry failed job
 *
 * Re-queues the job in BullMQ based on job type.
 */
jobsRouter.post('/:id/retry', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const job = await prisma.job.findFirst({
      where: { id: req.params.id, userId },
    });

    if (!job) {
      res.status(404).json({ error: 'Job not found or not retriable' });
      return;
    }

    if (job.status === 'done' || job.status === 'cancelled') {
      res.status(400).json({ error: `Job is already ${job.status}` });
      return;
    }

    if (job.status === 'processing') {
      res.status(400).json({ error: 'Job is currently processing and cannot be retried' });
      return;
    }

    if (job.status === 'pending' && (job.progress ?? 0) > 0) {
      res.status(400).json({ error: 'Job is already pending in queue' });
      return;
    }

    // Check retry limit
    if (job.status === 'error' && job.retryCount >= 3) {
      res.status(400).json({ error: 'Maximum retry attempts reached' });
      return;
    }

    const episodeId = job.episodeId;
    const inputData = job.inputData as Record<string, unknown> | null;
    const metadata = job.metadata as Record<string, unknown> | null;

    let enqueueRetryJob: (() => Promise<void>) | null = null;

    switch (job.type) {
      case 'mux_publish': {
        const finalS3Key = (inputData?.finalS3Key ?? metadata?.finalS3Key) as string;

        if (!finalS3Key || !episodeId) {
          res.status(400).json({ error: 'Missing finalS3Key for mux_publish retry' });
          return;
        }

        enqueueRetryJob = async () => {
          await queueService.addMuxPublishJob({
            jobId: job.id,
            episodeId,
            userId,
            finalS3Key,
          });
        };
        break;
      }

      case 'broll_chunk_embedding': {
        if (!episodeId) {
          res.status(400).json({ error: 'Missing episodeId for broll_chunk_embedding retry' });
          return;
        }

        const chunkId = (inputData?.chunkId ?? metadata?.chunkId) as string | undefined;
        let slotClipId = (inputData?.slotClipId ?? metadata?.slotClipId) as string | undefined;
        let chunkIndex = Number(inputData?.chunkIndex ?? metadata?.chunkIndex);
        const isRefinement = Boolean(inputData?.isRefinement ?? metadata?.isRefinement);

        if (!chunkId) {
          res.status(400).json({ error: 'Missing chunkId for broll_chunk_embedding retry' });
          return;
        }

        if (!slotClipId || !Number.isFinite(chunkIndex)) {
          const chunk = await prisma.brollChunk.findUnique({
            where: { id: chunkId },
            select: { episodeId: true, slotClipId: true, chunkIndex: true },
          });

          if (!chunk || chunk.episodeId !== episodeId) {
            res.status(400).json({ error: 'Invalid chunk data for broll_chunk_embedding retry' });
            return;
          }

          slotClipId = chunk.slotClipId;
          chunkIndex = chunk.chunkIndex;
        }

        enqueueRetryJob = async () => {
          await queueService.addBrollChunkEmbeddingJob({
            jobId: job.id,
            episodeId,
            userId,
            slotClipId: slotClipId!,
            chunkId,
            chunkIndex,
            isRefinement,
          });
        };
        break;
      }

      case 'broll_chunk_ingest': {
        if (!episodeId) {
          res.status(400).json({ error: 'Missing episodeId for broll_chunk_ingest retry' });
          return;
        }

        const chunkId = (inputData?.chunkId ?? metadata?.chunkId) as string | undefined;
        let slotClipId = (inputData?.slotClipId ?? metadata?.slotClipId) as string | undefined;
        let chunkIndex = Number(inputData?.chunkIndex ?? metadata?.chunkIndex);

        if (!chunkId) {
          res.status(400).json({ error: 'Missing chunkId for broll_chunk_ingest retry' });
          return;
        }

        if (!slotClipId || !Number.isFinite(chunkIndex)) {
          const chunk = await prisma.brollChunk.findUnique({
            where: { id: chunkId },
            select: { episodeId: true, slotClipId: true, chunkIndex: true },
          });

          if (!chunk || chunk.episodeId !== episodeId) {
            res.status(400).json({ error: 'Invalid chunk data for broll_chunk_ingest retry' });
            return;
          }

          slotClipId = chunk.slotClipId;
          chunkIndex = chunk.chunkIndex;
        }

        enqueueRetryJob = async () => {
          await queueService.addBrollChunkIngestJob({
            jobId: job.id,
            episodeId,
            userId,
            slotClipId: slotClipId!,
            chunkId,
            chunkIndex,
          });
        };
        break;
      }

      default:
        logger.warn(`Unknown or legacy job type for retry: ${job.type}`);
        res.status(400).json({ error: `Job type ${job.type} is not supported for retry` });
        return;
    }

    // Update job status to pending only after validation succeeds
    await prisma.job.update({
      where: { id: req.params.id },
      data: {
        status: 'pending',
        errorMessage: null,
        ...(job.status === 'error' ? { retryCount: { increment: 1 } } : {}),
        stage: 'starting',
        progress: 0,
      },
    });

    if (!enqueueRetryJob) {
      res.status(500).json({ error: 'Retry enqueue handler not found' });
      return;
    }

    await enqueueRetryJob();

    logger.info(`Job ${job.id} queued for retry`);

    res.json({ success: true, message: 'Job queued for retry' });
  } catch (error) {
    logger.error(`Failed to retry job ${req.params.id}:`, error);
    res.status(500).json({ error: 'Failed to retry job' });
  }
});

/**
 * POST /api/jobs/:id/cancel - Cancel running job
 *
 * Removes job from BullMQ queue if pending, or marks as cancelled if processing.
 */
jobsRouter.post('/:id/cancel', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const job = await prisma.job.findFirst({
      where: {
        id: req.params.id,
        userId,
        status: { in: ['pending', 'processing'] },
      },
    });

    if (!job) {
      res.status(404).json({ error: 'Job not found or not cancellable' });
      return;
    }

    // Try to remove from BullMQ queue if still pending
    if (job.status === 'pending') {
      await queueService.removeJob(job.type, job.id);
    }

    // Mark job as cancelled
    await prisma.job.update({
      where: { id: req.params.id },
      data: {
        status: 'cancelled',
        errorMessage: 'Cancelled by user',
        stage: 'done',
      },
    });

    logger.info(`Job ${job.id} cancelled by user ${userId}`);

    res.json({ success: true, message: 'Job cancelled' });
  } catch (error) {
    logger.error(`Failed to cancel job ${req.params.id}:`, error);
    res.status(500).json({ error: 'Failed to cancel job' });
  }
});

/**
 * GET /api/jobs/episode/:episodeId - Get all jobs for an episode
 */
jobsRouter.get('/episode/:episodeId', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const jobs = await prisma.job.findMany({
      where: {
        episodeId: req.params.episodeId,
        userId,
      },
      orderBy: { createdAt: 'asc' },
    });

    // Add labels and group by type
    const jobsWithLabels = jobs.map((job: typeof jobs[0]) => ({
      ...job,
      typeLabel: getJobTypeLabel(job.type),
    }));

    // Calculate pipeline progress
    const totalJobs = jobs.length;
    const completedJobs = jobs.filter((j: typeof jobs[0]) => j.status === 'done').length;
    const failedJobs = jobs.filter((j: typeof jobs[0]) => j.status === 'error').length;
    const currentJob = jobs.find((j: typeof jobs[0]) => j.status === 'processing');

    res.json({
      jobs: jobsWithLabels,
      summary: {
        total: totalJobs,
        completed: completedJobs,
        failed: failedJobs,
        inProgress: currentJob ? 1 : 0,
        pending: totalJobs - completedJobs - failedJobs - (currentJob ? 1 : 0),
        currentJob: currentJob
          ? {
              id: currentJob.id,
              type: currentJob.type,
              typeLabel: getJobTypeLabel(currentJob.type),
              progress: currentJob.progress,
              stage: currentJob.stage,
            }
          : null,
      },
    });
  } catch (error) {
    logger.error(`Failed to get jobs for episode ${req.params.episodeId}:`, error);
    res.status(500).json({ error: 'Failed to fetch jobs' });
  }
});
