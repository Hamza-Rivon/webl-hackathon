/**
 * User Usage Tracking Service for API
 *
 * Tracks user resource consumption for rate limiting and billing purposes.
 * This is focused on API-triggered usage (episode creation + external AI calls).
 */

import { prisma } from '@webl/prisma';
import { logger } from '@webl/shared';

// ==================== TYPES ====================

export type UsageMetric = 'episodes';

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
 * - Daily reset for episodesCreatedToday
 * - Upserting if no usage record exists
 *
 * @param userId - The user's ID
 * @param metric - Which metric to increment ('episodes')
 * @param amount - Amount to increment by (default: 1)
 */
export async function incrementUsage(
  userId: string,
  metric: UsageMetric,
  amount: number = 1
): Promise<void> {
  try {
    const increments: UsageIncrements = {};
    let estimatedCostUsd = 0;

    switch (metric) {
      case 'episodes':
        increments.episodesCreated = amount;
        estimatedCostUsd = amount * COST_PER_EPISODE;
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
 * Check if user can create more episodes today
 *
 * @param userId - The user's ID
 * @returns Whether the user can create more episodes
 */
export async function canCreateEpisode(userId: string): Promise<{
  allowed: boolean;
  remaining: number;
  limit: number;
}> {
  const DAILY_EPISODE_LIMIT = 20; // Default limit

  try {
    const usage = await prisma.userUsage.findUnique({
      where: { userId },
    });

    if (!usage) {
      return {
        allowed: true,
        remaining: DAILY_EPISODE_LIMIT,
        limit: DAILY_EPISODE_LIMIT,
      };
    }

    // Check if daily reset is needed
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const episodesToday = usage.dailyResetAt < startOfToday
      ? 0
      : (usage as any).episodesCreatedToday;

    const remaining = Math.max(0, DAILY_EPISODE_LIMIT - episodesToday);

    return {
      allowed: remaining > 0,
      remaining,
      limit: DAILY_EPISODE_LIMIT,
    };
  } catch (error) {
    logger.error(`Failed to check episode limit for user ${userId}:`, error);
    // Default to allowing on error
    return {
      allowed: true,
      remaining: DAILY_EPISODE_LIMIT,
      limit: DAILY_EPISODE_LIMIT,
    };
  }
}

// ==================== EXPORT ====================

export const usageService = {
  recordUsage,
  incrementUsage,
  canCreateEpisode,
};
