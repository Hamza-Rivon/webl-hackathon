/**
 * Usage Guard Middleware
 *
 * Checks hard usage limits and subscription status before allowing
 * cost-incurring operations (LLM calls, embeddings, renders, etc.).
 *
 * Returns 403 if the user has exceeded their limits or subscription is inactive.
 * Returns 200-series normally if within limits.
 */

import type { Request, Response, NextFunction } from 'express';
import { getUserId } from './clerk.js';
import { prisma } from '@webl/prisma';
import { evaluateUsageLimits, logger } from '@webl/shared';

/**
 * Express middleware that checks usage limits before proceeding.
 * Mount on cost-incurring routes (create episode, process, render, generate, etc.).
 */
export async function requireUsageWithinLimits(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        subscriptionActive: true,
        subscriptionTier: true,
      },
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
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
      logger.warn(`Usage guard blocked request for user ${userId}: ${status.reason}`, {
        path: req.path,
        method: req.method,
      });

      res.status(403).json({
        error: 'Usage limit exceeded',
        reason: status.reason,
        limits: status.limits,
        subscriptionActive: status.subscriptionActive,
      });
      return;
    }

    // Attach warnings to response headers for frontend awareness
    if (status.warnings.length > 0) {
      res.setHeader('X-Usage-Warnings', JSON.stringify(status.warnings));
    }

    next();
  } catch (error) {
    // On error, allow the request through to avoid blocking users due to tracking issues
    logger.error(`Usage guard error for user ${userId}:`, error);
    next();
  }
}
