/**
 * Phase 3.1: Semantic Matching Job
 *
 * Purpose: Build per-unit candidate lists using deterministic scoring.
 *
 * Pipeline Position: After voiceover_segmentation AND broll_chunk_embedding
 * Dependencies: Units + chunk embeddings ready
 * Triggers: creative_edit_plan -> cut_plan_generation
 */

import { Job } from 'bullmq';
import { prisma } from '../services/db.js';
import { progressPublisher } from '../services/progress.js';
import { logger } from '@webl/shared';
import { triggerCutPlanGenerationSafely } from '../services/episodeReadiness.js';
import { queues } from '../queue.js';

// ==================== TYPES ====================

interface SemanticMatchingJobData {
  jobId: string;
  episodeId: string;
  userId: string;
  forceReplan?: boolean;
}

interface VoiceoverUnitRow {
  id: string;
  segmentIndex: number;
  startMs: number;
  endMs: number;
  durationMs: number;
  keywords: string[];
  emotionalTone: string | null;
}

interface ChunkCandidateRow {
  chunk_id: string;
  slot_clip_id: string;
  chunk_index: number;
  start_ms: number;
  end_ms: number;
  duration_ms: number;
  s3_key: string | null;
  ai_tags: string[];
  ai_summary: string | null;
  similarity: number;
}

interface ScoredCandidate {
  chunkId: string;
  slotClipId: string;
  chunkIndex: number;
  durationMs: number;
  s3Key: string | null;
  aiTags: string[];
  aiSummary: string | null;
  semanticScore: number;
  keywordScore: number;
  continuityScore: number;
  totalScore: number;
}

// ==================== CONSTANTS ====================

const TOP_K = 40;
const WEIGHTS = {
  semantic: 0.7,
  keyword: 0.25,
  continuity: 0.05,
} as const;

// ==================== JOB PROCESSOR ====================

export async function processSemanticMatching(
  bullJob: Job<SemanticMatchingJobData>
): Promise<void> {
  const { jobId, episodeId, userId } = bullJob.data;

  logger.info(`[Phase 3.1] Starting semantic matching job ${jobId}`, {
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
      'Starting semantic matching'
    );

    await updateProgress(jobId, 'processing', 10, 'Loading voiceover units');

    const units = await prisma.voiceoverSegment.findMany({
      where: { episodeId },
      select: {
        id: true,
        segmentIndex: true,
        startMs: true,
        endMs: true,
        durationMs: true,
        keywords: true,
        emotionalTone: true,
      },
      orderBy: { segmentIndex: 'asc' },
    });

    if (units.length === 0) {
      throw new Error(`No voiceover units found for episode ${episodeId}`);
    }
    logger.info('[Phase 3.1] RECEIVED: voiceover units for matching', {
      episodeId,
      unitCount: units.length,
      firstUnit: units[0]?.segmentIndex ?? null,
      lastUnit: units[units.length - 1]?.segmentIndex ?? null,
    });

    await updateProgress(jobId, 'processing', 30, 'Scoring candidates');

    let previousSlotClipId: string | null = null;
    let matchedCount = 0;
    let totalTopScore = 0;

    for (let i = 0; i < units.length; i += 1) {
      const unit = units[i] as VoiceoverUnitRow;
      const candidates = await findCandidatesForUnit(episodeId, unit.id, unit.durationMs);
      const scored = scoreCandidates(unit, candidates, previousSlotClipId);

      const sorted = scored.sort((a, b) => b.totalScore - a.totalScore).slice(0, TOP_K);

      if (sorted.length > 0) {
        matchedCount += 1;
        totalTopScore += sorted[0]!.totalScore;
        previousSlotClipId = sorted[0]!.slotClipId;
      }

      await prisma.voiceoverSegment.update({
        where: { id: unit.id },
        data: {
          metadata: {
            candidates: sorted.map((candidate) => ({
              chunkId: candidate.chunkId,
              totalScore: candidate.totalScore,
              semanticScore: candidate.semanticScore,
              keywordScore: candidate.keywordScore,
              continuityScore: candidate.continuityScore,
            })),
          },
          matchedChunkId: sorted[0]?.chunkId ?? null,
          matchScore: sorted[0]?.totalScore ?? null,
        },
      });
    }

    const coverage = matchedCount / units.length;
    const avgScore = matchedCount > 0 ? totalTopScore / matchedCount : 0;

    await prisma.episode.update({
      where: { id: episodeId },
      data: {
        matchCoverage: coverage,
        averageMatchScore: avgScore,
        status: 'matching',
      },
    });
    logger.info('[Phase 3.1] STORED: episode matching metrics', {
      episodeId,
      matchedCount,
      unitCount: units.length,
      coverage,
      averageMatchScore: avgScore,
    });

    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: 'done',
        stage: 'done',
        progress: 100,
        outputData: {
          unitCount: units.length,
          matchedCount,
          coverage,
          averageMatchScore: avgScore,
        },
      },
    });

    await progressPublisher.publish(
      jobId,
      'done',
      'done',
      100,
      `Semantic matching complete (${matchedCount}/${units.length})`
    );

    // Trigger Creative Edit Plan (LLM-powered Creative Director)
    // This produces an intelligent edit brief, then triggers cut_plan_generation.
    // If creative_edit_plan fails, it falls back to mechanical policy automatically.
    try {
      const creativeJobRecord = await prisma.job.create({
        data: {
          type: 'creative_edit_plan' as any,
          status: 'pending',
          stage: 'starting',
          progress: 0,
          episodeId,
          userId,
          inputData: { triggeredBy: 'semantic_matching' },
        },
      });

      await queues.creativeEditPlan.add('creative-edit-plan', {
        jobId: creativeJobRecord.id,
        episodeId,
        userId,
        triggeredBy: 'semantic_matching',
        forceReplan: bullJob.data.forceReplan,
      });

      logger.info(
        `[Phase 3.1] Creative edit plan triggered for episode ${episodeId} (job: ${creativeJobRecord.id})`,
      );
    } catch (creativeError) {
      // If creative edit plan queue fails, fall back to direct cut plan generation
      logger.warn(
        `[Phase 3.1] Failed to trigger creative edit plan, falling back to direct cut plan: ${creativeError}`,
      );
      const triggerResult = await triggerCutPlanGenerationSafely(episodeId, userId, {
        triggeredBy: 'semantic_matching',
        forceReplan: bullJob.data.forceReplan,
      });

      if (!triggerResult.triggered) {
        logger.info(
          `[Phase 3.1] Cut plan generation not triggered: ${triggerResult.reason}`,
        );
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`[Phase 3.1] Semantic matching job ${jobId} failed:`, error);

    await prisma.job.update({
      where: { id: jobId },
      data: { status: 'error', errorMessage },
    });

    await progressPublisher.publish(jobId, 'error', 'processing', 0, errorMessage);

    throw error;
  }
}

// ==================== HELPERS ====================

async function findCandidatesForUnit(
  episodeId: string,
  unitId: string,
  minDurationMs: number
): Promise<ChunkCandidateRow[]> {
  const rows = await prisma.$queryRaw<ChunkCandidateRow[]>`
    SELECT
      bc.id as chunk_id,
      bc."slotClipId" as slot_clip_id,
      bc."chunkIndex" as chunk_index,
      bc."startMs" as start_ms,
      bc."endMs" as end_ms,
      bc."durationMs" as duration_ms,
      bc."s3Key" as s3_key,
      bc."aiTags" as ai_tags,
      bc."aiSummary" as ai_summary,
      1 - (bc.embedding <=> vs.embedding) AS similarity
    FROM "BrollChunk" bc
    JOIN "VoiceoverSegment" vs ON vs.id = ${unitId}
    WHERE bc."episodeId" = ${episodeId}
      AND bc.embedding IS NOT NULL
      AND vs.embedding IS NOT NULL
      AND bc."s3Key" IS NOT NULL
      AND bc."moderationStatus" = 'safe'
      AND bc."durationMs" >= ${minDurationMs}
    ORDER BY bc.embedding <=> vs.embedding
    LIMIT ${TOP_K}
  `;

  return rows ?? [];
}

function scoreCandidates(
  unit: VoiceoverUnitRow,
  candidates: ChunkCandidateRow[],
  previousSlotClipId: string | null
): ScoredCandidate[] {
  const keywordSet = new Set(
    (unit.keywords || []).map((keyword) => normalizeToken(keyword))
  );

  return candidates.map((candidate) => {
    const semanticScore = clamp(candidate.similarity, 0, 1);
    const keywordScore = keywordSet.size > 0
      ? computeKeywordScore(keywordSet, candidate)
      : 0;
    const continuityScore =
      previousSlotClipId && candidate.slot_clip_id === previousSlotClipId ? 1 : 0;

    const totalScore =
      WEIGHTS.semantic * semanticScore +
      WEIGHTS.keyword * keywordScore +
      WEIGHTS.continuity * continuityScore;

    return {
      chunkId: candidate.chunk_id,
      slotClipId: candidate.slot_clip_id,
      chunkIndex: candidate.chunk_index,
      durationMs: candidate.duration_ms,
      s3Key: candidate.s3_key,
      aiTags: candidate.ai_tags ?? [],
      aiSummary: candidate.ai_summary ?? null,
      semanticScore,
      keywordScore,
      continuityScore,
      totalScore,
    };
  });
}

function computeKeywordScore(
  keywordSet: Set<string>,
  candidate: ChunkCandidateRow
): number {
  if (keywordSet.size === 0) return 0;
  const candidateTokens = new Set(
    [
      ...(candidate.ai_tags ?? []),
      candidate.ai_summary ?? '',
    ]
      .join(' ')
      .split(/\s+/)
      .map((token) => normalizeToken(token))
      .filter(Boolean)
  );

  let matches = 0;
  for (const keyword of keywordSet) {
    if (candidateTokens.has(keyword)) {
      matches += 1;
    }
  }

  return matches / keywordSet.size;
}

function normalizeToken(token: string): string {
  return token
    .toLowerCase()
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9'\-]/g, '');
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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
