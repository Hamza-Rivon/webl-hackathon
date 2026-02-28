/**
 * User Usage Tracking Service
 *
 * Tracks user resource consumption for rate limiting and billing purposes.
 * Handles hourly/daily resets automatically based on timestamps.
 */

import { prisma } from './db.js';
import { logger } from '@webl/shared';

// ==================== TYPES ====================

export type UsageMetric = 'chunks' | 'episodes' | 'renders';

export interface UsageRecord {
  chunksProcessedThisHour: number;
  episodesCreatedToday: number;
  rendersCompletedToday: number;
}

export interface UsageIncrements {
  chunksProcessed?: number;
  episodesCreated?: number;
  rendersCompleted?: number;
  geminiCalls?: number;
  openAiChatCalls?: number;
  openAiEmbeddingCalls?: number;
  deepgramTranscriptions?: number;
  deepgramAudioSeconds?: number;
  muxAiSummaryCalls?: number;
  muxAiModerationCalls?: number;
  muxSubtitleRequests?: number;
  muxTranscriptFetches?: number;
  elevenLabsTtsCalls?: number;
  elevenLabsValidationCalls?: number;
  elevenLabsCharacters?: number;
  scriptGenerationCalls?: number;
  keytermExtractionCalls?: number;
  transcriptCorrectionCalls?: number;
  scriptAlignmentLlmCalls?: number;
  voiceoverEditVerificationCalls?: number;
  segmentAnalysisCalls?: number;
  chunkSelectionCalls?: number;
  semanticRerankCalls?: number;
  voiceoverSegmentEmbeddingCalls?: number;
  brollChunkEmbeddingCalls?: number;
  estimatedCostUsd?: number;
}

// ==================== COST ESTIMATION ====================

// Estimated costs per operation (USD)
const COST_PER_CHUNK = 0.005; // ~$0.005 per chunk (Mux ingest + AI + embedding)
const COST_PER_RENDER = 0.25; // ~$0.25 per render (Remotion lambda)
const COST_PER_EPISODE = 0.01; // ~$0.01 per episode (minimal overhead)

type UsageUpdateData = Record<string, number | Date>;

interface NormalizedUsageIncrements {
  chunksProcessed: number;
  episodesCreated: number;
  rendersCompleted: number;
  geminiCalls: number;
  openAiChatCalls: number;
  llmCalls: number;
  openAiEmbeddingCalls: number;
  embeddingCalls: number;
  deepgramTranscriptions: number;
  deepgramAudioSeconds: number;
  muxAiSummaryCalls: number;
  muxAiModerationCalls: number;
  muxAiCalls: number;
  muxSubtitleRequests: number;
  muxTranscriptFetches: number;
  elevenLabsTtsCalls: number;
  elevenLabsValidationCalls: number;
  elevenLabsCharacters: number;
  externalApiCalls: number;
  scriptGenerationCalls: number;
  keytermExtractionCalls: number;
  transcriptCorrectionCalls: number;
  scriptAlignmentLlmCalls: number;
  voiceoverEditVerificationCalls: number;
  segmentAnalysisCalls: number;
  chunkSelectionCalls: number;
  semanticRerankCalls: number;
  voiceoverSegmentEmbeddingCalls: number;
  brollChunkEmbeddingCalls: number;
  estimatedCostUsd: number;
}

type IncrementFieldMap = { field: string; countKey: keyof NormalizedUsageIncrements };

const HOURLY_RESET_FIELDS = [
  'chunksProcessedThisHour',
  'llmCallsThisHour',
  'embeddingCallsThisHour',
  'transcriptionSecondsThisHour',
  'muxAiCallsThisHour',
  'ttsCharactersThisHour',
  'externalApiCallsThisHour',
];

const DAILY_RESET_FIELDS = [
  'episodesCreatedToday',
  'rendersCompletedToday',
  'llmCallsToday',
  'embeddingCallsToday',
  'transcriptionSecondsToday',
  'muxAiCallsToday',
  'ttsCharactersToday',
  'externalApiCallsToday',
];

const HOURLY_INCREMENT_FIELDS: IncrementFieldMap[] = [
  { field: 'chunksProcessedThisHour', countKey: 'chunksProcessed' },
  { field: 'llmCallsThisHour', countKey: 'llmCalls' },
  { field: 'embeddingCallsThisHour', countKey: 'embeddingCalls' },
  { field: 'transcriptionSecondsThisHour', countKey: 'deepgramAudioSeconds' },
  { field: 'muxAiCallsThisHour', countKey: 'muxAiCalls' },
  { field: 'ttsCharactersThisHour', countKey: 'elevenLabsCharacters' },
  { field: 'externalApiCallsThisHour', countKey: 'externalApiCalls' },
];

const DAILY_INCREMENT_FIELDS: IncrementFieldMap[] = [
  { field: 'episodesCreatedToday', countKey: 'episodesCreated' },
  { field: 'rendersCompletedToday', countKey: 'rendersCompleted' },
  { field: 'llmCallsToday', countKey: 'llmCalls' },
  { field: 'embeddingCallsToday', countKey: 'embeddingCalls' },
  { field: 'transcriptionSecondsToday', countKey: 'deepgramAudioSeconds' },
  { field: 'muxAiCallsToday', countKey: 'muxAiCalls' },
  { field: 'ttsCharactersToday', countKey: 'elevenLabsCharacters' },
  { field: 'externalApiCallsToday', countKey: 'externalApiCalls' },
];

const TOTAL_INCREMENT_FIELDS: IncrementFieldMap[] = [
  { field: 'totalChunksProcessed', countKey: 'chunksProcessed' },
  { field: 'totalEpisodesCreated', countKey: 'episodesCreated' },
  { field: 'totalRendersCompleted', countKey: 'rendersCompleted' },
  { field: 'totalExternalApiCalls', countKey: 'externalApiCalls' },
  { field: 'totalLlmCalls', countKey: 'llmCalls' },
  { field: 'totalGeminiCalls', countKey: 'geminiCalls' },
  { field: 'totalOpenAiChatCalls', countKey: 'openAiChatCalls' },
  { field: 'totalEmbeddingCalls', countKey: 'embeddingCalls' },
  { field: 'totalOpenAiEmbeddingCalls', countKey: 'openAiEmbeddingCalls' },
  { field: 'totalDeepgramTranscriptions', countKey: 'deepgramTranscriptions' },
  { field: 'totalDeepgramAudioSeconds', countKey: 'deepgramAudioSeconds' },
  { field: 'totalMuxAiCalls', countKey: 'muxAiCalls' },
  { field: 'totalMuxAiSummaryCalls', countKey: 'muxAiSummaryCalls' },
  { field: 'totalMuxAiModerationCalls', countKey: 'muxAiModerationCalls' },
  { field: 'totalMuxSubtitleRequests', countKey: 'muxSubtitleRequests' },
  { field: 'totalMuxTranscriptFetches', countKey: 'muxTranscriptFetches' },
  { field: 'totalElevenLabsTtsCalls', countKey: 'elevenLabsTtsCalls' },
  { field: 'totalElevenLabsValidationCalls', countKey: 'elevenLabsValidationCalls' },
  { field: 'totalElevenLabsCharacters', countKey: 'elevenLabsCharacters' },
  { field: 'totalScriptGenerationCalls', countKey: 'scriptGenerationCalls' },
  { field: 'totalKeytermExtractionCalls', countKey: 'keytermExtractionCalls' },
  { field: 'totalTranscriptCorrectionCalls', countKey: 'transcriptCorrectionCalls' },
  { field: 'totalScriptAlignmentLlmCalls', countKey: 'scriptAlignmentLlmCalls' },
  { field: 'totalVoiceoverEditVerificationCalls', countKey: 'voiceoverEditVerificationCalls' },
  { field: 'totalSegmentAnalysisCalls', countKey: 'segmentAnalysisCalls' },
  { field: 'totalChunkSelectionCalls', countKey: 'chunkSelectionCalls' },
  { field: 'totalSemanticRerankCalls', countKey: 'semanticRerankCalls' },
  { field: 'totalVoiceoverSegmentEmbeddingCalls', countKey: 'voiceoverSegmentEmbeddingCalls' },
  { field: 'totalBrollChunkEmbeddingCalls', countKey: 'brollChunkEmbeddingCalls' },
];

function normalizeIncrements(increments: UsageIncrements): NormalizedUsageIncrements {
  const chunksProcessed = increments.chunksProcessed ?? 0;
  const episodesCreated = increments.episodesCreated ?? 0;
  const rendersCompleted = increments.rendersCompleted ?? 0;

  const geminiCalls = increments.geminiCalls ?? 0;
  const openAiChatCalls = increments.openAiChatCalls ?? 0;
  const llmCalls = geminiCalls + openAiChatCalls;

  const openAiEmbeddingCalls = increments.openAiEmbeddingCalls ?? 0;
  const embeddingCalls = openAiEmbeddingCalls;

  const deepgramTranscriptions = increments.deepgramTranscriptions ?? 0;
  const deepgramAudioSeconds = increments.deepgramAudioSeconds ?? 0;

  const muxAiSummaryCalls = increments.muxAiSummaryCalls ?? 0;
  const muxAiModerationCalls = increments.muxAiModerationCalls ?? 0;
  const muxAiCalls = muxAiSummaryCalls + muxAiModerationCalls;

  const muxSubtitleRequests = increments.muxSubtitleRequests ?? 0;
  const muxTranscriptFetches = increments.muxTranscriptFetches ?? 0;

  const elevenLabsTtsCalls = increments.elevenLabsTtsCalls ?? 0;
  const elevenLabsValidationCalls = increments.elevenLabsValidationCalls ?? 0;
  const elevenLabsCharacters = increments.elevenLabsCharacters ?? 0;

  const externalApiCalls =
    llmCalls +
    embeddingCalls +
    deepgramTranscriptions +
    muxAiCalls +
    muxSubtitleRequests +
    muxTranscriptFetches +
    elevenLabsTtsCalls +
    elevenLabsValidationCalls;

  const scriptGenerationCalls = increments.scriptGenerationCalls ?? 0;
  const keytermExtractionCalls = increments.keytermExtractionCalls ?? 0;
  const transcriptCorrectionCalls = increments.transcriptCorrectionCalls ?? 0;
  const scriptAlignmentLlmCalls = increments.scriptAlignmentLlmCalls ?? 0;
  const voiceoverEditVerificationCalls = increments.voiceoverEditVerificationCalls ?? 0;
  const segmentAnalysisCalls = increments.segmentAnalysisCalls ?? 0;
  const chunkSelectionCalls = increments.chunkSelectionCalls ?? 0;
  const semanticRerankCalls = increments.semanticRerankCalls ?? 0;
  const voiceoverSegmentEmbeddingCalls = increments.voiceoverSegmentEmbeddingCalls ?? 0;
  const brollChunkEmbeddingCalls = increments.brollChunkEmbeddingCalls ?? 0;
  const estimatedCostUsd = increments.estimatedCostUsd ?? 0;

  return {
    chunksProcessed,
    episodesCreated,
    rendersCompleted,
    geminiCalls,
    openAiChatCalls,
    llmCalls,
    openAiEmbeddingCalls,
    embeddingCalls,
    deepgramTranscriptions,
    deepgramAudioSeconds,
    muxAiSummaryCalls,
    muxAiModerationCalls,
    muxAiCalls,
    muxSubtitleRequests,
    muxTranscriptFetches,
    elevenLabsTtsCalls,
    elevenLabsValidationCalls,
    elevenLabsCharacters,
    externalApiCalls,
    scriptGenerationCalls,
    keytermExtractionCalls,
    transcriptCorrectionCalls,
    scriptAlignmentLlmCalls,
    voiceoverEditVerificationCalls,
    segmentAnalysisCalls,
    chunkSelectionCalls,
    semanticRerankCalls,
    voiceoverSegmentEmbeddingCalls,
    brollChunkEmbeddingCalls,
    estimatedCostUsd,
  };
}

function resetCounters(updateData: UsageUpdateData, fields: string[]): void {
  for (const field of fields) {
    updateData[field] = 0;
  }
}

function applyWindowedIncrements(
  updateData: UsageUpdateData,
  usageRecord: Record<string, number>,
  counts: NormalizedUsageIncrements,
  reset: boolean,
  mappings: IncrementFieldMap[]
): void {
  for (const mapping of mappings) {
    const count = counts[mapping.countKey];
    if (count > 0) {
      const currentValue = usageRecord[mapping.field] ?? 0;
      updateData[mapping.field] = (reset ? 0 : currentValue) + count;
    }
  }
}

function applyTotalIncrements(
  updateData: UsageUpdateData,
  usageRecord: Record<string, number>,
  counts: NormalizedUsageIncrements,
  mappings: IncrementFieldMap[]
): void {
  for (const mapping of mappings) {
    const count = counts[mapping.countKey];
    if (count > 0) {
      const currentValue = usageRecord[mapping.field] ?? 0;
      updateData[mapping.field] = currentValue + count;
    }
  }
}

function applyCostIncrement(
  updateData: UsageUpdateData,
  usageRecord: Record<string, number>,
  estimatedCostUsd: number
): void {
  if (estimatedCostUsd !== 0) {
    const currentValue = usageRecord.totalEstimatedCostUSD ?? 0;
    updateData.totalEstimatedCostUSD = currentValue + estimatedCostUsd;
  }
}

// ==================== MAIN FUNCTIONS ====================

export async function recordUsage(userId: string, increments: UsageIncrements): Promise<void> {
  try {
    const now = new Date();
    const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    let usage = await prisma.userUsage.findUnique({
      where: { userId },
    });

    if (!usage) {
      usage = await prisma.userUsage.create({
        data: {
          userId,
          hourlyResetAt: now,
          dailyResetAt: startOfToday,
        },
      });
      logger.info(`Created new usage record for user ${userId}`);
    }

    const usageRecord = usage as unknown as Record<string, number>;
    const hourlyReset = usage.hourlyResetAt < hourAgo;
    const dailyReset = usage.dailyResetAt < startOfToday;

    const counts = normalizeIncrements(increments);
    const updateData: UsageUpdateData = { updatedAt: now };

    if (hourlyReset) {
      updateData.hourlyResetAt = now;
      resetCounters(updateData, HOURLY_RESET_FIELDS);
    }

    if (dailyReset) {
      updateData.dailyResetAt = startOfToday;
      resetCounters(updateData, DAILY_RESET_FIELDS);
    }

    applyWindowedIncrements(updateData, usageRecord, counts, hourlyReset, HOURLY_INCREMENT_FIELDS);
    applyWindowedIncrements(updateData, usageRecord, counts, dailyReset, DAILY_INCREMENT_FIELDS);
    applyTotalIncrements(updateData, usageRecord, counts, TOTAL_INCREMENT_FIELDS);
    applyCostIncrement(updateData, usageRecord, counts.estimatedCostUsd);

    await prisma.userUsage.update({
      where: { userId },
      data: updateData,
    });
  } catch (error) {
    logger.error(`Failed to record usage for user ${userId}:`, error);
  }
}

/**
 * Increment usage metrics for a user
 *
 * Automatically handles:
 * - Hourly reset for chunksProcessedThisHour
 * - Daily reset for episodesCreatedToday and rendersCompletedToday
 * - Upserting if no usage record exists
 *
 * @param userId - The user's ID
 * @param metric - Which metric to increment ('chunks', 'episodes', 'renders')
 * @param amount - Amount to increment by (default: 1)
 */
export async function incrementUsage(
  userId: string,
  metric: UsageMetric,
  amount: number = 1
): Promise<void> {
  try {
    let estimatedCostUsd = 0;
    const increments: UsageIncrements = {};

    switch (metric) {
      case 'chunks':
        increments.chunksProcessed = amount;
        estimatedCostUsd = amount * COST_PER_CHUNK;
        break;
      case 'episodes':
        increments.episodesCreated = amount;
        estimatedCostUsd = amount * COST_PER_EPISODE;
        break;
      case 'renders':
        increments.rendersCompleted = amount;
        estimatedCostUsd = amount * COST_PER_RENDER;
        break;
    }

    if (estimatedCostUsd) {
      increments.estimatedCostUsd = estimatedCostUsd;
    }

    await recordUsage(userId, increments);

    logger.debug(`Updated usage for user ${userId}: ${metric} += ${amount}`, {
      costIncrement: estimatedCostUsd.toFixed(4),
    });
  } catch (error) {
    logger.error(`Failed to update usage for user ${userId}:`, error);
  }
}

/**
 * Get current usage for a user
 *
 * @param userId - The user's ID
 * @returns Current usage record or null if not found
 */
export async function getUserUsage(userId: string): Promise<UsageRecord | null> {
  try {
    const usage = await prisma.userUsage.findUnique({
      where: { userId },
    });

    if (!usage) {
      return null;
    }

    const usageRecord = usage as any;

    return {
      chunksProcessedThisHour: usageRecord.chunksProcessedThisHour,
      episodesCreatedToday: usageRecord.episodesCreatedToday,
      rendersCompletedToday: usageRecord.rendersCompletedToday,
    };
  } catch (error) {
    logger.error(`Failed to get usage for user ${userId}:`, error);
    return null;
  }
}

/**
 * Check if user is within rate limits
 *
 * @param userId - The user's ID
 * @returns Object with limit check results
 */
export async function checkRateLimits(
  userId: string
): Promise<{
  withinLimits: boolean;
  chunksRemaining: number;
  rendersRemaining: number;
  episodesRemaining: number;
}> {
  // Default limits (can be extended to use subscription tiers)
  const HOURLY_CHUNK_LIMIT = 100;
  const DAILY_RENDER_LIMIT = 10;
  const DAILY_EPISODE_LIMIT = 20;

  try {
    const usage = await getUserUsage(userId);

    if (!usage) {
      // No usage record = all limits available
      return {
        withinLimits: true,
        chunksRemaining: HOURLY_CHUNK_LIMIT,
        rendersRemaining: DAILY_RENDER_LIMIT,
        episodesRemaining: DAILY_EPISODE_LIMIT,
      };
    }

    const chunksRemaining = Math.max(0, HOURLY_CHUNK_LIMIT - usage.chunksProcessedThisHour);
    const rendersRemaining = Math.max(0, DAILY_RENDER_LIMIT - usage.rendersCompletedToday);
    const episodesRemaining = Math.max(0, DAILY_EPISODE_LIMIT - usage.episodesCreatedToday);

    return {
      withinLimits: chunksRemaining > 0 && rendersRemaining > 0 && episodesRemaining > 0,
      chunksRemaining,
      rendersRemaining,
      episodesRemaining,
    };
  } catch (error) {
    logger.error(`Failed to check rate limits for user ${userId}:`, error);
    // Default to allowing on error (don't block users due to tracking issues)
    return {
      withinLimits: true,
      chunksRemaining: HOURLY_CHUNK_LIMIT,
      rendersRemaining: DAILY_RENDER_LIMIT,
      episodesRemaining: DAILY_EPISODE_LIMIT,
    };
  }
}

// ==================== HARD LIMIT CHECK ====================

/**
 * Check if a user can proceed with external API calls.
 *
 * Queries User + UserUsage and evaluates hard limits.
 * Workers should call this at the START of every job that makes external API calls.
 *
 * @returns UsageLimitStatus — if !allowed, the job should fail immediately.
 */
export async function checkCanProceed(userId: string): Promise<{
  allowed: boolean;
  reason: string | null;
}> {
  try {
    const { evaluateUsageLimits } = await import('@webl/shared');

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        subscriptionActive: true,
        subscriptionTier: true,
      },
    });

    if (!user) {
      return { allowed: false, reason: 'User not found' };
    }

    const usage = await prisma.userUsage.findUnique({
      where: { userId },
      select: {
        totalExternalApiCalls: true,
        totalLlmCalls: true,
        totalEmbeddingCalls: true,
        totalEpisodesCreated: true,
        totalRendersCompleted: true,
        totalEstimatedCostUSD: true,
        maxTotalExternalApiCalls: true,
        maxTotalLlmCalls: true,
        maxTotalEmbeddingCalls: true,
        maxTotalEpisodesCreated: true,
        maxTotalRendersCompleted: true,
        maxEstimatedCostUSD: true,
      },
    });

    const status = evaluateUsageLimits(user, usage);

    if (!status.allowed) {
      logger.warn(`[UsageGuard] Blocked job for user ${userId}: ${status.reason}`);
    }

    return { allowed: status.allowed, reason: status.reason };
  } catch (error) {
    // On error, allow the job through to avoid blocking due to tracking issues
    logger.error(`[UsageGuard] Error checking limits for user ${userId}:`, error);
    return { allowed: true, reason: null };
  }
}

// ==================== EXPORT ====================

export const usageService = {
  recordUsage,
  incrementUsage,
  getUserUsage,
  checkRateLimits,
  checkCanProceed,
};
