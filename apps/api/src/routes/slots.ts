/**
 * Slot Clip Routes
 *
 * CRUD operations for slot clips within episodes.
 * Slot clips are individual video clips captured for template slots.
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getUserId } from '../middleware/clerk.js';
import { validate } from '../middleware/validation.js';
import { prisma } from '@webl/prisma';
import { s3Service } from '../services/s3.js';
import { muxService } from '../services/mux.js';
import { logger } from '@webl/shared';

export const slotsRouter = Router();

// ==================== SCHEMAS ====================

const SlotTypeEnum = z.enum([
  'a_roll_face',
  'b_roll_illustration',
  'b_roll_action',
  'screen_record',
  'product_shot',
  'pattern_interrupt',
  'cta_overlay',
]);

const SlotSourceEnum = z.enum(['recorded', 'uploaded']);

const VideoOrientationEnum = z.enum(['portrait', 'landscape', 'square']);

const CreateSlotClipSchema = z.object({
  slotId: z.string().min(1).max(20),
  slotType: SlotTypeEnum,
  source: SlotSourceEnum,
  s3Key: z.string().min(1).max(500),
  duration: z.number().positive().optional(),
  fps: z.number().int().positive().optional(),
  orientation: VideoOrientationEnum.optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});

const UpdateSlotClipSchema = z.object({
  muxAssetId: z.string().optional(),
  muxPlaybackId: z.string().optional(),
  duration: z.number().positive().optional(),
  fps: z.number().int().positive().optional(),
  orientation: VideoOrientationEnum.optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  aiTags: z.array(z.string()).optional(),
  aiSummary: z.string().optional(),
  moderationStatus: z.enum(['safe', 'review', 'blocked']).optional(),
  selectedSegments: z
    .array(
      z.object({
        startTime: z.number(),
        endTime: z.number(),
        score: z.number().optional(),
      })
    )
    .optional(),
});

// ==================== ROUTES ====================

/**
 * GET /api/episodes/:episodeId/slots - List slot clips for episode
 */
slotsRouter.get('/episodes/:episodeId/slots', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { episodeId } = req.params;

  // Verify episode belongs to user
  const episode = await prisma.episode.findFirst({
    where: { id: episodeId, userId },
    include: { template: true },
  });

  if (!episode) {
    res.status(404).json({ error: 'Episode not found' });
    return;
  }

  const slotClips = await prisma.slotClip.findMany({
    where: { episodeId },
    orderBy: [{ slotId: 'asc' }, { createdAt: 'asc' }],
  });

  // Generate playback URLs for clips with Mux playback IDs
  const clipsWithUrls = slotClips.map((clip: typeof slotClips[0]) => ({
    ...clip,
    playbackUrl: clip.muxPlaybackId ? muxService.getPlaybackUrl(clip.muxPlaybackId) : null,
    thumbnailUrl: clip.muxPlaybackId
      ? muxService.getThumbnailUrl(clip.muxPlaybackId, { time: 1, width: 320 })
      : null,
  }));

  // Get template slot requirements for progress calculation
  const slotRequirements = episode.template?.slotRequirements as {
    slots?: Array<{
      slotId: string;
      slotType: string;
      priority: string;
      duration: { min: number; target: number; max: number };
    }>;
  } | null;

  // Calculate slot progress
  const slotProgress = slotRequirements?.slots?.map((req) => {
    const clips = clipsWithUrls.filter((c: typeof clipsWithUrls[0]) => c.slotId === req.slotId);
    const totalDuration = clips.reduce((sum: number, c: typeof clipsWithUrls[0]) => sum + (c.duration ?? 0), 0);
    const meetsRequirement = totalDuration >= req.duration.min;

    return {
      slotId: req.slotId,
      slotType: req.slotType,
      required: req.priority === 'required',
      clips: clips.map((c: typeof clipsWithUrls[0]) => ({
        id: c.id,
        duration: c.duration,
        muxPlaybackId: c.muxPlaybackId,
        status: c.muxAssetId ? 'ready' : 'processing',
      })),
      totalDuration,
      targetDuration: req.duration.target,
      meetsRequirement,
    };
  });

  const requiredSlots = slotProgress?.filter((s) => s.required) ?? [];
  const optionalSlots = slotProgress?.filter((s) => !s.required) ?? [];

  res.json({
    slotClips: clipsWithUrls, // Changed from "clips" to "slotClips" to match mobile app expectations
    progress: {
      episodeId,
      totalRequired: requiredSlots.length,
      completedRequired: requiredSlots.filter((s) => s.meetsRequirement).length,
      totalOptional: optionalSlots.length,
      completedOptional: optionalSlots.filter((s) => s.clips.length > 0).length,
      slots: slotProgress ?? [],
      canProceed: requiredSlots.every((s) => s.meetsRequirement),
    },
  });
});

/**
 * POST /api/episodes/:episodeId/slots - Create slot clip
 */
slotsRouter.post(
  '/episodes/:episodeId/slots',
  validate({ body: CreateSlotClipSchema }),
  async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { episodeId } = req.params;
    const { slotId, slotType, source, s3Key, duration, fps, orientation, width, height } = req.body;

    // Verify episode belongs to user
    const episode = await prisma.episode.findFirst({
      where: { id: episodeId, userId },
    });

    if (!episode) {
      res.status(404).json({ error: 'Episode not found' });
      return;
    }

    try {
      const slotClip = await prisma.slotClip.create({
        data: {
          episode: { connect: { id: episodeId } },
          slotId,
          slotType,
          source,
          s3Key,
          duration,
          fps,
          orientation,
          width,
          height,
        },
      });

      // Update episode status if this is the first slot clip
      const validStatuses = [
        'draft',
        'voiceover_uploaded',
        'voiceover_cleaning',
        'voiceover_cleaned',
        'needs_more_clips',
      ];
      if (validStatuses.includes(episode.status)) {
        await prisma.episode.update({
          where: { id: episodeId },
          data: { status: 'collecting_clips' },
        });
      }

      logger.info(`Slot clip created: ${slotClip.id} for episode ${episodeId}, slot ${slotId}`);

      res.status(201).json(slotClip);
    } catch (error) {
      logger.error('Failed to create slot clip:', error);
      res.status(500).json({ error: 'Failed to create slot clip' });
    }
  }
);

/**
 * GET /api/slots/:id - Get slot clip details
 */
slotsRouter.get('/slots/:id', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const slotClip = await prisma.slotClip.findFirst({
    where: { id: req.params.id },
    include: {
      episode: {
        select: { userId: true, id: true, title: true },
      },
    },
  });

  if (!slotClip || slotClip.episode.userId !== userId) {
    res.status(404).json({ error: 'Slot clip not found' });
    return;
  }

  // Generate URLs
  const playbackUrl = slotClip.muxPlaybackId
    ? muxService.getPlaybackUrl(slotClip.muxPlaybackId)
    : null;
  const thumbnailUrl = slotClip.muxPlaybackId
    ? muxService.getThumbnailUrl(slotClip.muxPlaybackId, { time: 1 })
    : null;

  let downloadUrl: string | null = null;
  try {
    downloadUrl = await s3Service.getSignedDownloadUrl(slotClip.s3Key);
  } catch (e) {
    logger.warn(`Failed to generate download URL for slot clip ${slotClip.id}`);
  }

  res.json({
    ...slotClip,
    playbackUrl,
    thumbnailUrl,
    downloadUrl,
    episode: {
      id: slotClip.episode.id,
      title: slotClip.episode.title,
    },
  });
});

/**
 * PUT /api/slots/:id - Update slot clip
 */
slotsRouter.put(
  '/slots/:id',
  validate({ body: UpdateSlotClipSchema }),
  async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // Verify ownership
    const existing = await prisma.slotClip.findFirst({
      where: { id: req.params.id },
      include: { episode: { select: { userId: true } } },
    });

    if (!existing || existing.episode.userId !== userId) {
      res.status(404).json({ error: 'Slot clip not found' });
      return;
    }

    try {
      const updated = await prisma.slotClip.update({
        where: { id: req.params.id },
        data: req.body,
      });

      res.json(updated);
    } catch (error) {
      logger.error(`Failed to update slot clip ${req.params.id}:`, error);
      res.status(500).json({ error: 'Failed to update slot clip' });
    }
  }
);

/**
 * DELETE /api/slots/:id - Delete slot clip
 */
slotsRouter.delete('/slots/:id', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  // Verify ownership
  const existing = await prisma.slotClip.findFirst({
    where: { id: req.params.id },
    include: { episode: { select: { userId: true } } },
  });

  if (!existing || existing.episode.userId !== userId) {
    res.status(404).json({ error: 'Slot clip not found' });
    return;
  }

  try {
    // Delete Mux asset if exists
    if (existing.muxAssetId) {
      try {
        await muxService.deleteAsset(existing.muxAssetId);
      } catch (e) {
        logger.warn(`Failed to delete Mux asset for slot clip ${existing.id}`);
      }
    }

    await prisma.slotClip.delete({
      where: { id: req.params.id },
    });

    logger.info(`Slot clip deleted: ${req.params.id}`);

    res.json({ success: true });
  } catch (error) {
    logger.error(`Failed to delete slot clip ${req.params.id}:`, error);
    res.status(500).json({ error: 'Failed to delete slot clip' });
  }
});

/**
 * GET /api/slots/:id/download-url - Get signed download URL
 */
slotsRouter.get('/slots/:id/download-url', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const slotClip = await prisma.slotClip.findFirst({
    where: { id: req.params.id },
    include: { episode: { select: { userId: true } } },
  });

  if (!slotClip || slotClip.episode.userId !== userId) {
    res.status(404).json({ error: 'Slot clip not found' });
    return;
  }

  try {
    const url = await s3Service.getSignedDownloadUrl(slotClip.s3Key, 3600);
    res.json({ url });
  } catch (error) {
    logger.error(`Failed to generate download URL for slot clip ${req.params.id}:`, error);
    res.status(500).json({ error: 'Failed to generate download URL' });
  }
});
