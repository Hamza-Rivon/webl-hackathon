/**
 * Templates Routes (Simplified)
 *
 * Lightweight endpoints for template listing and selection.
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '@webl/prisma';
import { getUserId } from '../middleware/clerk.js';
import { validate } from '../middleware/validation.js';
import { logger } from '@webl/shared';

export const templatesRouter = Router();

const listQuerySchema = z.object({
  platform: z.enum(['tiktok', 'reels', 'shorts', 'all']).optional(),
  niche: z.string().optional(),
  tone: z.string().optional(),
  limit: z.string().optional(),
  offset: z.string().optional(),
});

const searchSchema = z.object({
  query: z.string().min(2).max(200),
  limit: z.number().int().min(1).max(50).optional(),
});

function parsePagination(query: z.infer<typeof listQuerySchema>) {
  const limit = query.limit ? Math.min(50, Math.max(1, Number(query.limit))) : 50;
  const offset = query.offset ? Math.max(0, Number(query.offset)) : 0;
  return { limit, offset };
}

/**
 * GET /api/templates - List templates with filters
 */
templatesRouter.get('/', validate({ query: listQuerySchema }), async (req: Request, res: Response) => {
  try {
    const { platform, niche, tone } = req.query as z.infer<typeof listQuerySchema>;
    const { limit, offset } = parsePagination(req.query as z.infer<typeof listQuerySchema>);

    const templates = await prisma.template.findMany({
      where: {
        ...(platform ? { platform } : {}),
        ...(niche ? { niche } : {}),
        ...(tone ? { tone } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      skip: offset,
    });

    res.json(templates);
  } catch (error) {
    logger.error('Failed to list templates:', error);
    res.status(500).json({ error: 'Failed to fetch templates' });
  }
});

/**
 * GET /api/templates/recommended - Simple recommendations
 */
templatesRouter.get('/recommended', async (_req: Request, res: Response) => {
  try {
    const templates = await prisma.template.findMany({
      orderBy: [{ viewCount: 'desc' }, { updatedAt: 'desc' }],
      take: 12,
    });
    res.json(templates);
  } catch (error) {
    logger.error('Failed to get recommended templates:', error);
    res.status(500).json({ error: 'Failed to fetch recommended templates' });
  }
});

/**
 * GET /api/templates/:id - Fetch a single template
 */
templatesRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const template = await prisma.template.findUnique({
      where: { id: req.params.id },
    });

    if (!template) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }

    res.json(template);
  } catch (error) {
    logger.error('Failed to fetch template:', error);
    res.status(500).json({ error: 'Failed to fetch template' });
  }
});

/**
 * GET /api/templates/:id/requirements - Slot requirements only
 */
templatesRouter.get('/:id/requirements', async (req: Request, res: Response) => {
  try {
    const template = await prisma.template.findUnique({
      where: { id: req.params.id },
      select: { slotRequirements: true },
    });

    if (!template) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }

    res.json(template.slotRequirements ?? { slots: [] });
  } catch (error) {
    logger.error('Failed to fetch template requirements:', error);
    res.status(500).json({ error: 'Failed to fetch requirements' });
  }
});

/**
 * POST /api/templates/search - Text search
 */
templatesRouter.post(
  '/search',
  validate({ body: searchSchema }),
  async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    try {
      const { query, limit } = req.body as z.infer<typeof searchSchema>;
      const templates = await prisma.template.findMany({
        where: {
          OR: [
            { name: { contains: query, mode: 'insensitive' } },
            { description: { contains: query, mode: 'insensitive' } },
            { niche: { contains: query, mode: 'insensitive' } },
            { tone: { contains: query, mode: 'insensitive' } },
          ],
        },
        orderBy: { updatedAt: 'desc' },
        take: limit ?? 20,
      });

      res.json(templates);
    } catch (error) {
      logger.error('Failed to search templates:', error);
      res.status(500).json({ error: 'Failed to search templates' });
    }
  }
);

/**
 * POST /api/templates/:id/increment-view - Lightweight counter
 */
templatesRouter.post('/:id/increment-view', async (req: Request, res: Response) => {
  try {
    await prisma.template.update({
      where: { id: req.params.id },
      data: { viewCount: { increment: 1 } },
    });
    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to increment template view:', error);
    res.status(500).json({ error: 'Failed to increment template view' });
  }
});
