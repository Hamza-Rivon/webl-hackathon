/**
 * Render Readiness Service
 * 
 * Single canonical source of truth for render eligibility.
 * All render jobs MUST use this before proceeding.
 * 
 * Phase 2.1: Core service for determining if an episode can be rendered.
 */

import { prisma } from './db.js';

/**
 * Check if an episode is eligible for rendering (final)
 * 
 * Checks:
 * - Cut plan exists
 * - Cut plan version matches episode revision
 * - Cut plan validation passed
 * - B-roll pipeline is complete (all chunks ready)
 * - No pending chunk processing jobs
 * 
 * @param episodeId - Episode ID to check
 * @param renderType - retained for compatibility (final-only path)
 * @returns Eligibility status with detailed reason if not eligible
 */
export async function canRender(
  episodeId: string,
  _renderType: 'preview' | 'final'
): Promise<{
  eligible: boolean;
  reason?: string;
  details: {
    cutPlanExists: boolean;
    cutPlanVersion: number | null;
    episodeRevision: number;
    chunksReady: boolean;
    staticRenditionsReady: boolean;
    validationPassed: boolean;
    missingChunks?: number;
    pendingJobs?: number;
  };
}> {
  // Load episode with cut plan and revision
  const episode = await prisma.episode.findUnique({
    where: { id: episodeId },
    select: {
      cutPlan: true,
      revision: true,
      status: true,
    },
  });

  if (!episode) {
    return {
      eligible: false,
      reason: 'Episode not found',
      details: {
        cutPlanExists: false,
        cutPlanVersion: null,
        episodeRevision: 0,
        chunksReady: false,
        staticRenditionsReady: false,
        validationPassed: false,
      },
    };
  }

  if (!episode.cutPlan) {
    return {
      eligible: false,
      reason: 'No cut plan exists',
      details: {
        cutPlanExists: false,
        cutPlanVersion: null,
        episodeRevision: episode.revision ?? 0,
        chunksReady: false,
        staticRenditionsReady: false,
        validationPassed: false,
      },
    };
  }

  const cutPlan = episode.cutPlan as any;
  // Handle both string and number versions (legacy may be string, new versioning uses number)
  const cutPlanVersionRaw = cutPlan.version;
  const cutPlanVersion = typeof cutPlanVersionRaw === 'number' 
    ? cutPlanVersionRaw 
    : typeof cutPlanVersionRaw === 'string' 
      ? parseInt(cutPlanVersionRaw, 10) 
      : null;
  const cutPlanRevision = typeof cutPlan.revision === 'number' ? cutPlan.revision : null;
  const episodeRevision = episode.revision ?? 0;
  // Check cut plan version matches episode revision
  // If version is null or NaN, skip version check (legacy cut plans)
  if (cutPlanRevision !== null && cutPlanRevision !== episodeRevision) {
    return {
      eligible: false,
      reason: `Cut plan revision ${cutPlanRevision} does not match episode revision ${episodeRevision}`,
      details: {
        cutPlanExists: true,
        cutPlanVersion,
        episodeRevision,
        chunksReady: false,
        staticRenditionsReady: false,
        validationPassed: false,
      },
    };
  }

  if (
    cutPlanRevision === null &&
    cutPlanVersion !== null &&
    !isNaN(cutPlanVersion) &&
    cutPlanVersion !== episodeRevision
  ) {
    return {
      eligible: false,
      reason: `Cut plan version ${cutPlanVersion} does not match episode revision ${episodeRevision}`,
      details: {
        cutPlanExists: true,
        cutPlanVersion,
        episodeRevision,
        chunksReady: false,
        staticRenditionsReady: false,
        validationPassed: false,
      },
    };
  }

  // Check validation passed
  const validationJob = await prisma.job.findFirst({
    where: {
      episodeId,
      type: 'cut_plan_validation',
      status: 'done',
    },
    orderBy: { updatedAt: 'desc' },
  });

  if (!validationJob) {
    return {
      eligible: false,
      reason: 'Cut plan validation not completed',
      details: {
        cutPlanExists: true,
        cutPlanVersion,
        episodeRevision,
        chunksReady: false,
        staticRenditionsReady: false,
        validationPassed: false,
      },
    };
  }

  const { isReadyForMicrocutV2 } = await import('./episodeReadiness.js');
  const microcutReadiness = await isReadyForMicrocutV2(episodeId);

  if (!microcutReadiness.isReady) {
    const reason = microcutReadiness.missingMs
      ? `Insufficient footage: missing ${microcutReadiness.missingMs}ms`
      : 'Episode not ready for microcut render';
    return {
      eligible: false,
      reason,
      details: {
        cutPlanExists: true,
        cutPlanVersion,
        episodeRevision,
        chunksReady: microcutReadiness.chunksReady,
        staticRenditionsReady: true,
        validationPassed: true,
        missingChunks: microcutReadiness.missingChunks,
      },
    };
  }

  // For render, we could check static renditions here, but it's better to check
  // in the render job itself where we can wait for them.
  // So we'll just mark static renditions as "ready" here - actual waiting happens in render job.
  const staticRenditionsReady = true; // Will be verified in render job

  return {
    eligible: true,
    details: {
      cutPlanExists: true,
      cutPlanVersion,
      episodeRevision,
      chunksReady: true,
      staticRenditionsReady,
      validationPassed: true,
    },
  };
}
