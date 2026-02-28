/**
 * Series Routes
 *
 * CRUD operations for content series.
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getUserId } from '../middleware/clerk.js';
import { validate } from '../middleware/validation.js';
import { prisma } from '@webl/prisma';

export const seriesRouter = Router();

const CreateSeriesSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  cadence: z.enum(['daily', 'weekly', 'biweekly', 'monthly']).default('weekly'),
  templateId: z.string().cuid().optional(),
});

const UpdateSeriesSchema = CreateSeriesSchema.partial();

/**
 * GET /api/series - List user's series
 */
seriesRouter.get('/', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const series = await prisma.series.findMany({
    where: { userId },
    include: { _count: { select: { episodes: true } } },
    orderBy: { updatedAt: 'desc' },
  });

  res.json(series);
});

/**
 * POST /api/series - Create new series
 */
seriesRouter.post(
  '/',
  validate({ body: CreateSeriesSchema }),
  async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const series = await prisma.series.create({
      data: { ...req.body, userId },
    });

    res.status(201).json(series);
  }
);

/**
 * GET /api/series/:id - Get series details
 */
seriesRouter.get('/:id', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const series = await prisma.series.findFirst({
    where: { id: req.params.id, userId },
    include: { episodes: { orderBy: { createdAt: 'desc' } } },
  });

  if (!series) {
    res.status(404).json({ error: 'Series not found' });
    return;
  }

  res.json(series);
});

/**
 * PUT /api/series/:id - Update series
 */
seriesRouter.put(
  '/:id',
  validate({ body: UpdateSeriesSchema }),
  async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const series = await prisma.series.updateMany({
      where: { id: req.params.id, userId },
      data: req.body,
    });

    if (series.count === 0) {
      res.status(404).json({ error: 'Series not found' });
      return;
    }

    res.json({ success: true });
  }
);

/**
 * DELETE /api/series/:id - Delete series
 */
seriesRouter.delete('/:id', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  await prisma.series.deleteMany({
    where: { id: req.params.id, userId },
  });

  res.json({ success: true });
});
