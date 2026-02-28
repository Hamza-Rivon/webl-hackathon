/**
 * Phase 3.2: Microcut Plan Generation Job
 *
 * Purpose: Build MicroCutPlanV2 from per-unit candidates.
 *
 * Pipeline Position: After semantic_matching
 * Dependencies: Units with metadata.candidates + usable chunks
 * Triggers: cut_plan_validation
 */

import { Job } from 'bullmq';
import { prisma } from '../services/db.js';
import { progressPublisher } from '../services/progress.js';
import { logger } from '@webl/shared';
import {
  MicroCutPlanV2Schema,
  VoiceoverSegmentMetadataSchema,
} from '@webl/shared';
import { queues } from '../queue.js';

// ==================== TYPES ====================

interface CutPlanGenerationJobData {
  jobId: string;
  episodeId: string;
  userId: string;
}

interface UnitRow {
  id: string;
  segmentIndex: number;
  startMs: number;
  endMs: number;
  durationMs: number;
  metadata: unknown;
  emotionalTone: string | null;
}

/** Per-segment edit decision from the Creative Director LLM. */
interface CreativeEditDecision {
  segmentIndex: number;
  source: 'a_roll' | 'b_roll';
  preferredChunkId?: string;
  targetCutDurationMs: number;
  pacingIntent: 'rapid' | 'medium' | 'hold';
  editReason?: string;
}

interface CutWindow {
  startMs: number;
  endMs: number;
  unitIndices: number[];
}

interface WindowCandidate {
  chunkId: string;
  score: number;
  slotType: string;
  motifKey: string;
}

interface ChunkInfo {
  id: string;
  s3Key: string | null;
  durationMs: number;
  slotType: string;
  aiTags: string[] | null;
}

interface SectionOverride {
  beatTypes: string[];
  targetBrollCoverage: number;
  forceSource?: 'a_roll';
}

interface ArollBrollTimelinePolicy {
  mode: 'aroll_broll_alternating';
  startWith: 'a_roll' | 'b_roll';
  targetBrollCoverage: number;
  aroll: {
    minBlockMs: number;
    maxBlockMs: number;
  };
  broll: {
    minBlockMs: number;
    maxBlockMs: number;
  };
  maxConsecutiveBrollBlocks: number;
  sectionOverrides?: SectionOverride[];
}

type PlannedSource = 'a_roll' | 'b_roll';

interface GeneratedCut {
  cutIndex: number;
  startMs: number;
  endMs: number;
  durationMs: number;
  voiceoverStartMs: number;
  voiceoverEndMs: number;
  chunkId: string;
  chunkS3Key: string;
  clipStartMs: number;
  clipEndMs: number;
  unitIndices: number[];
  matchScore: number;
}

// ==================== CONSTANTS ====================

const MAX_CUT_DURATION_MS = 1900;
const MIN_CUT_DURATION_MS = 700;

/**
 * Emotion-driven max window duration. Maps VoiceoverSegment.emotionalTone
 * to a max cut window size in ms. High-energy emotions get shorter cuts,
 * vulnerable/reflective emotions get longer holds.
 * Falls back to MAX_CUT_DURATION_MS if tone is unrecognized.
 */
const EMOTION_TO_WINDOW_RANGE_MS: Record<string, { min: number; max: number }> = {
  excited: { min: 800, max: 1250 },
  urgent: { min: 700, max: 1150 },
  surprised: { min: 850, max: 1300 },
  angry: { min: 800, max: 1200 },
  passionate: { min: 900, max: 1350 },
  curious: { min: 1100, max: 1800 },
  confident: { min: 1000, max: 1650 },
  determined: { min: 1000, max: 1700 },
  hopeful: { min: 1100, max: 1850 },
  proud: { min: 1000, max: 1650 },
  vulnerable: { min: 1500, max: 2400 },
  reflective: { min: 1500, max: 2400 },
  sad: { min: 1500, max: 2350 },
  calm: { min: 1300, max: 2200 },
  intimate: { min: 1400, max: 2300 },
  warm: { min: 1200, max: 2100 },
  serious: { min: 1100, max: 1900 },
  skeptical: { min: 1000, max: 1750 },
  frustrated: { min: 900, max: 1450 },
  neutral: { min: 1000, max: 1900 },
};
const RESERVE_MARGIN = 0.05;
const PENALTY_PER_MISSING_UNIT = 0.05;
const REUSE_SCORE_PENALTY = 0.06;
const MOTIF_REUSE_SCORE_PENALTY = 0.04;
const CONSECUTIVE_MOTIF_SCORE_PENALTY = 0.05;
const CONSECUTIVE_SLOT_TYPE_SCORE_PENALTY = 0.03;
const PREFERRED_CHUNK_SCORE_BOOST_PER_UNIT = 0.08;
const PREFERRED_CHUNK_SCORE_BOOST_CAP = 0.24;
const CLIP_REUSE_SPACING_MS = 150;
const CLIP_REUSE_JITTER_STEP = 97;
const DEFAULT_FPS = 30;
const DEFAULT_WIDTH = 1080;
const DEFAULT_HEIGHT = 1920;
const DEFAULT_ASPECT_RATIO = '9:16' as const;
const AROLL_PREVIEW_CHUNK_ID = 'aroll_clean_preview';
const AROLL_DEFAULT_MATCH_SCORE = 1;
const DEFAULT_AROLL_BROLL_POLICY: ArollBrollTimelinePolicy = {
  mode: 'aroll_broll_alternating',
  startWith: 'a_roll',
  targetBrollCoverage: 0.38,
  aroll: {
    minBlockMs: 900,
    maxBlockMs: 2200,
  },
  broll: {
    minBlockMs: 500,
    maxBlockMs: 1700,
  },
  maxConsecutiveBrollBlocks: 1,
};

// ==================== JOB PROCESSOR ====================

export async function processCutPlanGeneration(
  bullJob: Job<CutPlanGenerationJobData>
): Promise<void> {
  const { jobId, episodeId, userId } = bullJob.data;

  logger.info(`[Phase 3.2] Starting cut plan generation job ${jobId}`, {
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
      'Starting cut plan generation'
    );

    await updateProgress(jobId, 'processing', 10, 'Loading episode metadata');

    const episode = await prisma.episode.findUnique({
      where: { id: episodeId },
      include: { template: true },
    });

    if (!episode) {
      throw new Error(`Episode ${episodeId} not found`);
    }

    if (!episode.cleanVoiceoverS3Key || !episode.cleanVoiceoverDuration) {
      throw new Error('Clean voiceover is not ready');
    }

    const cleanVoiceoverDurationMs = Math.round(episode.cleanVoiceoverDuration * 1000);
    const isArollFirst = isArollFirstTemplate(episode.template?.slotRequirements);
    logger.info('[Phase 3.2] RECEIVED: episode for cut plan generation', {
      episodeId,
      cleanVoiceoverDurationMs,
      revision: episode.revision ?? 0,
      isArollFirst,
    });

    await updateProgress(jobId, 'processing', 20, 'Loading voiceover units');

    const units = await prisma.voiceoverSegment.findMany({
      where: { episodeId },
      select: {
        id: true,
        segmentIndex: true,
        startMs: true,
        endMs: true,
        durationMs: true,
        metadata: true,
        emotionalTone: true,
      },
      orderBy: { segmentIndex: 'asc' },
    });

    if (units.length === 0) {
      throw new Error('No voiceover units found');
    }
    logger.info('[Phase 3.2] RECEIVED: voiceover units and chunk catalog', {
      episodeId,
      unitCount: units.length,
    });

    await updateProgress(jobId, 'processing', 30, 'Loading chunk catalog');

    const chunkRows: Array<{
      id: string;
      s3Key: string | null;
      durationMs: number;
      aiTags: string[] | null;
      slotClip: {
        slotType: string;
      };
    }> = await prisma.brollChunk.findMany({
      where: { episodeId },
      select: {
        id: true,
        s3Key: true,
        durationMs: true,
        aiTags: true,
        slotClip: {
          select: {
            slotType: true,
          },
        },
      },
    });

    const chunks: ChunkInfo[] = chunkRows.map((row) => ({
      id: row.id,
      s3Key: row.s3Key,
      durationMs: row.durationMs,
      slotType: row.slotClip.slotType,
      aiTags: row.aiTags,
    }));

    const usableBrollChunks = chunks.filter(
      (chunk) =>
        Boolean(chunk.s3Key) && (!isArollFirst || chunk.slotType !== 'a_roll_face')
    );

    const chunkMap = new Map<string, ChunkInfo>(
      usableBrollChunks.map((chunk: ChunkInfo) => [chunk.id, chunk])
    );
    logger.info('[Phase 3.2] RECEIVED: chunk catalog for cut plan generation', {
      episodeId,
      chunkCount: chunks.length,
      usableChunkCount: usableBrollChunks.length,
    });

    // Load Creative Brief (from Creative Director LLM job)
    const creativeBrief = ((episode as typeof episode & { creativeBrief?: unknown }).creativeBrief as CreativeEditDecision[] | null) || null;
    if (creativeBrief && creativeBrief.length > 0) {
      logger.info('[Phase 3.2] Using Creative Director brief for intelligent cut decisions', {
        episodeId,
        decisionCount: creativeBrief.length,
        arollCount: creativeBrief.filter((d) => d.source === 'a_roll').length,
        brollCount: creativeBrief.filter((d) => d.source === 'b_roll').length,
      });
    } else {
      logger.info('[Phase 3.2] No creative brief available, using mechanical policy', { episodeId });
    }

    const windows = buildCutWindows(units, creativeBrief);
    const arollPreview = isArollFirst
      ? resolveArollPreviewSource(episode.renderSpec, cleanVoiceoverDurationMs)
      : null;

    if (isArollFirst && !arollPreview) {
      throw new Error('A-roll-first template requires cleaned A-roll preview before cut plan generation');
    }

    const arollBrollPolicy = resolveArollBrollPolicy(episode.template?.editingRecipe);

    await updateProgress(jobId, 'processing', 50, 'Aggregating candidates');
    const creativeDecisionMap = creativeBrief
      ? new Map<number, CreativeEditDecision>(
          creativeBrief.map((decision) => [decision.segmentIndex, decision] as const)
        )
      : undefined;

    const windowCandidates = windows.map((window) =>
      buildWindowCandidates(window, units, chunkMap, {
        allowUnitsWithoutCandidates: isArollFirst,
        creativeDecisionMap,
      })
    );

    await updateProgress(jobId, 'processing', 70, 'Selecting timeline and chunks');

    const cuts = isArollFirst
      ? buildArollFirstCuts({
          windows,
          windowCandidates,
          chunkMap,
          arollS3Key: arollPreview!.s3Key,
          arollDurationMs: arollPreview!.durationMs,
          policy: arollBrollPolicy,
          creativeBrief,
          units,
        })
      : buildBrollOnlyCuts({
          windows,
          windowCandidates,
          chunkMap,
          creativeBrief,
        });

    if (isArollFirst) {
      const arollCutCount = cuts.filter((cut) => cut.chunkId === AROLL_PREVIEW_CHUNK_ID).length;
      const brollCutCount = cuts.length - arollCutCount;
      logger.info('[Phase 3.2] BUILT: A-roll/B-roll source timeline', {
        episodeId,
        cutCount: cuts.length,
        arollCutCount,
        brollCutCount,
        targetBrollCoverage: arollBrollPolicy.targetBrollCoverage,
      });
    }

    const totalDurationMs = cuts.length > 0 ? cuts[cuts.length - 1]!.endMs : 0;
    if (totalDurationMs !== cleanVoiceoverDurationMs) {
      throw new Error(
        `Cut plan duration mismatch: ${totalDurationMs}ms vs ${cleanVoiceoverDurationMs}ms`
      );
    }
    const arollCutCount = cuts.filter((cut) => cut.chunkId === AROLL_PREVIEW_CHUNK_ID).length;
    const brollCutCount = cuts.length - arollCutCount;
    const brollDurationMs = cuts
      .filter((cut) => cut.chunkId !== AROLL_PREVIEW_CHUNK_ID)
      .reduce((sum, cut) => sum + cut.durationMs, 0);
    const brollCoverage = totalDurationMs > 0 ? brollDurationMs / totalDurationMs : 0;
    const totalWindowDurationMs = windows.reduce(
      (sum, window) => sum + (window.endMs - window.startMs),
      0
    );
    const avgWindowDurationMs = windows.length > 0
      ? Math.round(totalWindowDurationMs / windows.length)
      : 0;
    const brollChunkIds = cuts
      .filter((cut) => cut.chunkId !== AROLL_PREVIEW_CHUNK_ID)
      .map((cut) => cut.chunkId);
    const uniqueBrollChunkCount = new Set(brollChunkIds).size;
    const brollReuseRate = brollChunkIds.length > 0
      ? (brollChunkIds.length - uniqueBrollChunkCount) / brollChunkIds.length
      : 0;
    const preferredChunkHintsUsed = creativeBrief
      ? creativeBrief.filter((decision) => Boolean(decision.preferredChunkId)).length
      : 0;
    logger.info('[Phase 3.2] Cut plan observability', {
      episodeId,
      windowCount: windows.length,
      avgWindowDurationMs,
      brollCutCount,
      uniqueBrollChunkCount,
      brollReuseRate: Number(brollReuseRate.toFixed(3)),
      preferredChunkHintsUsed,
      usedCreativeBrief: Boolean(creativeBrief && creativeBrief.length > 0),
    });

    const { aspectRatio, width, height, fps } = getRenderSettings(episode.template?.layoutSpec);

    const cutPlan = MicroCutPlanV2Schema.parse({
      version: 'microcut_v2',
      episodeId,
      revision: episode.revision ?? 0,
      createdAt: new Date().toISOString(),
      totalDurationMs,
      fps,
      width,
      height,
      aspectRatio,
      cuts,
      audio: {
        voiceover: {
          s3Key: episode.cleanVoiceoverS3Key,
          durationMs: cleanVoiceoverDurationMs,
          volume: 1,
        },
      },
    });

    const usedChunkIds = Array.from(new Set(cuts.map((cut) => cut.chunkId)));
    await prisma.brollChunk.updateMany({
      where: { episodeId },
      data: { isUsedInFinalCut: false },
    });
    if (usedChunkIds.length > 0) {
      await prisma.brollChunk.updateMany({
        where: {
          episodeId,
          id: { in: usedChunkIds },
        },
        data: { isUsedInFinalCut: true },
      });
    }

    await prisma.episode.update({
      where: { id: episodeId },
      data: {
        cutPlan: cutPlan as any,
        status: 'cut_plan_ready',
        // New cut plan invalidates any prior render intent/job pointer.
        renderRequested: false,
        renderRequestedAt: null,
        renderJobId: null,
      },
    });
    logger.info('[Phase 3.2] STORED: episode cut plan', {
      episodeId,
      cutCount: cuts.length,
      totalDurationMs,
      width,
      height,
      fps,
    });

    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: 'done',
        stage: 'done',
        progress: 100,
        outputData: {
          cutCount: cuts.length,
          totalDurationMs,
          arollCutCount,
          brollCutCount,
          brollCoverage,
          avgWindowDurationMs,
          brollReuseRate: Number(brollReuseRate.toFixed(3)),
          preferredChunkHintsUsed,
        },
      },
    });

    await progressPublisher.publish(
      jobId,
      'done',
      'done',
      100,
      `Cut plan created (${cuts.length} cuts)`
    );

    const validationJob = await prisma.job.create({
      data: {
        type: 'cut_plan_validation',
        status: 'pending',
        episodeId,
        userId,
      },
    });

    await queues.cutPlanValidation.add('cut-plan-validation', {
      jobId: validationJob.id,
      episodeId,
      userId,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`[Phase 3.2] Cut plan generation job ${jobId} failed:`, error);

    await prisma.job.update({
      where: { id: jobId },
      data: { status: 'error', errorMessage },
    });

    await progressPublisher.publish(jobId, 'error', 'processing', 0, errorMessage);

    throw error;
  }
}

// ==================== HELPERS ====================

function getDeterministicRatio(seed: number): number {
  const value = (seed * 137 + 53) % 1000;
  return value / 1000;
}

function clampCutDuration(durationMs: number): number {
  return Math.max(MIN_CUT_DURATION_MS, Math.min(2500, durationMs));
}

function resolveWindowRangeForUnit(
  unit: UnitRow,
  creativeBrief: CreativeEditDecision[] | null,
): { min: number; max: number } {
  let range: { min: number; max: number } = {
    min: MIN_CUT_DURATION_MS,
    max: MAX_CUT_DURATION_MS,
  };

  if (creativeBrief) {
    const decision = creativeBrief.find((d) => d.segmentIndex === unit.segmentIndex);
    if (decision?.targetCutDurationMs) {
      const target = clampCutDuration(decision.targetCutDurationMs);
      range = {
        min: Math.max(MIN_CUT_DURATION_MS, target - 250),
        max: Math.min(2500, target + 250),
      };
    } else if (decision?.pacingIntent === 'rapid') {
      range = { min: 700, max: 1250 };
    } else if (decision?.pacingIntent === 'hold') {
      range = { min: 1500, max: 2400 };
    } else if (decision?.pacingIntent === 'medium') {
      range = { min: 1000, max: 1850 };
    }
  }

  if (unit.emotionalTone) {
    const mapped = EMOTION_TO_WINDOW_RANGE_MS[unit.emotionalTone.toLowerCase()];
    if (mapped) {
      range = {
        min: Math.max(range.min, mapped.min),
        max: Math.min(range.max, mapped.max),
      };
    }
  }

  if (range.max < range.min) {
    range.max = range.min;
  }
  return range;
}

function getMaxWindowForUnit(
  unit: UnitRow,
  creativeBrief: CreativeEditDecision[] | null,
): number {
  const range = resolveWindowRangeForUnit(unit, creativeBrief);
  const ratio = getDeterministicRatio(unit.segmentIndex);
  return Math.round(range.min + ratio * (range.max - range.min));
}

function buildCutWindows(
  units: UnitRow[],
  creativeBrief?: CreativeEditDecision[] | null,
): CutWindow[] {
  const windows: CutWindow[] = [];
  let current: UnitRow[] = [];

  const flushWindow = () => {
    if (current.length === 0) return;
    const startMs = current[0]!.startMs;
    const endMs = current[current.length - 1]!.endMs;
    windows.push({
      startMs,
      endMs,
      unitIndices: current.map((unit) => unit.segmentIndex),
    });
    current = [];
  };

  for (const unit of units) {
    if (current.length === 0) {
      current.push(unit);
      continue;
    }
    const proposedEndMs = unit.endMs;
    const startMs = current[0]!.startMs;
    // Use emotion-driven max window duration based on the first unit in the window
    const maxWindow = getMaxWindowForUnit(current[0]!, creativeBrief ?? null);
    if (proposedEndMs - startMs > maxWindow) {
      flushWindow();
    }
    current.push(unit);
  }

  flushWindow();
  return windows;
}

function buildWindowCandidates(
  window: CutWindow,
  units: UnitRow[],
  chunkMap: Map<string, ChunkInfo>,
  options?: {
    allowUnitsWithoutCandidates?: boolean;
    creativeDecisionMap?: Map<number, CreativeEditDecision>;
  }
): WindowCandidate[] {
  const unitCount = window.unitIndices.length;
  const candidateScores = new Map<
    string,
    { sum: number; count: number; slotType: string; motifKey: string; preferredVotes: number }
  >();
  const requiredDurationMs = window.endMs - window.startMs;

  for (const unitIndex of window.unitIndices) {
    const unit = units.find((u) => u.segmentIndex === unitIndex);
    if (!unit) continue;
    const preferredChunkId = options?.creativeDecisionMap?.get(unit.segmentIndex)?.preferredChunkId;
    const candidates = extractCandidates(unit.metadata);
    if (candidates.length === 0 && !options?.allowUnitsWithoutCandidates) {
      throw new Error(`Unit ${unit.segmentIndex} has no candidates`);
    }
    for (const candidate of candidates) {
      const chunkInfo = chunkMap.get(candidate.chunkId);
      if (!chunkInfo?.s3Key || chunkInfo.durationMs < requiredDurationMs) {
        continue;
      }
      const entry = candidateScores.get(candidate.chunkId) ?? {
        sum: 0,
        count: 0,
        slotType: chunkInfo.slotType,
        motifKey: getChunkMotifKey(chunkInfo),
        preferredVotes: 0,
      };
      entry.sum += candidate.totalScore;
      entry.count += 1;
      if (preferredChunkId && preferredChunkId === candidate.chunkId) {
        entry.preferredVotes += 1;
      }
      candidateScores.set(candidate.chunkId, entry);
    }
  }

  const windowCandidates: WindowCandidate[] = [];
  for (const [chunkId, score] of candidateScores.entries()) {
    const missingUnits = unitCount - score.count;
    const averageScore = score.sum / unitCount;
    const preferenceBoost = Math.min(
      PREFERRED_CHUNK_SCORE_BOOST_CAP,
      score.preferredVotes * PREFERRED_CHUNK_SCORE_BOOST_PER_UNIT
    );
    const finalScore = averageScore - missingUnits * PENALTY_PER_MISSING_UNIT + preferenceBoost;
    windowCandidates.push({
      chunkId,
      score: finalScore,
      slotType: score.slotType,
      motifKey: score.motifKey,
    });
  }

  return windowCandidates.sort((a, b) => b.score - a.score);
}

function extractCandidates(metadata: unknown): Array<{ chunkId: string; totalScore: number }> {
  const parsed = VoiceoverSegmentMetadataSchema.safeParse(metadata);
  if (!parsed.success) return [];
  return parsed.data.candidates.map((candidate) => ({
    chunkId: candidate.chunkId,
    totalScore: candidate.totalScore,
  }));
}

function getChunkMotifKey(chunk: ChunkInfo): string {
  const tags = (chunk.aiTags ?? [])
    .map((tag) => tag.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''))
    .filter(Boolean);
  if (tags.length === 0) {
    return `slot:${chunk.slotType}`;
  }

  const topTags = Array.from(new Set(tags.slice(0, 3))).sort();
  return `${chunk.slotType}:${topTags.join('|')}`;
}

function buildReservations(windowCandidates: WindowCandidate[][]): Map<string, number> {
  const reserved = new Map<string, number>();
  windowCandidates.forEach((candidates, index) => {
    const top = candidates[0];
    const second = candidates[1];
    if (!top) return;
    if (!second || top.score - second.score >= RESERVE_MARGIN) {
      if (!reserved.has(top.chunkId)) {
        reserved.set(top.chunkId, index);
      }
    }
  });
  return reserved;
}

function selectCandidate(
  candidates: WindowCandidate[],
  reservedByChunk: Map<string, number>,
  usedChunks: Set<string>,
  usageByChunk: Map<string, number>,
  usageByMotif: Map<string, number>,
  previousChunkId: string | null,
  previousMotifKey: string | null,
  previousSlotType: string | null,
  windowIndex: number
): WindowCandidate | null {
  const scoreWithPenalty = (candidate: WindowCandidate): number => {
    const usageCount = usageByChunk.get(candidate.chunkId) ?? 0;
    const motifUsageCount = usageByMotif.get(candidate.motifKey) ?? 0;
    const consecutiveMotifPenalty =
      previousMotifKey && candidate.motifKey === previousMotifKey
        ? CONSECUTIVE_MOTIF_SCORE_PENALTY
        : 0;
    const consecutiveSlotTypePenalty =
      previousSlotType && candidate.slotType === previousSlotType
        ? CONSECUTIVE_SLOT_TYPE_SCORE_PENALTY
        : 0;

    return (
      candidate.score -
      usageCount * REUSE_SCORE_PENALTY -
      motifUsageCount * MOTIF_REUSE_SCORE_PENALTY -
      consecutiveMotifPenalty -
      consecutiveSlotTypePenalty
    );
  };

  const pickFrom = (list: WindowCandidate[]) => {
    const ranked = [...list].sort((a, b) => scoreWithPenalty(b) - scoreWithPenalty(a));

    for (const candidate of ranked) {
      if (usedChunks.has(candidate.chunkId)) continue;
      if (previousChunkId && candidate.chunkId === previousChunkId) continue;

      const reservedIndex = reservedByChunk.get(candidate.chunkId);
      if (reservedIndex !== undefined && reservedIndex > windowIndex) {
        const hasAlternative = ranked.some(
          (alt) =>
            alt.chunkId !== candidate.chunkId &&
            !usedChunks.has(alt.chunkId) &&
            (!previousChunkId || alt.chunkId !== previousChunkId) &&
            alt.score >= candidate.score - RESERVE_MARGIN
        );
        if (hasAlternative) {
          continue;
        }
      }

      return candidate;
    }
    return null;
  };

  const rankedReuse = [...candidates].sort(
    (a, b) => scoreWithPenalty(b) - scoreWithPenalty(a)
  );

  return (
    pickFrom(candidates) ||
    pickFrom(rankedReuse.filter((candidate) => !usedChunks.has(candidate.chunkId))) ||
    rankedReuse.find((candidate) => !previousChunkId || candidate.chunkId !== previousChunkId) ||
    rankedReuse[0] ||
    null
  );
}

function buildBrollOnlyCuts(args: {
  windows: CutWindow[];
  windowCandidates: WindowCandidate[][];
  chunkMap: Map<string, ChunkInfo>;
  creativeBrief?: CreativeEditDecision[] | null;
}): GeneratedCut[] {
  const reservedByChunk = buildReservations(args.windowCandidates);
  const usedChunks = new Set<string>();
  const usageByChunk = new Map<string, number>();
  const usageByMotif = new Map<string, number>();
  const consumedByChunkMs = new Map<string, number>();
  let previousChunkId: string | null = null;
  let previousMotifKey: string | null = null;
  let previousSlotType: string | null = null;

  return args.windows.map((window, index) => {
    const candidate = selectCandidate(
      args.windowCandidates[index]!,
      reservedByChunk,
      usedChunks,
      usageByChunk,
      usageByMotif,
      previousChunkId,
      previousMotifKey,
      previousSlotType,
      index
    );

    if (!candidate) {
      throw new Error(`No candidate available for window ${index}`);
    }

    const chunkInfo = args.chunkMap.get(candidate.chunkId);
    if (!chunkInfo?.s3Key) {
      throw new Error(`Missing chunk S3 key for ${candidate.chunkId}`);
    }

    const durationMs = window.endMs - window.startMs;
    const usageCount = usageByChunk.get(candidate.chunkId) ?? 0;
    const clipStartMs = computeClipStartMs({
      chunkDurationMs: chunkInfo.durationMs,
      cutDurationMs: durationMs,
      usageCount,
      priorConsumedMs: consumedByChunkMs.get(candidate.chunkId) ?? 0,
    });
    const clipEndMs = clipStartMs + durationMs;

    if (clipEndMs > chunkInfo.durationMs) {
      throw new Error(
        `Chunk ${candidate.chunkId} too short for window ${index} (${clipEndMs}ms > ${chunkInfo.durationMs}ms)`
      );
    }

    usedChunks.add(candidate.chunkId);
    usageByChunk.set(candidate.chunkId, usageCount + 1);
    usageByMotif.set(candidate.motifKey, (usageByMotif.get(candidate.motifKey) ?? 0) + 1);
    consumedByChunkMs.set(candidate.chunkId, clipEndMs);
    previousChunkId = candidate.chunkId;
    previousMotifKey = candidate.motifKey;
    previousSlotType = candidate.slotType;

    return {
      cutIndex: index,
      startMs: window.startMs,
      endMs: window.endMs,
      durationMs,
      voiceoverStartMs: window.startMs,
      voiceoverEndMs: window.endMs,
      chunkId: candidate.chunkId,
      chunkS3Key: chunkInfo.s3Key,
      clipStartMs,
      clipEndMs,
      unitIndices: window.unitIndices,
      matchScore: candidate.score,
    };
  });
}

function buildArollFirstCuts(args: {
  windows: CutWindow[];
  windowCandidates: WindowCandidate[][];
  chunkMap: Map<string, ChunkInfo>;
  arollS3Key: string;
  arollDurationMs: number;
  policy: ArollBrollTimelinePolicy;
  creativeBrief?: CreativeEditDecision[] | null;
  units?: UnitRow[];
}): GeneratedCut[] {
  // If Creative Director brief exists, use it for source decisions
  const sourcePlan = args.creativeBrief && args.creativeBrief.length > 0
    ? buildSourcePlanFromCreativeBrief(args.windows, args.creativeBrief, args.windowCandidates)
    : buildArollBrollSourcePlan(args.windows, args.windowCandidates, args.policy);
  const brollCandidatesByWindow = sourcePlan.map((source, index) =>
    source === 'b_roll' ? args.windowCandidates[index]! : []
  );
  const reservedByChunk = buildReservations(brollCandidatesByWindow);
  const usedChunks = new Set<string>();
  const usageByChunk = new Map<string, number>();
  const usageByMotif = new Map<string, number>();
  const consumedByChunkMs = new Map<string, number>();
  let previousBrollChunkId: string | null = null;
  let previousBrollMotifKey: string | null = null;
  let previousBrollSlotType: string | null = null;

  return args.windows.map((window, index) => {
    const durationMs = window.endMs - window.startMs;
    const shouldUseBroll = sourcePlan[index] === 'b_roll';

    if (shouldUseBroll) {
      const candidate = selectCandidate(
        brollCandidatesByWindow[index]!,
        reservedByChunk,
        usedChunks,
        usageByChunk,
        usageByMotif,
        previousBrollChunkId,
        previousBrollMotifKey,
        previousBrollSlotType,
        index
      );

      if (candidate) {
        const chunkInfo = args.chunkMap.get(candidate.chunkId);
        if (!chunkInfo?.s3Key) {
          throw new Error(`Missing chunk S3 key for ${candidate.chunkId}`);
        }

        const usageCount = usageByChunk.get(candidate.chunkId) ?? 0;
        const clipStartMs = computeClipStartMs({
          chunkDurationMs: chunkInfo.durationMs,
          cutDurationMs: durationMs,
          usageCount,
          priorConsumedMs: consumedByChunkMs.get(candidate.chunkId) ?? 0,
        });
        const clipEndMs = clipStartMs + durationMs;

        if (clipEndMs > chunkInfo.durationMs) {
          throw new Error(
            `Chunk ${candidate.chunkId} too short for window ${index} (${clipEndMs}ms > ${chunkInfo.durationMs}ms)`
          );
        }

        usedChunks.add(candidate.chunkId);
        usageByChunk.set(candidate.chunkId, usageCount + 1);
        usageByMotif.set(candidate.motifKey, (usageByMotif.get(candidate.motifKey) ?? 0) + 1);
        consumedByChunkMs.set(candidate.chunkId, clipEndMs);
        previousBrollChunkId = candidate.chunkId;
        previousBrollMotifKey = candidate.motifKey;
        previousBrollSlotType = candidate.slotType;

        return {
          cutIndex: index,
          startMs: window.startMs,
          endMs: window.endMs,
          durationMs,
          voiceoverStartMs: window.startMs,
          voiceoverEndMs: window.endMs,
          chunkId: candidate.chunkId,
          chunkS3Key: chunkInfo.s3Key,
          clipStartMs,
          clipEndMs,
          unitIndices: window.unitIndices,
          matchScore: candidate.score,
        };
      }
    }

    if (window.endMs > args.arollDurationMs) {
      throw new Error(
        `A-roll preview too short for window ${index} (${window.endMs}ms > ${args.arollDurationMs}ms)`
      );
    }

    return {
      cutIndex: index,
      startMs: window.startMs,
      endMs: window.endMs,
      durationMs,
      voiceoverStartMs: window.startMs,
      voiceoverEndMs: window.endMs,
      chunkId: AROLL_PREVIEW_CHUNK_ID,
      chunkS3Key: args.arollS3Key,
      clipStartMs: window.startMs,
      clipEndMs: window.endMs,
      unitIndices: window.unitIndices,
      matchScore: AROLL_DEFAULT_MATCH_SCORE,
    };
  });
}

/**
 * Build source plan from Creative Director brief.
 * Maps each window's unit indices to the LLM's per-segment decisions.
 * For each window, uses the majority source decision among its segments.
 */
function buildSourcePlanFromCreativeBrief(
  windows: CutWindow[],
  creativeBrief: CreativeEditDecision[],
  windowCandidates: WindowCandidate[][],
): PlannedSource[] {
  const decisionMap = new Map<number, CreativeEditDecision>();
  for (const d of creativeBrief) {
    decisionMap.set(d.segmentIndex, d);
  }

  return windows.map((window, windowIndex) => {
    // Count A-roll vs B-roll votes from the segments in this window
    let arollVotes = 0;
    let brollVotes = 0;

    for (const unitIdx of window.unitIndices) {
      const decision = decisionMap.get(unitIdx);
      if (decision?.source === 'b_roll') {
        brollVotes++;
      } else {
        arollVotes++;
      }
    }

    // If B-roll is preferred but no candidates exist, fall back to A-roll
    if (brollVotes > arollVotes) {
      const hasCandidates = (windowCandidates[windowIndex] ?? []).length > 0;
      return hasCandidates ? 'b_roll' : 'a_roll';
    }

    return 'a_roll';
  });
}

function buildArollBrollSourcePlan(
  windows: CutWindow[],
  windowCandidates: WindowCandidate[][],
  policy: ArollBrollTimelinePolicy
): PlannedSource[] {
  if (windows.length === 0) {
    return [];
  }

  const anyBrollCandidate = windowCandidates.some((candidates) => candidates.length > 0);
  if (!anyBrollCandidate) {
    return windows.map(() => 'a_roll');
  }

  const totalDurationMs = windows[windows.length - 1]!.endMs;
  const targetBrollMs = Math.round(totalDurationMs * policy.targetBrollCoverage);
  let brollAssignedMs = 0;

  const plan: PlannedSource[] = [];
  let currentSource: PlannedSource = policy.startWith;
  let blockMs = 0;
  let blockIndex = 0;
  let blockTargetMs = getBlockTargetDurationMs(policy, currentSource, blockIndex);
  let consecutiveBrollBlocks = 0;

  for (let i = 0; i < windows.length; i += 1) {
    const window = windows[i]!;
    const durationMs = window.endMs - window.startMs;
    const hasBrollHere = windowCandidates[i]!.length > 0;

    if (currentSource === 'b_roll' && (!hasBrollHere || brollAssignedMs >= targetBrollMs)) {
      currentSource = 'a_roll';
      blockMs = 0;
      blockIndex += 1;
      blockTargetMs = getBlockTargetDurationMs(policy, currentSource, blockIndex);
      consecutiveBrollBlocks = 0;
    }

    plan.push(currentSource);
    blockMs += durationMs;
    if (currentSource === 'b_roll') {
      brollAssignedMs += durationMs;
    }

    if (currentSource === 'a_roll' && blockMs >= blockTargetMs) {
      const canStartBroll =
        brollAssignedMs < targetBrollMs &&
        hasBrollCandidateAtOrAfter(windowCandidates, i + 1);
      if (canStartBroll) {
        currentSource = 'b_roll';
        blockMs = 0;
        blockIndex += 1;
        blockTargetMs = getBlockTargetDurationMs(policy, currentSource, blockIndex);
        consecutiveBrollBlocks = 1;
      }
      continue;
    }

    if (currentSource === 'b_roll' && blockMs >= blockTargetMs) {
      const canContinueBroll =
        brollAssignedMs < targetBrollMs &&
        hasBrollCandidateAtOrAfter(windowCandidates, i + 1) &&
        consecutiveBrollBlocks < policy.maxConsecutiveBrollBlocks;

      if (canContinueBroll) {
        blockMs = 0;
        blockIndex += 1;
        blockTargetMs = getBlockTargetDurationMs(policy, currentSource, blockIndex);
        consecutiveBrollBlocks += 1;
      } else {
        currentSource = 'a_roll';
        blockMs = 0;
        blockIndex += 1;
        blockTargetMs = getBlockTargetDurationMs(policy, currentSource, blockIndex);
        consecutiveBrollBlocks = 0;
      }
    }
  }

  return plan;
}

function getBlockTargetDurationMs(
  policy: ArollBrollTimelinePolicy,
  source: PlannedSource,
  blockIndex: number
): number {
  const range = source === 'a_roll' ? policy.aroll : policy.broll;
  const span = Math.max(0, range.maxBlockMs - range.minBlockMs);
  if (span === 0) {
    return range.minBlockMs;
  }

  const cycle = (blockIndex * 137 + 53) % 1000;
  const normalized = cycle / 1000;
  return Math.round(range.minBlockMs + normalized * span);
}

function hasBrollCandidateAtOrAfter(
  windowCandidates: WindowCandidate[][],
  startIndex: number
): boolean {
  for (let index = startIndex; index < windowCandidates.length; index += 1) {
    if ((windowCandidates[index]?.length ?? 0) > 0) {
      return true;
    }
  }
  return false;
}

function resolveArollPreviewSource(
  renderSpec: unknown,
  cleanVoiceoverDurationMs: number
): { s3Key: string; durationMs: number } | null {
  if (!renderSpec || typeof renderSpec !== 'object') {
    return null;
  }

  const spec = renderSpec as Record<string, unknown>;
  const s3Key =
    typeof spec.arollCleanPreviewS3Key === 'string' ? spec.arollCleanPreviewS3Key : null;

  if (!s3Key) {
    return null;
  }

  const rawDurationSeconds =
    typeof spec.arollCleanPreviewDuration === 'number'
      ? spec.arollCleanPreviewDuration
      : cleanVoiceoverDurationMs / 1000;
  const durationMs = Math.round(rawDurationSeconds * 1000);

  if (durationMs + 250 < cleanVoiceoverDurationMs) {
    throw new Error(
      `A-roll preview duration too short (${durationMs}ms vs ${cleanVoiceoverDurationMs}ms)`
    );
  }

  return {
    s3Key,
    durationMs: Math.max(durationMs, cleanVoiceoverDurationMs),
  };
}

function resolveArollBrollPolicy(editingRecipe: unknown): ArollBrollTimelinePolicy {
  if (!editingRecipe || typeof editingRecipe !== 'object') {
    return DEFAULT_AROLL_BROLL_POLICY;
  }

  const recipe = editingRecipe as Record<string, unknown>;
  const timelinePolicy =
    recipe.timelinePolicy && typeof recipe.timelinePolicy === 'object'
      ? (recipe.timelinePolicy as Record<string, unknown>)
      : null;

  if (!timelinePolicy || timelinePolicy.mode !== 'aroll_broll_alternating') {
    return DEFAULT_AROLL_BROLL_POLICY;
  }

  const parsed: ArollBrollTimelinePolicy = {
    mode: 'aroll_broll_alternating',
    startWith: timelinePolicy.startWith === 'b_roll' ? 'b_roll' : 'a_roll',
    targetBrollCoverage: clampNumber(
      asNumber(timelinePolicy.targetBrollCoverage, DEFAULT_AROLL_BROLL_POLICY.targetBrollCoverage),
      0,
      0.8
    ),
    aroll: {
      minBlockMs: Math.max(
        300,
        asNumber(
          asRecord(timelinePolicy.aroll).minBlockMs,
          DEFAULT_AROLL_BROLL_POLICY.aroll.minBlockMs
        )
      ),
      maxBlockMs: Math.max(
        600,
        asNumber(
          asRecord(timelinePolicy.aroll).maxBlockMs,
          DEFAULT_AROLL_BROLL_POLICY.aroll.maxBlockMs
        )
      ),
    },
    broll: {
      minBlockMs: Math.max(
        300,
        asNumber(
          asRecord(timelinePolicy.broll).minBlockMs,
          DEFAULT_AROLL_BROLL_POLICY.broll.minBlockMs
        )
      ),
      maxBlockMs: Math.max(
        500,
        asNumber(
          asRecord(timelinePolicy.broll).maxBlockMs,
          DEFAULT_AROLL_BROLL_POLICY.broll.maxBlockMs
        )
      ),
    },
    maxConsecutiveBrollBlocks: Math.max(
      1,
      Math.floor(
        asNumber(
          timelinePolicy.maxConsecutiveBrollBlocks,
          DEFAULT_AROLL_BROLL_POLICY.maxConsecutiveBrollBlocks
        )
      )
    ),
  };

  if (parsed.aroll.maxBlockMs < parsed.aroll.minBlockMs) {
    parsed.aroll.maxBlockMs = parsed.aroll.minBlockMs;
  }
  if (parsed.broll.maxBlockMs < parsed.broll.minBlockMs) {
    parsed.broll.maxBlockMs = parsed.broll.minBlockMs;
  }

  return parsed;
}

function isArollFirstTemplate(slotRequirements: unknown): boolean {
  if (!slotRequirements || typeof slotRequirements !== 'object') return false;
  if ((slotRequirements as { workflow?: unknown }).workflow === 'aroll_clean_then_broll') {
    return true;
  }

  const slots = (slotRequirements as { slots?: unknown }).slots;
  if (!Array.isArray(slots) || slots.length === 0) return false;

  const requiredSlots = slots
    .map((slot) => slot as { slotType?: unknown; priority?: unknown })
    .filter((slot) => slot.priority === 'required');
  if (requiredSlots.length === 0) return false;
  return requiredSlots[0]?.slotType === 'a_roll_face';
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object') {
    return value as Record<string, unknown>;
  }
  return {};
}

function asNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return fallback;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function computeClipStartMs(args: {
  chunkDurationMs: number;
  cutDurationMs: number;
  usageCount: number;
  priorConsumedMs: number;
}): number {
  const maxStartMs = Math.max(0, args.chunkDurationMs - args.cutDurationMs);
  if (maxStartMs === 0 || args.usageCount === 0) {
    return 0;
  }

  const cycleLength = maxStartMs + 1;
  const baseOffset = (args.priorConsumedMs + CLIP_REUSE_SPACING_MS) % cycleLength;
  const jitter = (args.usageCount * CLIP_REUSE_JITTER_STEP) % cycleLength;

  return (baseOffset + jitter) % cycleLength;
}

function getRenderSettings(layoutSpec: any): {
  aspectRatio: '9:16' | '16:9' | '1:1';
  width: number;
  height: number;
  fps: number;
} {
  const aspectRatio = layoutSpec?.aspectRatio as '9:16' | '16:9' | '1:1' | undefined;
  const resolution = layoutSpec?.resolution as { width?: number; height?: number } | undefined;

  return {
    aspectRatio: aspectRatio ?? DEFAULT_ASPECT_RATIO,
    width: resolution?.width ?? DEFAULT_WIDTH,
    height: resolution?.height ?? DEFAULT_HEIGHT,
    fps: DEFAULT_FPS,
  };
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
