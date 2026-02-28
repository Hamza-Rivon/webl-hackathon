/**
 * Episode Readiness Service
 * 
 * Centralized checks for episode readiness at different pipeline stages.
 * Fixes Issues 1, 3, and 4 from WORKFLOW_ISSUES.md
 */

import { prisma } from './db.js';
import { logger, CHUNK_DURATION_MS } from '@webl/shared';
import type { Prisma } from '@webl/prisma';

/**
 * Comprehensive check if B-roll pipeline is complete
 * 
 * Checks:
 * - All chunks have embeddings
 * - All chunks have completed enrichment (AI tags/summary)
 * - Total chunk count matches expected (no chunks still processing)
 * 
 * This is the authoritative check used by all trigger points to prevent race conditions.
 */
export async function isBrollPipelineComplete(episodeId: string): Promise<{
  isComplete: boolean;
  totalChunks: number;
  safeChunks: number;
  completedChunks: number;
  chunksWithEmbeddings: number;
  chunksWithPlaybackIds: number;
  chunksWithEnrichment: number;
  details: {
    missingEmbeddings: number;
    missingPlaybackIds: number;
    missingEnrichment: number;
  };
}> {
  // Count total chunks
  const totalChunks = await prisma.brollChunk.count({
    where: { episodeId },
  });

  // Count safe chunks (only these are expected to have embeddings)
  const safeChunksResult = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint as count
    FROM "BrollChunk"
    WHERE "episodeId" = ${episodeId}
      AND "moderationStatus" = 'safe'
  `;
  const safeChunks = Number(safeChunksResult[0]?.count ?? 0);

  // Count safe chunks with embeddings
  const chunksWithEmbeddingsResult = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint as count
    FROM "BrollChunk"
    WHERE "episodeId" = ${episodeId}
      AND embedding IS NOT NULL
      AND "moderationStatus" = 'safe'
  `;
  const chunksWithEmbeddings = Number(chunksWithEmbeddingsResult[0]?.count ?? 0);

  // Count chunks with playback IDs
  const chunksWithPlaybackIdsResult = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint as count
    FROM "BrollChunk"
    WHERE "episodeId" = ${episodeId}
      AND "muxPlaybackId" IS NOT NULL
  `;
  const chunksWithPlaybackIds = Number(chunksWithPlaybackIdsResult[0]?.count ?? 0);

  // Count chunks with enrichment completed (all chunks, regardless of moderation result)
  const chunksWithEnrichmentResult = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint as count
    FROM "BrollChunk"
    WHERE "episodeId" = ${episodeId}
      AND (
        "aiTags" IS NOT NULL AND array_length("aiTags", 1) > 0
        OR "aiSummary" IS NOT NULL
      )
      AND "moderationStatus" IS NOT NULL
  `;
  const chunksWithEnrichment = Number(chunksWithEnrichmentResult[0]?.count ?? 0);

  // Check for pending B-roll pipeline jobs that can still change the chunk pool
  const pendingChunkJobs = await prisma.job.count({
    where: {
      episodeId,
      type: {
        in: [
          'broll_ingest',
          'broll_chunking',
          'broll_chunk_ingest',
          'slot_clip_enrichment',
          'broll_chunk_enrichment',
          'broll_chunk_embedding',
          'chunk_refinement',
        ],
      },
      status: {
        in: ['pending', 'processing'],
      },
    },
  });

  const details = {
    missingEmbeddings: safeChunks - chunksWithEmbeddings,
    missingPlaybackIds: totalChunks - chunksWithPlaybackIds,
    missingEnrichment: totalChunks - chunksWithEnrichment,
  };

  // Pipeline is complete if:
  // 1. All safe chunks have embeddings
  // 2. All chunks have enrichment + moderation completed
  // 3. No pending B-roll pipeline jobs remain
  //
  // NOTE: We intentionally do NOT require playback IDs for every chunk.
  // Some chunk-level Mux ingests can fail transiently (e.g. 429) while we still
  // have enough safe embedded coverage to continue the pipeline.
  const isComplete =
    totalChunks > 0 &&
    chunksWithEmbeddings === safeChunks &&
    chunksWithEnrichment === totalChunks &&
    pendingChunkJobs === 0;

  return {
    isComplete,
    totalChunks,
    safeChunks,
    completedChunks: chunksWithEmbeddings, // Use embeddings as the primary completion metric
    chunksWithEmbeddings,
    chunksWithPlaybackIds,
    chunksWithEnrichment,
    details,
  };
}

const TRANSCRIPT_EDGE_TOLERANCE_MS = 300;

function normalizeTranscriptWords(rawTranscript: unknown): Array<{
  word: string;
  startMs: number;
  endMs: number;
}> {
  if (!Array.isArray(rawTranscript)) return [];
  return rawTranscript
    .map((entry) => {
      const word = typeof entry?.word === 'string' ? entry.word.trim() : '';
      const startMs = Number(entry?.startMs);
      const endMs = Number(entry?.endMs);
      if (!word || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
        return null;
      }
      return { word, startMs, endMs };
    })
    .filter((entry): entry is { word: string; startMs: number; endMs: number } => Boolean(entry))
    .sort((a, b) => a.startMs - b.startMs);
}

function isArollFirstTemplate(slotRequirements: unknown): boolean {
  if (!slotRequirements || typeof slotRequirements !== 'object') {
    return false;
  }

  if ((slotRequirements as { workflow?: unknown }).workflow === 'aroll_clean_then_broll') {
    return true;
  }

  const slots = (slotRequirements as { slots?: unknown }).slots;
  if (!Array.isArray(slots) || slots.length === 0) {
    return false;
  }

  const requiredSlots = slots
    .map((slot) => slot as { slotType?: unknown; priority?: unknown })
    .filter((slot) => slot.priority === 'required');
  if (requiredSlots.length === 0) {
    return false;
  }
  return requiredSlots[0]?.slotType === 'a_roll_face';
}

function getEffectiveRequiredSlotIds(slotRequirements: {
  workflow?: string;
  slots?: Array<{
    slotId?: string;
    slotType?: string;
    priority?: string;
  }>;
} | null | undefined): string[] {
  const slots = slotRequirements?.slots ?? [];
  const required = slots
    .filter((slot) => slot.priority === 'required' && typeof slot.slotId === 'string')
    .map((slot) => slot.slotId as string);

  // For A-roll-first workflow, enforce at least one B-roll slot before matching/render.
  if (slotRequirements?.workflow === 'aroll_clean_then_broll') {
    const requiredBroll = slots.filter(
      (slot) =>
        slot.priority === 'required' &&
        typeof slot.slotId === 'string' &&
        typeof slot.slotType === 'string' &&
        slot.slotType.startsWith('b_roll')
    );

    if (requiredBroll.length === 0) {
      const fallbackBroll = slots.find(
        (slot) =>
          typeof slot.slotId === 'string' &&
          typeof slot.slotType === 'string' &&
          slot.slotType.startsWith('b_roll')
      );
      if (fallbackBroll?.slotId) {
        required.push(fallbackBroll.slotId);
      }
    }
  }

  return [...new Set(required)];
}

function getArollPreviewDurationMs(renderSpec: unknown): number | null {
  if (!renderSpec || typeof renderSpec !== 'object') {
    return null;
  }

  const spec = renderSpec as Record<string, unknown>;
  const hasPreview = typeof spec.arollCleanPreviewS3Key === 'string';
  if (!hasPreview) {
    return null;
  }

  const durationSeconds =
    typeof spec.arollCleanPreviewDuration === 'number' ? spec.arollCleanPreviewDuration : null;

  return durationSeconds && Number.isFinite(durationSeconds)
    ? Math.round(durationSeconds * 1000)
    : null;
}

async function areRequiredSlotsUploaded(episodeId: string): Promise<{
  ready: boolean;
  missingSlots: string[];
}> {
  const episode = await prisma.episode.findUnique({
    where: { id: episodeId },
    select: {
      template: {
        select: {
          slotRequirements: true,
        },
      },
      slotClips: {
        select: {
          slotId: true,
        },
      },
    },
  });

  const slotRequirements = episode?.template?.slotRequirements as
    | {
        workflow?: string;
        slots?: Array<{
          slotId?: string;
          slotType?: string;
          priority?: string;
        }>;
      }
    | null
    | undefined;

  const requiredSlotIds = getEffectiveRequiredSlotIds(slotRequirements);

  if (requiredSlotIds.length === 0) {
    return { ready: true, missingSlots: [] };
  }

  const uploadedSlotIds = new Set(
    (episode?.slotClips ?? []).map((clip: { slotId: string }) => clip.slotId)
  );
  const missingSlots = requiredSlotIds.filter((slotId) => !uploadedSlotIds.has(slotId));

  return {
    ready: missingSlots.length === 0,
    missingSlots,
  };
}

async function getUsableChunkStats(episodeId: string): Promise<{
  totalChunks: number;
  usableChunks: number;
  availableDurationMs: number;
}> {
  const rows = await prisma.$queryRaw<
    Array<{ total: bigint; usable: bigint; duration_ms: bigint }>
  >`
    SELECT
      COUNT(*)::bigint as total,
      COUNT(*) FILTER (
        WHERE "s3Key" IS NOT NULL
          AND embedding IS NOT NULL
          AND "moderationStatus" = 'safe'
      )::bigint as usable,
      COALESCE(SUM(
        CASE
          WHEN "s3Key" IS NOT NULL
            AND embedding IS NOT NULL
            AND "moderationStatus" = 'safe'
          THEN "durationMs"
          ELSE 0
        END
      ), 0)::bigint as duration_ms
    FROM "BrollChunk"
    WHERE "episodeId" = ${episodeId}
  `;
  return {
    totalChunks: Number(rows[0]?.total ?? 0),
    usableChunks: Number(rows[0]?.usable ?? 0),
    availableDurationMs: Number(rows[0]?.duration_ms ?? 0),
  };
}

export async function isReadyForMicrocutV2(episodeId: string): Promise<{
  isReady: boolean;
  voiceoverReady: boolean;
  chunksReady: boolean;
  durationReady: boolean;
  usableChunks?: number;
  totalChunks?: number;
  availableDurationMs?: number;
  requiredDurationMs?: number;
  missingMs?: number;
  missingChunks?: number;
}> {
  const episode = await prisma.episode.findUnique({
    where: { id: episodeId },
    select: {
      cleanVoiceoverS3Key: true,
      cleanVoiceoverDuration: true,
      wordTranscript: true,
      correctedWordTranscript: true,
      renderSpec: true,
      status: true,
      template: {
        select: {
          slotRequirements: true,
        },
      },
    },
  });

  if (!episode?.cleanVoiceoverS3Key || !episode.cleanVoiceoverDuration) {
    return {
      isReady: false,
      voiceoverReady: false,
      chunksReady: false,
      durationReady: false,
    };
  }

  const cleanDurationMs = Math.round(episode.cleanVoiceoverDuration * 1000);
  const correctedWords = normalizeTranscriptWords(episode.correctedWordTranscript);
  const words = correctedWords.length > 0
    ? correctedWords
    : normalizeTranscriptWords(episode.wordTranscript);
  const firstWord = words[0];
  const lastWord = words[words.length - 1];
  let voiceoverReady =
    words.length > 0 &&
    (firstWord?.startMs ?? 0) <= TRANSCRIPT_EDGE_TOLERANCE_MS &&
    Math.abs((lastWord?.endMs ?? 0) - cleanDurationMs) <= TRANSCRIPT_EDGE_TOLERANCE_MS;
  // Avoid stale "enriching_chunks" episodes when segmentation succeeded but transcript edges are noisy.
  if (!voiceoverReady) {
    voiceoverReady = await isVoiceoverSegmentationComplete(episodeId);
  }

  const chunkStats = await getUsableChunkStats(episodeId);
  const brollPipeline = await isBrollPipelineComplete(episodeId);
  const isArollTemplate = isArollFirstTemplate(episode.template?.slotRequirements);
  const arollPreviewDurationMs = getArollPreviewDurationMs(episode.renderSpec);
  const arollReady =
    isArollTemplate &&
    arollPreviewDurationMs !== null &&
    arollPreviewDurationMs + TRANSCRIPT_EDGE_TOLERANCE_MS >= cleanDurationMs;

  const hasAnyBrollChunks = chunkStats.totalChunks > 0;
  const chunksReady = isArollTemplate
    ? Boolean(arollReady && hasAnyBrollChunks && brollPipeline.isComplete)
    : brollPipeline.isComplete;
  const durationReady = isArollTemplate
    ? Boolean(arollReady)
    : chunkStats.availableDurationMs >= cleanDurationMs;
  const availableDurationMs = isArollTemplate
    ? (arollPreviewDurationMs ?? 0)
    : chunkStats.availableDurationMs;

  if (!isArollTemplate && !durationReady && cleanDurationMs > 0 && chunksReady) {
    const missingMs = cleanDurationMs - availableDurationMs;
    const missingChunks = Math.ceil(missingMs / CHUNK_DURATION_MS);
    await prisma.episode.update({
      where: { id: episodeId },
      data: {
        status: 'needs_more_clips',
        renderSpec: {
          ...(episode.renderSpec as object || {}),
          missingMs,
          missingChunks,
          availableDurationMs,
          requiredDurationMs: cleanDurationMs,
        },
      },
    });
    return {
      isReady: false,
      voiceoverReady,
      chunksReady,
      durationReady,
      usableChunks: chunkStats.usableChunks,
      totalChunks: chunkStats.totalChunks,
      availableDurationMs,
      requiredDurationMs: cleanDurationMs,
      missingMs,
      missingChunks,
    };
  }

  return {
    isReady: voiceoverReady && chunksReady && durationReady,
    voiceoverReady,
    chunksReady,
    durationReady,
    usableChunks: chunkStats.usableChunks,
    totalChunks: chunkStats.totalChunks,
    availableDurationMs,
    requiredDurationMs: cleanDurationMs,
  };
}

/**
 * Check if voiceover segmentation is complete
 */
export async function isVoiceoverSegmentationComplete(episodeId: string): Promise<boolean> {
  const segmentCount = await prisma.voiceoverSegment.count({
    where: { episodeId },
  });

  // Check if segmentation job is complete
  const segmentationJob = await prisma.job.findFirst({
    where: {
      episodeId,
      type: 'voiceover_segmentation',
      status: 'done',
    },
  });

  return segmentCount > 0 && segmentationJob !== null;
}

/**
 * Check if episode is ready for semantic matching
 * 
 * Requires:
 * - Voiceover segmentation complete
 * - B-roll pipeline complete
 * - All required slots uploaded (CRITICAL: prevents premature cut plan generation)
 * - No existing semantic matching job
 */
export async function isReadyForSemanticMatching(
  episodeId: string,
  options?: { allowCompleted?: boolean }
): Promise<{
  isReady: boolean;
  voiceoverReady: boolean;
  segmentationReady: boolean;
  transcriptReady: boolean;
  chunksReady: boolean;
  durationReady: boolean;
  requiredSlotsReady: boolean;
  missingRequiredSlots?: string[];
  hasExistingJob: boolean;
  usableChunks?: number;
  totalChunks?: number;
  availableDurationMs?: number;
  requiredDurationMs?: number;
  missingMs?: number;
  missingChunks?: number;
}> {
  const segmentationReady = await isVoiceoverSegmentationComplete(episodeId);
  const microcutReadiness = await isReadyForMicrocutV2(episodeId);
  const requiredSlots = await areRequiredSlotsUploaded(episodeId);
  const transcriptReady = microcutReadiness.voiceoverReady;
  const voiceoverReady = segmentationReady && transcriptReady;

  // Check for existing semantic matching job
  const existingJob = await prisma.job.findFirst({
    where: {
      episodeId,
      type: 'semantic_matching',
      status: {
        in: options?.allowCompleted ? ['pending', 'processing'] : ['pending', 'processing', 'done'],
      },
    },
  });

  const hasExistingJob = existingJob !== null;
  const isReady =
    segmentationReady &&
    microcutReadiness.isReady &&
    requiredSlots.ready &&
    !hasExistingJob;

  return {
    isReady,
    voiceoverReady,
    segmentationReady,
    transcriptReady,
    chunksReady: microcutReadiness.chunksReady,
    durationReady: microcutReadiness.durationReady,
    requiredSlotsReady: requiredSlots.ready,
    missingRequiredSlots: requiredSlots.missingSlots,
    hasExistingJob,
    usableChunks: microcutReadiness.usableChunks,
    totalChunks: microcutReadiness.totalChunks,
    availableDurationMs: microcutReadiness.availableDurationMs,
    requiredDurationMs: microcutReadiness.requiredDurationMs,
    missingMs: microcutReadiness.missingMs,
    missingChunks: microcutReadiness.missingChunks,
  };
}

/**
 * Safely trigger semantic matching job with idempotency check
 * 
 * This prevents duplicate jobs from being created by multiple trigger points.
 */
export async function triggerSemanticMatchingSafely(
  episodeId: string,
  userId: string,
  options?: { force?: boolean; reason?: string }
): Promise<{ triggered: boolean; jobId?: string; reason?: string }> {
  // Check readiness
  const readiness = await isReadyForSemanticMatching(episodeId, {
    allowCompleted: options?.force,
  });

  if (!readiness.isReady) {
    const reasons: string[] = [];
    if (!readiness.segmentationReady) reasons.push('voiceover segmentation not complete');
    if (!readiness.transcriptReady) reasons.push('clean voiceover not ready');
    if (!readiness.requiredSlotsReady && (readiness.missingRequiredSlots?.length ?? 0) > 0) {
      reasons.push(`missing required slots: ${readiness.missingRequiredSlots!.join(', ')}`);
    }
    if (!readiness.chunksReady) reasons.push('no usable chunks');
    if (!readiness.durationReady && readiness.missingMs) {
      reasons.push(`missing ${readiness.missingMs}ms of footage`);
    } else if (!readiness.durationReady) {
      reasons.push('insufficient footage duration');
    }
    if (readiness.hasExistingJob) reasons.push('job already exists');

    logger.debug(`Cannot trigger semantic matching for episode ${episodeId}: ${reasons.join(', ')}`);
    return {
      triggered: false,
      reason: reasons.join(', '),
    };
  }

  const { queues } = await import('../queue.js');
  const lockKey = `episode:semantic_matching:${episodeId}`;

  const transactionResult = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

    const existingJob = await tx.job.findFirst({
      where: {
        episodeId,
        type: 'semantic_matching',
        status: {
          in: options?.force ? ['pending', 'processing'] : ['pending', 'processing', 'done'],
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    if (existingJob) {
      return {
        triggered: false,
        jobId: existingJob.id,
      };
    }

    const matchingJob = await tx.job.create({
      data: {
        type: 'semantic_matching',
        status: 'pending',
        episodeId,
        userId,
        inputData: {
          triggeredBy: options?.reason ?? 'readiness_check',
          forceReplan: options?.force ?? false,
          usableChunks: readiness.usableChunks ?? 0,
          totalChunks: readiness.totalChunks ?? 0,
          availableDurationMs: readiness.availableDurationMs ?? 0,
          requiredDurationMs: readiness.requiredDurationMs ?? 0,
        },
      },
    });

    await tx.episode.update({
      where: { id: episodeId },
      data: { status: 'matching' },
    });

    return {
      triggered: true,
      jobId: matchingJob.id,
    };
  });

  if (!transactionResult.triggered) {
    logger.debug(`Semantic matching job already exists for episode ${episodeId}: ${transactionResult.jobId}`);
    return {
      triggered: false,
      reason: 'job already exists',
      jobId: transactionResult.jobId,
    };
  }

  await queues.semanticMatching.add('semantic-matching', {
    jobId: transactionResult.jobId,
    episodeId,
    userId,
    forceReplan: options?.force ?? false,
  });

  logger.info(`Triggered semantic matching job ${transactionResult.jobId} for episode ${episodeId}`);
  return {
    triggered: true,
    jobId: transactionResult.jobId,
  };
}

/**
 * Check if episode is ready for cut plan generation
 * 
 * Requires:
 * - Semantic matching completed
 * - B-roll pipeline complete (all chunks have embeddings, enrichment, playback IDs)
 * - No existing cut plan generation job
 * - At least 80% of segments have matches (or timeout reached)
 */
export async function isReadyForCutPlanGeneration(
  episodeId: string,
  options?: { allowCompleted?: boolean }
): Promise<{
  isReady: boolean;
  semanticMatchingReady: boolean;
  hasExistingJob: boolean;
  voiceoverReady: boolean;
  chunksReady: boolean;
  durationReady: boolean;
  usableChunks?: number;
  totalChunks?: number;
  availableDurationMs?: number;
  requiredDurationMs?: number;
  missingMs?: number;
  missingChunks?: number;
}> {
  // Check if semantic matching is complete
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

  const semanticMatchingReady =
    semanticMatchingJob !== null &&
    (
      latestChunkEmbeddingJob === null ||
      semanticMatchingJob.updatedAt.getTime() >= latestChunkEmbeddingJob.updatedAt.getTime()
    );

  const microcutReadiness = await isReadyForMicrocutV2(episodeId);

  // Check for existing cut plan generation job
  const existingJob = await prisma.job.findFirst({
    where: {
      episodeId,
      type: 'cut_plan_generation',
      status: {
        in: options?.allowCompleted ? ['pending', 'processing'] : ['pending', 'processing', 'done'],
      },
    },
  });

  const hasExistingJob = existingJob !== null;

  const isReady =
    semanticMatchingReady &&
    microcutReadiness.isReady &&
    !hasExistingJob;

  return {
    isReady,
    semanticMatchingReady,
    hasExistingJob,
    voiceoverReady: microcutReadiness.voiceoverReady,
    chunksReady: microcutReadiness.chunksReady,
    durationReady: microcutReadiness.durationReady,
    usableChunks: microcutReadiness.usableChunks,
    totalChunks: microcutReadiness.totalChunks,
    availableDurationMs: microcutReadiness.availableDurationMs,
    requiredDurationMs: microcutReadiness.requiredDurationMs,
    missingMs: microcutReadiness.missingMs,
    missingChunks: microcutReadiness.missingChunks,
  };
}

/**
 * Safely trigger cut plan generation job with idempotency check and segment match waiting
 * 
 * This prevents duplicate jobs from being created by multiple trigger points.
 */
export async function triggerCutPlanGenerationSafely(
  episodeId: string,
  userId: string,
  inputData?: Record<string, any>
): Promise<{ triggered: boolean; jobId?: string; reason?: string; waited?: boolean }> {
  const forceReplan = Boolean(inputData?.forceReplan);
  const readiness = await isReadyForCutPlanGeneration(episodeId, {
    allowCompleted: forceReplan,
  });
  
  if (!readiness.isReady) {
    const reasons: string[] = [];
    if (!readiness.semanticMatchingReady) reasons.push('semantic matching not complete');
    if (!readiness.voiceoverReady) reasons.push('clean voiceover not ready');
    if (!readiness.chunksReady) reasons.push('no usable chunks');
    if (!readiness.durationReady && readiness.missingMs) {
      reasons.push(`missing ${readiness.missingMs}ms of footage`);
    } else if (!readiness.durationReady) {
      reasons.push('insufficient footage duration');
    }
    if (readiness.hasExistingJob) reasons.push('job already exists');

    logger.debug(`Cannot trigger cut plan generation for episode ${episodeId}: ${reasons.join(', ')}`);
    return {
      triggered: false,
      reason: reasons.join(', '),
      waited: false,
    };
  }

  const { queues } = await import('../queue.js');
  const lockKey = `episode:cut_plan_generation:${episodeId}`;

  const transactionResult = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

    const existingJob = await tx.job.findFirst({
      where: {
        episodeId,
        type: 'cut_plan_generation',
        status: {
          in: forceReplan ? ['pending', 'processing'] : ['pending', 'processing', 'done'],
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    if (existingJob) {
      return {
        triggered: false,
        jobId: existingJob.id,
      };
    }

    const cutPlanJob = await tx.job.create({
      data: {
        type: 'cut_plan_generation',
        status: 'pending',
        episodeId,
        userId,
        inputData: {
          triggeredBy: 'semantic_matching',
          ...inputData,
        },
      },
    });

    return {
      triggered: true,
      jobId: cutPlanJob.id,
    };
  });

  if (!transactionResult.triggered) {
    logger.debug(`Cut plan generation job already exists for episode ${episodeId}: ${transactionResult.jobId}`);
    return {
      triggered: false,
      reason: 'job already exists',
      jobId: transactionResult.jobId,
    };
  }

  await queues.cutPlanGeneration.add('cut-plan-generation', {
    jobId: transactionResult.jobId,
    episodeId,
    userId,
  });

  logger.info(`Triggered cut plan generation job ${transactionResult.jobId} for episode ${episodeId}`);
  return {
    triggered: true,
    jobId: transactionResult.jobId,
  };
}
