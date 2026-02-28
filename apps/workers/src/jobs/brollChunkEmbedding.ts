/**
 * B-Roll Chunk Embedding Job (Phase 2.5)
 *
 * Generates OpenAI vector embeddings for each chunk based on its AI tags and summary.
 * These embeddings are stored in PostgreSQL with pgvector for fast semantic similarity search.
 *
 * Flow:
 * 1. Get chunk with AI enrichment data
 * 2. Create embedding text from tags and summary
 * 3. Generate OpenAI embedding (text-embedding-3-large, 3072 dimensions)
 * 4. Store embedding in pgvector using raw SQL
 * 5. Check if all chunks for episode are complete
 * 6. If voiceover ready AND all chunks ready, trigger semantic_matching
 *
 * Dependencies: broll_chunk_enrichment
 * Next Job: semantic_matching (when all chunks + voiceover ready)
 */

import { Job } from 'bullmq';
import { prisma } from '../services/db.js';
import { progressPublisher } from '../services/progress.js';
import { logger } from '@webl/shared';
import { config } from '../config.js';
import OpenAI from 'openai';
import { usageService } from '../services/usage.js';

// ==================== TYPES ====================

interface BrollChunkEmbeddingJobData {
  jobId: string;
  episodeId: string;
  userId: string;
  slotClipId: string;
  chunkId: string;
  chunkIndex: number;
  chunkIds?: string[];
  isRefinement?: boolean;
}

const EMBEDDING_BATCH_SIZE = 25;

// ==================== JOB PROCESSOR ====================

export async function processBrollChunkEmbedding(
  bullJob: Job<BrollChunkEmbeddingJobData>
): Promise<void> {
  const { jobId, episodeId, userId, slotClipId, chunkId, chunkIndex, chunkIds, isRefinement } =
    bullJob.data;

  logger.info(`Starting chunk embedding job ${jobId} for chunk ${chunkIndex}`, {
    episodeId,
    slotClipId,
    chunkId,
  });

  try {
    // Usage guard: check hard limits before embedding calls
    const usageCheck = await usageService.checkCanProceed(userId);
    if (!usageCheck.allowed) {
      await prisma.job.update({ where: { id: jobId }, data: { status: 'error', errorMessage: `Usage limit exceeded: ${usageCheck.reason}` } });
      throw new Error(`Usage limit exceeded: ${usageCheck.reason}`);
    }

    await prisma.episode.updateMany({
      where: {
        id: episodeId,
        status: {
          in: ['voiceover_cleaned', 'collecting_clips', 'needs_more_clips', 'chunking_clips'],
        },
      },
      data: { status: 'enriching_chunks' },
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
      `Starting chunk ${chunkIndex} embedding`
    );

    // Step 1: Determine batch (10%)
    await updateProgress(jobId, 'downloading', 10, 'Selecting chunks for embedding');

    const requestedChunkIds = chunkIds?.length ? chunkIds : [chunkId];
    const batchChunkIds = await getBatchChunkIds(episodeId, requestedChunkIds);

    if (batchChunkIds.length === 0) {
      throw new Error('No chunks available for embedding');
    }

    // Step 2: Fetch chunk AI data (20%)
    await updateProgress(jobId, 'downloading', 20, 'Fetching chunk AI data');

    const chunks = await prisma.brollChunk.findMany({
      where: { id: { in: batchChunkIds } },
      select: {
        id: true,
        chunkIndex: true,
        aiTags: true,
        aiSummary: true,
        moderationStatus: true,
        slotClip: {
          select: {
            aiSummary: true,
          },
        },
      },
    });

    type ChunkWithAiData = (typeof chunks)[number];

    const chunkById = new Map<string, ChunkWithAiData>(
      chunks.map((chunk: ChunkWithAiData) => [chunk.id, chunk])
    );
    const orderedChunks: ChunkWithAiData[] = batchChunkIds
      .map((id) => chunkById.get(id))
      .filter((chunk): chunk is ChunkWithAiData => chunk !== undefined);

    if (!orderedChunks.length) {
      throw new Error('No chunk AI data found for embedding batch');
    }

    const embeddingTargets = orderedChunks
      .filter((chunk) => {
        const hasAiData =
          !!chunk?.aiSummary || (chunk?.aiTags && chunk.aiTags.length > 0);
        if (!hasAiData) {
          if (chunk?.id === chunkId) {
            throw new Error(`BrollChunk ${chunkId} has no AI enrichment data`);
          }
          return false;
        }
        return true;
      })
      .map((chunk) => {
        const embeddingText = createEmbeddingText(
          chunk.aiSummary,
          chunk.aiTags || [],
          chunk.slotClip?.aiSummary ?? null
        );
        return { id: chunk.id, chunkIndex: chunk.chunkIndex, embeddingText };
      });

    if (embeddingTargets.length === 0) {
      throw new Error('No valid chunk embeddings to process');
    }

    // Step 3: Generate OpenAI embeddings (30-70%)
    await updateProgress(jobId, 'analyzing', 30, 'Generating OpenAI embeddings');

    logger.info(
      `Calling OpenAI embeddings API for ${embeddingTargets.length} chunks (batch)`
    );

    const openai = new OpenAI({ apiKey: config.openai.apiKey });
    await usageService.recordUsage(userId, {
      openAiEmbeddingCalls: 1,
      brollChunkEmbeddingCalls: 1,
    });

    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-large',
      input: embeddingTargets.map((target) => target.embeddingText),
    });

    if (embeddingResponse.data.length !== embeddingTargets.length) {
      throw new Error('Embedding response length mismatch');
    }

    await updateProgress(jobId, 'analyzing', 70, 'Embedding generated');

    // Step 4: Store embeddings (80%)
    await updateProgress(jobId, 'processing', 80, 'Storing embeddings in database');

    for (let i = 0; i < embeddingTargets.length; i += 1) {
      const target = embeddingTargets[i]!;
      const embedding = embeddingResponse.data[i]?.embedding;

      if (!embedding) {
        throw new Error(`Failed to generate embedding for chunk ${target.id}`);
      }

      const embeddingVector = `[${embedding.join(',')}]`;

      await prisma.$executeRaw`
        UPDATE "BrollChunk"
        SET 
          embedding = ${embeddingVector}::vector,
          "embeddingText" = ${target.embeddingText},
          "updatedAt" = NOW()
        WHERE id = ${target.id}
      `;
    }

    logger.info(`Stored embeddings for ${embeddingTargets.length} chunks`);

    // Step 5: Complete job (100%)
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: 'done',
        stage: 'done',
        progress: 100,
        outputData: {
          embeddedChunks: embeddingTargets.length,
          embeddingDimensions: embeddingResponse.data[0]?.embedding?.length ?? 0,
        },
      },
    });

    await progressPublisher.publish(
      jobId,
      'done',
      'done',
      100,
      `Chunk embedding complete (${embeddingTargets.length} chunks)`
    );

    // Step 6: Check if all chunks for episode are complete and trigger semantic matching.
    // This is best-effort and must not fail a completed embedding job.
    try {
      await checkAndTriggerSemanticMatching(episodeId, userId, {
        forceMatching: Boolean(isRefinement),
      });
    } catch (triggerError) {
      logger.error(
        `Chunk embedding job ${jobId}: post-embedding readiness trigger failed (non-fatal)`,
        triggerError
      );
    }

    logger.info(`Chunk embedding job ${jobId} completed successfully`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`Chunk embedding job ${jobId} failed:`, error);

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

/**
 * Create stable embedding text from AI summary, tags, and optional slot clip summary.
 */
function createEmbeddingText(
  aiSummary: string | null,
  aiTags: string[],
  clipSummary: string | null = null
): string {
  const parts: string[] = [];

  if (aiSummary) {
    parts.push(`Summary: ${aiSummary}`);
  }

  if (aiTags && aiTags.length > 0) {
    parts.push(`Tags: ${aiTags.join(', ')}`);
  }

  if (clipSummary) {
    parts.push(`ClipSummary: ${clipSummary}`);
  }

  return parts.join('\n');
}

async function getBatchChunkIds(
  episodeId: string,
  requestedChunkIds: string[]
): Promise<string[]> {
  const existing = new Set(requestedChunkIds.filter(Boolean));

  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM "BrollChunk"
    WHERE "episodeId" = ${episodeId}
      AND embedding IS NULL
      AND (
        "aiSummary" IS NOT NULL
        OR ( "aiTags" IS NOT NULL AND array_length("aiTags", 1) > 0 )
      )
      AND "moderationStatus" = 'safe'
    ORDER BY "updatedAt" ASC
    LIMIT ${EMBEDDING_BATCH_SIZE}
  `;

  for (const row of rows) {
    existing.add(row.id);
  }

  return Array.from(existing).slice(0, EMBEDDING_BATCH_SIZE);
}

/**
 * Check if all chunks for episode are complete and trigger semantic matching
 * Also checks if cut_plan_generation can be triggered if semantic matching is already done
 * PHASE 4 FIX: Use centralized readiness check to prevent race conditions
 */
async function checkAndTriggerSemanticMatching(
  episodeId: string,
  userId: string,
  options?: { forceMatching?: boolean }
): Promise<void> {
  // Use centralized readiness check service
  const {
    triggerSemanticMatchingSafely,
    triggerCutPlanGenerationSafely,
  } = await import('../services/episodeReadiness.js');

  // Check if semantic matching is already complete
  const semanticMatchingJob = await prisma.job.findFirst({
    where: {
      episodeId,
      type: 'semantic_matching',
      status: 'done',
    },
    orderBy: { updatedAt: 'desc' },
  });

  const latestChunkEmbeddingJob = await prisma.job.findFirst({
    where: {
      episodeId,
      type: 'broll_chunk_embedding',
      status: 'done',
    },
    orderBy: { updatedAt: 'desc' },
    select: {
      updatedAt: true,
    },
  });

  const hasNewChunksSinceMatching =
    semanticMatchingJob !== null &&
    latestChunkEmbeddingJob !== null &&
    latestChunkEmbeddingJob.updatedAt.getTime() > semanticMatchingJob.updatedAt.getTime();

  if (semanticMatchingJob && (options?.forceMatching || hasNewChunksSinceMatching)) {
    const result = await triggerSemanticMatchingSafely(episodeId, userId, {
      force: true,
      reason: hasNewChunksSinceMatching ? 'new_chunks_embedded' : 'chunk_refinement',
    });

    if (result.triggered) {
      logger.info(
        `Episode ${episodeId}: Re-triggered semantic matching ${result.jobId} after chunk updates`
      );
    } else {
      logger.debug(
        `Episode ${episodeId}: Cannot re-trigger semantic matching: ${result.reason}`
      );
    }
  } else if (semanticMatchingJob) {
    // Semantic matching is already done - check if we can trigger cut_plan_generation
    logger.info(
      `Episode ${episodeId}: Semantic matching already complete, checking if cut_plan_generation can be triggered`
    );

    const cutPlanResult = await triggerCutPlanGenerationSafely(episodeId, userId, {
      triggeredBy: 'chunk_embedding_complete',
    });

    if (cutPlanResult.triggered) {
      logger.info(
        `Episode ${episodeId}: Triggered cut_plan_generation job ${cutPlanResult.jobId} after chunks completed`
      );
    } else {
      logger.debug(
        `Episode ${episodeId}: Cannot trigger cut_plan_generation: ${cutPlanResult.reason}`
      );
    }
  } else {
    // Semantic matching not done yet - trigger it
    const result = await triggerSemanticMatchingSafely(episodeId, userId);

    if (result.triggered) {
      logger.info(
        `Episode ${episodeId} ready for semantic matching! Triggered job ${result.jobId}`
      );
    } else {
      logger.debug(
        `Episode ${episodeId} not ready for semantic matching: ${result.reason}`
      );
    }
  }

  // Phase 5.1: Wake up render orchestrator to check if any episodes are now eligible for render
  try {
    const { renderOrchestrator } = await import('../services/renderOrchestrator.js');
    await renderOrchestrator.wakeUp();
  } catch (error) {
    // Log but don't fail - orchestrator wake-up is non-critical
    logger.debug(`Failed to wake up render orchestrator after chunk embedding: ${error}`);
  }
}
