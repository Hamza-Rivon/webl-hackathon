/**
 * Onboarding Routes
 *
 * Handles user onboarding flow and persona setup.
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getUserId } from '../middleware/clerk.js';
import { validate } from '../middleware/validation.js';
import { prisma } from '@webl/prisma';

export const onboardingRouter = Router();

/**
 * GET /api/onboarding/status - Check onboarding completion
 */
onboardingRouter.get('/status', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { onboarded: true },
  });

  res.json({ onboarded: user?.onboarded || false });
});

const PersonaSchema = z.object({
  niche: z.string().min(1).max(100),
  subNiche: z.string().max(100).optional(),
  targetAudience: z.string().min(1).max(200),
  tone: z.string().min(1).max(50),
  language: z.string().default('en'),
  platforms: z.array(z.enum(['tiktok', 'reels', 'shorts', 'all'])),
  offer: z.string().max(500).optional(),
  cta: z.string().max(200).optional(),
});

/**
 * POST /api/onboarding/persona - Save persona data
 */
onboardingRouter.post(
  '/persona',
  validate({ body: PersonaSchema }),
  async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const personaData = req.body;

    await prisma.persona.upsert({
      where: { userId },
      create: {
        userId,
        ...personaData,
      },
      update: personaData,
    });

    await prisma.user.update({
      where: { id: userId },
      data: { onboarded: true },
    });

    res.json({ success: true });
  }
);
