/**
 * Usage Guard — Shared Hard Limit Evaluation
 *
 * Pure function that evaluates whether a user is within their hard usage limits.
 * Used by both API middleware and Worker job handlers before external API calls.
 *
 * Limits are stored per-user in the UserUsage table and can be edited directly
 * in the database. When Stripe is integrated, webhooks will update these limits
 * based on subscription tier.
 */

// ==================== TYPES ====================

export interface UsageLimitEntry {
  current: number;
  max: number;
  pct: number;
}

export interface UsageLimitStatus {
  allowed: boolean;
  reason: string | null;
  limits: {
    externalApiCalls: UsageLimitEntry;
    llmCalls: UsageLimitEntry;
    embeddingCalls: UsageLimitEntry;
    episodes: UsageLimitEntry;
    renders: UsageLimitEntry;
    estimatedCost: UsageLimitEntry;
  };
  warnings: string[];
  subscriptionActive: boolean;
  subscriptionTier: string;
}

/**
 * Minimal shape of the User model fields needed for evaluation.
 * Both API and Workers query their own Prisma client and pass the result here.
 */
export interface UsageGuardUser {
  subscriptionActive: boolean;
  subscriptionTier: string;
}

/**
 * Minimal shape of the UserUsage model fields needed for evaluation.
 */
export interface UsageGuardUsage {
  // Lifetime totals (current values)
  totalExternalApiCalls: number;
  totalLlmCalls: number;
  totalEmbeddingCalls: number;
  totalEpisodesCreated: number;
  totalRendersCompleted: number;
  totalEstimatedCostUSD: number;

  // Hard limits (max values)
  maxTotalExternalApiCalls: number;
  maxTotalLlmCalls: number;
  maxTotalEmbeddingCalls: number;
  maxTotalEpisodesCreated: number;
  maxTotalRendersCompleted: number;
  maxEstimatedCostUSD: number;
}

// ==================== CONSTANTS ====================

/** Percentage threshold at which warnings are emitted */
const WARNING_THRESHOLD_PCT = 80;

// ==================== HELPERS ====================

function buildEntry(current: number, max: number): UsageLimitEntry {
  const pct = max > 0 ? Math.min(100, Math.round((current / max) * 100)) : 0;
  return { current, max, pct };
}

function checkExceeded(label: string, current: number, max: number): string | null {
  if (max > 0 && current >= max) {
    return `${label} limit reached (${current}/${max})`;
  }
  return null;
}

function checkWarning(label: string, current: number, max: number): string | null {
  if (max > 0) {
    const pct = (current / max) * 100;
    if (pct >= WARNING_THRESHOLD_PCT && pct < 100) {
      return `${label} at ${Math.round(pct)}% of limit (${current}/${max})`;
    }
  }
  return null;
}

// ==================== MAIN FUNCTION ====================

/**
 * Evaluate whether a user is within their hard usage limits.
 *
 * @param user - User model fields (subscriptionActive, subscriptionTier)
 * @param usage - UserUsage model fields (totals + max limits), or null if no usage record exists
 * @returns UsageLimitStatus with allowed flag, reason, limits breakdown, and warnings
 */
export function evaluateUsageLimits(
  user: UsageGuardUser,
  usage: UsageGuardUsage | null
): UsageLimitStatus {
  // Default limits for users with no usage record yet
  const defaultLimits: UsageGuardUsage = {
    totalExternalApiCalls: 0,
    totalLlmCalls: 0,
    totalEmbeddingCalls: 0,
    totalEpisodesCreated: 0,
    totalRendersCompleted: 0,
    totalEstimatedCostUSD: 0,
    maxTotalExternalApiCalls: 500,
    maxTotalLlmCalls: 200,
    maxTotalEmbeddingCalls: 300,
    maxTotalEpisodesCreated: 50,
    maxTotalRendersCompleted: 20,
    maxEstimatedCostUSD: 10.0,
  };

  const u = usage ?? defaultLimits;

  // Build limit entries
  const limits = {
    externalApiCalls: buildEntry(u.totalExternalApiCalls, u.maxTotalExternalApiCalls),
    llmCalls: buildEntry(u.totalLlmCalls, u.maxTotalLlmCalls),
    embeddingCalls: buildEntry(u.totalEmbeddingCalls, u.maxTotalEmbeddingCalls),
    episodes: buildEntry(u.totalEpisodesCreated, u.maxTotalEpisodesCreated),
    renders: buildEntry(u.totalRendersCompleted, u.maxTotalRendersCompleted),
    estimatedCost: buildEntry(u.totalEstimatedCostUSD, u.maxEstimatedCostUSD),
  };

  // Check master kill switch first
  if (!user.subscriptionActive) {
    return {
      allowed: false,
      reason: 'Account suspended — subscription is not active',
      limits,
      warnings: [],
      subscriptionActive: false,
      subscriptionTier: user.subscriptionTier,
    };
  }

  // Check hard limits — find the first exceeded limit
  const exceeded =
    checkExceeded('External API calls', u.totalExternalApiCalls, u.maxTotalExternalApiCalls) ??
    checkExceeded('LLM calls', u.totalLlmCalls, u.maxTotalLlmCalls) ??
    checkExceeded('Embedding calls', u.totalEmbeddingCalls, u.maxTotalEmbeddingCalls) ??
    checkExceeded('Episodes created', u.totalEpisodesCreated, u.maxTotalEpisodesCreated) ??
    checkExceeded('Renders completed', u.totalRendersCompleted, u.maxTotalRendersCompleted) ??
    checkExceeded('Estimated cost', u.totalEstimatedCostUSD, u.maxEstimatedCostUSD);

  if (exceeded) {
    return {
      allowed: false,
      reason: exceeded,
      limits,
      warnings: [],
      subscriptionActive: true,
      subscriptionTier: user.subscriptionTier,
    };
  }

  // Collect warnings for metrics approaching limits
  const warnings: string[] = [];
  const w1 = checkWarning('External API calls', u.totalExternalApiCalls, u.maxTotalExternalApiCalls);
  const w2 = checkWarning('LLM calls', u.totalLlmCalls, u.maxTotalLlmCalls);
  const w3 = checkWarning('Embedding calls', u.totalEmbeddingCalls, u.maxTotalEmbeddingCalls);
  const w4 = checkWarning('Episodes created', u.totalEpisodesCreated, u.maxTotalEpisodesCreated);
  const w5 = checkWarning('Renders completed', u.totalRendersCompleted, u.maxTotalRendersCompleted);
  const w6 = checkWarning('Estimated cost', u.totalEstimatedCostUSD, u.maxEstimatedCostUSD);
  if (w1) warnings.push(w1);
  if (w2) warnings.push(w2);
  if (w3) warnings.push(w3);
  if (w4) warnings.push(w4);
  if (w5) warnings.push(w5);
  if (w6) warnings.push(w6);

  return {
    allowed: true,
    reason: null,
    limits,
    warnings,
    subscriptionActive: true,
    subscriptionTier: user.subscriptionTier,
  };
}
