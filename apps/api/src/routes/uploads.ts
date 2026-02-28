/**
 * Upload Routes
 *
 * Handles S3 signed URL generation for media uploads.
 * Supports voiceover, clip, and slot_clip upload types.
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getUserId } from '../middleware/clerk.js';
import { validate } from '../middleware/validation.js';
import { requireUsageWithinLimits } from '../middleware/usageGuard.js';
import { s3Service } from '../services/s3.js';
import { queueService } from '../services/queue.js';
import { prisma } from '@webl/prisma';
import { logger } from '@webl/shared';

export const uploadsRouter = Router();

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

const UploadInitSchema = z.object({
  filename: z
    .string()
    .max(255)
    // Allow alphanumeric, dashes, underscores, and dots (relaxed for iOS filenames)
    .regex(/^[a-zA-Z0-9\-_.]+\.(mp4|mov|m4v|m4a|wav|mp3|webm)$/i, 'Invalid filename format'),
  contentType: z.enum([
    'video/mp4',
    'video/quicktime',
    'video/webm',
    'video/x-m4v',
    'audio/m4a',
    'audio/wav',
    'audio/mpeg',
  ]),
  fileSize: z
    .number()
    .positive()
    .max(5 * 1024 * 1024 * 1024, 'File too large (max 5GB)'),
  episodeId: z.string().cuid(),
  type: z.enum(['voiceover', 'voiceover_segment', 'clip', 'slot_clip']),
  // Slot-specific fields (required when type is 'slot_clip')
  slotId: z.string().min(1).max(50).optional(), // Increased max length for slot IDs
  slotType: SlotTypeEnum.optional(),
  source: SlotSourceEnum.optional(),
  // Voiceover segment fields
  segmentIndex: z.number().int().min(0).optional(),
  totalSegments: z.number().int().min(1).optional(),
});

const VoiceoverCompleteSchema = z.object({
  episodeId: z.string().cuid(),
  keys: z.array(z.string()).min(1),
  segmentCount: z.number().int().min(1),
});

const CompleteUploadSchema = z.object({
  key: z.string(),
  episodeId: z.string().cuid(),
  type: z.enum(['voiceover', 'clip', 'slot_clip']),
  // Slot-specific fields
  slotId: z.string().min(1).max(50).optional(), // Increased max length for slot IDs
  slotType: SlotTypeEnum.optional(),
  source: SlotSourceEnum.optional(),
  // Video metadata (optional, from client)
  duration: z.number().positive().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  fps: z.number().int().positive().optional(),
});

const MultipartInitSchema = z.object({
  filename: z.string().max(255),
  contentType: z.enum(['video/mp4', 'video/quicktime', 'video/webm']),
  episodeId: z.string().cuid(),
  type: z.enum(['clip', 'slot_clip']).optional(),
  slotId: z.string().min(1).max(20).optional(),
  slotType: SlotTypeEnum.optional(),
  source: SlotSourceEnum.optional(),
});

const VOICEOVER_READY_STATUSES = new Set([
  'voiceover_cleaned',
  'collecting_clips',
  'needs_more_clips',
  'chunking_clips',
  'enriching_chunks',
  'matching',
  'cut_plan_ready',
  'rendering',
  'ready',
  'published',
]);

type SlotRequirementsJson = {
  workflow?: string;
  slots?: Array<{
    slotId?: string;
    slotType?: string;
    priority?: string;
  }>;
} | null;

function isARollFirstTemplate(slotRequirements: SlotRequirementsJson): boolean {
  if (slotRequirements?.workflow === 'aroll_clean_then_broll') return true;

  const slots = slotRequirements?.slots;
  if (!Array.isArray(slots) || slots.length === 0) return false;

  const requiredSlots = slots.filter((slot) => slot.priority === 'required');
  if (requiredSlots.length === 0) return false;
  return requiredSlots[0]?.slotType === 'a_roll_face';
}

function shouldAutoStartVoiceoverFromSlotClip(args: {
  slotType: string;
  slotRequirements: SlotRequirementsJson;
  rawVoiceoverS3Key: string | null;
  cleanVoiceoverS3Key: string | null;
}): boolean {
  if (args.slotType !== 'a_roll_face') return false;
  if (!isARollFirstTemplate(args.slotRequirements)) return false;
  return !args.rawVoiceoverS3Key && !args.cleanVoiceoverS3Key;
}

function shouldBlockNonArollUploadUntilVoiceoverReady(args: {
  slotType: string;
  slotRequirements: SlotRequirementsJson;
  episodeStatus: string;
  cleanVoiceoverS3Key: string | null;
}): boolean {
  if (!isARollFirstTemplate(args.slotRequirements)) return false;
  if (args.slotType === 'a_roll_face') return false;
  if (args.cleanVoiceoverS3Key) return false;
  return !VOICEOVER_READY_STATUSES.has(args.episodeStatus);
}

// ==================== ROUTES ====================

/**
 * POST /api/uploads/init - Get S3 signed URL for upload
 */
uploadsRouter.post(
  '/init',
  validate({ body: UploadInitSchema }),
  async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { filename, contentType, episodeId, type, slotId, slotType } = req.body;

    // Validate slot_clip requires slotId and slotType
    if (type === 'slot_clip' && !slotId) {
      res.status(400).json({ error: 'slotId is required for slot_clip uploads' });
      return;
    }

    // Verify episode belongs to user
    const episode = await prisma.episode.findFirst({
      where: { id: episodeId, userId },
      select: {
        id: true,
        status: true,
        cleanVoiceoverS3Key: true,
        template: {
          select: {
            slotRequirements: true,
          },
        },
      },
    });

    if (!episode) {
      res.status(404).json({ error: 'Episode not found' });
      return;
    }

    if (type === 'slot_clip' && slotType) {
      const templateSlotRequirements = (episode.template?.slotRequirements ??
        null) as SlotRequirementsJson;
      if (
        shouldBlockNonArollUploadUntilVoiceoverReady({
          slotType,
          slotRequirements: templateSlotRequirements,
          episodeStatus: episode.status,
          cleanVoiceoverS3Key: episode.cleanVoiceoverS3Key,
        })
      ) {
        res.status(400).json({
          error: 'A-roll capture and voiceover cleaning must be completed first for this template.',
          details: {
            requiredFirstStep: 'Upload/record A-roll slot first and wait for voiceover_cleaned',
            currentStatus: episode.status,
            slotType,
          },
        });
        return;
      }
    }

    // Build S3 key based on upload type
    let key: string;
    const timestamp = Date.now();
    const { segmentIndex } = req.body;

    switch (type) {
      case 'voiceover':
        key = `users/${userId}/voiceovers/${episodeId}/${timestamp}_${filename}`;
        break;
      case 'voiceover_segment':
        // Include segment index in key for multi-segment uploads
        key = `users/${userId}/voiceovers/${episodeId}/segments/${timestamp}_seg${segmentIndex ?? 0}_${filename}`;
        break;
      case 'slot_clip':
        key = `users/${userId}/slots/${episodeId}/${slotId}_${timestamp}_${filename}`;
        break;
      case 'clip':
      default:
        key = `users/${userId}/clips/${episodeId}/${timestamp}_${filename}`;
        break;
    }

    try {
      const { url, fields } = await s3Service.getPresignedUploadUrl(key, contentType);
      res.json({ url, fields, key });
    } catch (error) {
      logger.error('Failed to generate presigned URL:', error);
      res.status(500).json({ error: 'Failed to generate upload URL' });
    }
  }
);

/**
 * POST /api/uploads/complete - Mark upload as complete
 *
 * For voiceovers: Creates voiceover_ingest job
 * For slot_clips: Creates SlotClip record and broll_ingest job
 * For clips: Legacy support - creates SlotClip with default values
 */
uploadsRouter.post(
  '/complete',
  requireUsageWithinLimits,
  validate({ body: CompleteUploadSchema }),
  async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { key, episodeId, type, slotId, slotType, source, duration, width, height, fps } =
      req.body;

    // Verify episode belongs to user
    const episode = await prisma.episode.findFirst({
      where: { id: episodeId, userId },
      select: {
        id: true,
        status: true,
        rawVoiceoverS3Key: true,
        cleanVoiceoverS3Key: true,
        template: {
          select: {
            slotRequirements: true,
          },
        },
      },
    });

    if (!episode) {
      res.status(404).json({ error: 'Episode not found' });
      return;
    }

    try {
      let jobId: string;

      if (type === 'voiceover') {
        // Update episode with voiceover S3 key
        await prisma.episode.update({
          where: { id: episodeId },
          data: {
            voiceoverS3Key: key,
            voiceoverPath: key, // Legacy field
            rawVoiceoverS3Key: key, // New field for Phase 1
            status: 'voiceover_uploaded',
          },
        });

        // Create voiceover_ingest job (NEW PIPELINE - Phase 1.1)
        const job = await prisma.job.create({
          data: {
            type: 'voiceover_ingest',
            status: 'pending',
            stage: 'starting',
            episodeId,
            userId,
            inputPaths: [key],
            metadata: { uploadType: 'voiceover' },
          },
        });

        // Queue voiceover_ingest job (with fallback if Redis fails)
        try {
          await queueService.addVoiceoverIngestJob({
            jobId: job.id,
            episodeId,
            userId,
            s3Key: key,
          });
          logger.info(`Voiceover upload complete: ${key}, job ${job.id} queued to Redis (NEW PIPELINE)`);
        } catch (error) {
          logger.warn(`Redis queue failed for job ${job.id}, but job created in DB. Workers will pick it up:`, error);
          await prisma.job.update({
            where: { id: job.id },
            data: {
              metadata: {
                uploadType: 'voiceover',
                queueRetryNeeded: true,
                queueError: error instanceof Error ? error.message : 'Redis connection failed',
              },
            },
          });
        }

        jobId = job.id;
        logger.info(`Voiceover upload complete: ${key}, job ${jobId} - Phase 1 pipeline started`);
      } else if (type === 'slot_clip') {
        // Validate slot_clip requirements
        if (!slotId || !slotType || !source) {
          res.status(400).json({
            error: 'slotId, slotType, and source are required for slot_clip uploads',
          });
          return;
        }

        const templateSlotRequirements = (episode.template?.slotRequirements ??
          null) as SlotRequirementsJson;

        if (
          shouldBlockNonArollUploadUntilVoiceoverReady({
            slotType,
            slotRequirements: templateSlotRequirements,
            episodeStatus: episode.status,
            cleanVoiceoverS3Key: episode.cleanVoiceoverS3Key,
          })
        ) {
          res.status(400).json({
            error: 'A-roll capture and voiceover cleaning must be completed first for this template.',
            details: {
              requiredFirstStep: 'Upload/record A-roll slot first and wait for voiceover_cleaned',
              currentStatus: episode.status,
              slotType,
            },
          });
          return;
        }

        // Determine orientation from dimensions
        let orientation: 'portrait' | 'landscape' | 'square' | undefined;
        if (width && height) {
          if (height > width) orientation = 'portrait';
          else if (width > height) orientation = 'landscape';
          else orientation = 'square';
        }

        // Create SlotClip record
        const slotClip = await prisma.slotClip.create({
          data: {
            episodeId,
            slotId,
            slotType,
            source,
            s3Key: key,
            duration,
            fps,
            orientation,
            width,
            height,
          },
        });

        let voiceoverJobId: string | null = null;
        const autoStartVoiceover = shouldAutoStartVoiceoverFromSlotClip({
          slotType,
          slotRequirements: templateSlotRequirements,
          rawVoiceoverS3Key: episode.rawVoiceoverS3Key,
          cleanVoiceoverS3Key: episode.cleanVoiceoverS3Key,
        });

        if (autoStartVoiceover) {
          await prisma.episode.update({
            where: { id: episodeId },
            data: {
              voiceoverS3Key: key,
              voiceoverPath: key,
              rawVoiceoverS3Key: key,
              status: 'voiceover_uploaded',
            },
          });

          const voiceoverJob = await prisma.job.create({
            data: {
              type: 'voiceover_ingest',
              status: 'pending',
              stage: 'starting',
              episodeId,
              userId,
              inputPaths: [key],
              metadata: {
                uploadType: 'slot_clip_aroll_voiceover',
                sourceSlotClipId: slotClip.id,
                slotId,
                slotType,
              },
            },
          });

          try {
            await queueService.addVoiceoverIngestJob({
              jobId: voiceoverJob.id,
              episodeId,
              userId,
              s3Key: key,
            });
            logger.info(
              `A-roll slot upload also queued voiceover_ingest ${voiceoverJob.id} for episode ${episodeId}`
            );
          } catch (error) {
            logger.warn(
              `Redis queue failed for voiceover job ${voiceoverJob.id}, but job created in DB.`,
              error
            );
            await prisma.job.update({
              where: { id: voiceoverJob.id },
              data: {
                metadata: {
                  uploadType: 'slot_clip_aroll_voiceover',
                  sourceSlotClipId: slotClip.id,
                  slotId,
                  slotType,
                  queueRetryNeeded: true,
                  queueError:
                    error instanceof Error ? error.message : 'Redis connection failed',
                },
              },
            });
          }

          voiceoverJobId = voiceoverJob.id;
        } else {
          // Update episode status for regular slot uploads
          const validStatuses = [
            'draft',
            'voiceover_uploaded',
            'voiceover_cleaning',
            'voiceover_cleaned',
            'needs_more_clips',
          ];
          const preserveVoiceoverStatus =
            isARollFirstTemplate(templateSlotRequirements) &&
            ['voiceover_uploaded', 'voiceover_cleaning'].includes(episode.status);

          if (!preserveVoiceoverStatus && validStatuses.includes(episode.status)) {
            await prisma.episode.update({
              where: { id: episodeId },
              data: { status: 'collecting_clips' },
            });
          }
        }

        const skipArollChunkPipeline =
          isARollFirstTemplate(templateSlotRequirements) && slotType === 'a_roll_face';

        if (skipArollChunkPipeline) {
          logger.info(
            `Skipping broll pipeline for A-roll-first slot clip ${slotClip.id}; waiting for optional B-roll uploads`
          );
          res.json({
            success: true,
            key,
            jobId: voiceoverJobId,
            slotClipId: slotClip.id,
            voiceoverJobId,
          });
          return;
        }

        // Create broll_ingest job (NEW PIPELINE - Phase 2.1)
        const job = await prisma.job.create({
          data: {
            type: 'broll_ingest',
            status: 'pending',
            stage: 'starting',
            episodeId,
            userId,
            inputPaths: [key],
            metadata: {
              uploadType: 'slot_clip',
              slotClipId: slotClip.id,
              slotId,
              slotType,
            },
          },
        });

        // Queue broll_ingest job (with fallback if Redis fails)
        try {
          await queueService.addBrollIngestJob({
            jobId: job.id,
            episodeId,
            userId,
            slotClipId: slotClip.id,
            s3Key: key,
          });
          logger.info(`Slot clip upload complete: ${key}, job ${job.id} queued to Redis (NEW PIPELINE)`);
        } catch (error) {
          logger.warn(`Redis queue failed for job ${job.id}, but job created in DB. Workers will pick it up:`, error);
          await prisma.job.update({
            where: { id: job.id },
            data: {
              metadata: {
                uploadType: 'slot_clip',
                slotClipId: slotClip.id,
                slotId,
                slotType,
                queueRetryNeeded: true,
                queueError: error instanceof Error ? error.message : 'Redis connection failed',
              },
            },
          });
        }

        jobId = job.id;
        logger.info(`Slot clip upload complete: ${key}, slotClip ${slotClip.id}, job ${jobId} - Phase 2 pipeline started`);

        res.json({
          success: true,
          key,
          jobId,
          slotClipId: slotClip.id,
          voiceoverJobId,
        });
        return;
      } else {
        // Legacy 'clip' type - treat as slot_clip with default values
        // Add clip to rawClipPaths array for legacy compatibility
        await prisma.episode.update({
          where: { id: episodeId },
          data: {
            rawClipPaths: { push: key },
              status: 'collecting_clips',
          },
        });

        // Create SlotClip with default slot
        const slotClip = await prisma.slotClip.create({
          data: {
            episodeId,
            slotId: 'B1', // Default B-roll slot
            slotType: 'b_roll_illustration',
            source: 'uploaded',
            s3Key: key,
            duration,
            fps,
            width,
            height,
          },
        });

        // Create broll_ingest job (NEW PIPELINE - Phase 2.1)
        const job = await prisma.job.create({
          data: {
            type: 'broll_ingest',
            status: 'pending',
            stage: 'starting',
            episodeId,
            userId,
            inputPaths: [key],
            metadata: {
              uploadType: 'clip',
              slotClipId: slotClip.id,
            },
          },
        });

        // Queue broll_ingest job (with fallback if Redis fails)
        try {
          await queueService.addBrollIngestJob({
            jobId: job.id,
            episodeId,
            userId,
            slotClipId: slotClip.id,
            s3Key: key,
          });
          logger.info(`Clip upload complete: ${key}, job ${job.id} queued to Redis (NEW PIPELINE)`);
        } catch (error) {
          logger.warn(`Redis queue failed for job ${job.id}, but job created in DB. Workers will pick it up:`, error);
          await prisma.job.update({
            where: { id: job.id },
            data: {
              metadata: {
                uploadType: 'clip',
                slotClipId: slotClip.id,
                queueRetryNeeded: true,
                queueError: error instanceof Error ? error.message : 'Redis connection failed',
              },
            },
          });
        }

        jobId = job.id;
        logger.info(`Clip upload complete (legacy): ${key}, slotClip ${slotClip.id} - Phase 2 pipeline started`);
      }

      res.json({ success: true, key, jobId });
    } catch (error) {
      logger.error('Failed to complete upload:', error);
      res.status(500).json({ error: 'Failed to complete upload' });
    }
  }
);

/**
 * POST /api/uploads/voiceover/complete - Complete multi-segment voiceover upload
 *
 * Handles voiceover uploads with multiple segments (per-beat recording).
 * Combines segment keys and creates a single Mux ingest job.
 */
uploadsRouter.post(
  '/voiceover/complete',
  requireUsageWithinLimits,
  validate({ body: VoiceoverCompleteSchema }),
  async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { episodeId, keys, segmentCount } = req.body;

    logger.info(`[voiceover/complete] Starting for episode ${episodeId}, segments: ${keys.length}`);

    try {
      // Verify episode belongs to user
      logger.info(`[voiceover/complete] Step 1: Finding episode ${episodeId}`);
      const episode = await prisma.episode.findFirst({
        where: { id: episodeId, userId },
      });

      if (!episode) {
        logger.warn(`[voiceover/complete] Episode ${episodeId} not found for user ${userId}`);
        res.status(404).json({ error: 'Episode not found' });
        return;
      }

      logger.info(`[voiceover/complete] Step 2: Updating episode with voiceover key`);
      // Store all segment keys in the episode
      // The first key is used as the primary voiceover key
      const primaryKey = keys[0];

      await prisma.episode.update({
        where: { id: episodeId },
        data: {
          voiceoverS3Key: primaryKey,
          voiceoverPath: primaryKey,
          status: 'voiceover_uploaded',
        },
      });

      logger.info(`[voiceover/complete] Step 3: Creating job in database`);
      // Create voiceover_ingest job (NEW PIPELINE - Phase 1.1)
      // Note: Multi-segment voiceovers use the first segment as the primary
      const job = await prisma.job.create({
        data: {
          type: 'voiceover_ingest',
          status: 'pending',
          stage: 'starting',
          episodeId,
          userId,
          inputPaths: keys, // All segment keys
          metadata: {
            uploadType: 'voiceover',
            segmentCount,
            isMultiSegment: segmentCount > 1,
          },
        },
      });

      logger.info(`[voiceover/complete] Step 4: Queueing job ${job.id} to Redis`);
      // Queue voiceover_ingest job (NEW PIPELINE)
      // If Redis fails, we still return success - job exists in DB and workers can poll for it
      try {
        await queueService.addVoiceoverIngestJob({
          jobId: job.id,
          episodeId,
          userId,
          s3Key: primaryKey,
        });
        logger.info(`[voiceover/complete] Job ${job.id} queued successfully to Redis (NEW PIPELINE)`);
      } catch (error) {
        // Redis connection failed, but job is in DB - workers can still process it
        logger.warn(`[voiceover/complete] Redis queue failed for job ${job.id}, but job created in DB. Workers will pick it up via polling:`, error);
        // Mark job as needing queue retry (optional - for monitoring)
        await prisma.job.update({
          where: { id: job.id },
          data: {
            metadata: {
              ...(job.metadata as object || {}),
              queueRetryNeeded: true,
              queueError: error instanceof Error ? error.message : 'Redis connection failed',
            },
          },
        });
      }

      logger.info(`[voiceover/complete] Step 5: Success - Voiceover upload complete: ${keys.length} segments, job ${job.id}`);

      res.json({
        success: true,
        key: primaryKey,
        keys,
        jobId: job.id,
      });
    } catch (error) {
      logger.error(`[voiceover/complete] Failed to complete voiceover upload:`, error);
      res.status(500).json({ error: 'Failed to complete voiceover upload' });
    }
  }
);

/**
 * POST /api/uploads/multipart/init - Initialize multipart upload
 */
uploadsRouter.post(
  '/multipart/init',
  validate({ body: MultipartInitSchema }),
  async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { filename, contentType, episodeId, type, slotId } = req.body;

    // Build S3 key based on upload type
    const timestamp = Date.now();
    let key: string;

    if (type === 'slot_clip' && slotId) {
      key = `users/${userId}/slots/${episodeId}/${slotId}_${timestamp}_${filename}`;
    } else {
      key = `users/${userId}/clips/${episodeId}/${timestamp}_${filename}`;
    }

    try {
      const uploadId = await s3Service.initiateMultipartUpload(key, contentType);
      res.json({ uploadId, key });
    } catch (error) {
      logger.error('Failed to initiate multipart upload:', error);
      res.status(500).json({ error: 'Failed to initiate multipart upload' });
    }
  }
);

/**
 * POST /api/uploads/multipart/url - Get URL for uploading a part
 */
const multipartUrlHandler = async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { key, uploadId, partNumber } = req.body;

  if (!key || !uploadId || !partNumber) {
    res.status(400).json({ error: 'key, uploadId, and partNumber are required' });
    return;
  }

  try {
    const url = await s3Service.getMultipartUploadUrl(key, uploadId, partNumber);
    res.json({ url });
  } catch (error) {
    logger.error('Failed to get multipart upload URL:', error);
    res.status(500).json({ error: 'Failed to get upload URL' });
  }
};

uploadsRouter.post('/multipart/url', multipartUrlHandler);

/**
 * POST /api/uploads/multipart/part - Alias for /multipart/url (for mobile compatibility)
 */
uploadsRouter.post('/multipart/part', multipartUrlHandler);

/**
 * POST /api/uploads/multipart/complete - Complete multipart upload
 */
uploadsRouter.post('/multipart/complete', requireUsageWithinLimits, async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { key, uploadId, parts, episodeId, slotId, slotType, source } = req.body;

  if (!key || !uploadId || !parts) {
    res.status(400).json({ error: 'key, uploadId, and parts are required' });
    return;
  }

  try {
    await s3Service.completeMultipartUpload(key, uploadId, parts);

    // If episodeId is provided, create the slot clip and job
    if (episodeId && userId) {
      // Verify episode belongs to user
      const episode = await prisma.episode.findFirst({
        where: { id: episodeId, userId },
        select: {
          id: true,
          status: true,
          rawVoiceoverS3Key: true,
          cleanVoiceoverS3Key: true,
          template: {
            select: {
              slotRequirements: true,
            },
          },
        },
      });

      if (episode) {
        const resolvedSlotType = slotType || 'b_roll_illustration';
        const resolvedSlotId = slotId || 'B1';
        const resolvedSource = source || 'uploaded';
        const templateSlotRequirements = (episode.template?.slotRequirements ??
          null) as SlotRequirementsJson;

        if (
          shouldBlockNonArollUploadUntilVoiceoverReady({
            slotType: resolvedSlotType,
            slotRequirements: templateSlotRequirements,
            episodeStatus: episode.status,
            cleanVoiceoverS3Key: episode.cleanVoiceoverS3Key,
          })
        ) {
          res.status(400).json({
            error: 'A-roll capture and voiceover cleaning must be completed first for this template.',
            details: {
              requiredFirstStep: 'Upload/record A-roll slot first and wait for voiceover_cleaned',
              currentStatus: episode.status,
              slotType: resolvedSlotType,
            },
          });
          return;
        }

        // Create SlotClip
        const slotClip = await prisma.slotClip.create({
          data: {
            episodeId,
            slotId: resolvedSlotId,
            slotType: resolvedSlotType,
            source: resolvedSource,
            s3Key: key,
          },
        });

        let voiceoverJobId: string | null = null;
        const autoStartVoiceover = shouldAutoStartVoiceoverFromSlotClip({
          slotType: resolvedSlotType,
          slotRequirements: templateSlotRequirements,
          rawVoiceoverS3Key: episode.rawVoiceoverS3Key,
          cleanVoiceoverS3Key: episode.cleanVoiceoverS3Key,
        });

        if (autoStartVoiceover) {
          await prisma.episode.update({
            where: { id: episodeId },
            data: {
              voiceoverS3Key: key,
              voiceoverPath: key,
              rawVoiceoverS3Key: key,
              status: 'voiceover_uploaded',
            },
          });

          const voiceoverJob = await prisma.job.create({
            data: {
              type: 'voiceover_ingest',
              status: 'pending',
              stage: 'starting',
              episodeId,
              userId,
              inputPaths: [key],
              metadata: {
                uploadType: 'slot_clip_aroll_voiceover',
                sourceSlotClipId: slotClip.id,
                slotId: resolvedSlotId,
                slotType: resolvedSlotType,
              },
            },
          });

          try {
            await queueService.addVoiceoverIngestJob({
              jobId: voiceoverJob.id,
              episodeId,
              userId,
              s3Key: key,
            });
            logger.info(
              `Multipart A-roll upload also queued voiceover_ingest ${voiceoverJob.id} for episode ${episodeId}`
            );
          } catch (error) {
            logger.warn(
              `Redis queue failed for voiceover job ${voiceoverJob.id}, but job created in DB.`,
              error
            );
            await prisma.job.update({
              where: { id: voiceoverJob.id },
              data: {
                metadata: {
                  uploadType: 'slot_clip_aroll_voiceover',
                  sourceSlotClipId: slotClip.id,
                  slotId: resolvedSlotId,
                  slotType: resolvedSlotType,
                  queueRetryNeeded: true,
                  queueError:
                    error instanceof Error ? error.message : 'Redis connection failed',
                },
              },
            });
          }

          voiceoverJobId = voiceoverJob.id;
        } else {
          // Update episode status for regular slot uploads
          const validStatuses = [
            'draft',
            'voiceover_uploaded',
            'voiceover_cleaning',
            'voiceover_cleaned',
            'needs_more_clips',
          ];
          const preserveVoiceoverStatus =
            isARollFirstTemplate(templateSlotRequirements) &&
            ['voiceover_uploaded', 'voiceover_cleaning'].includes(episode.status);

          if (!preserveVoiceoverStatus && validStatuses.includes(episode.status)) {
            await prisma.episode.update({
              where: { id: episodeId },
              data: { status: 'collecting_clips' },
            });
          }
        }

        const skipArollChunkPipeline =
          isARollFirstTemplate(templateSlotRequirements) && resolvedSlotType === 'a_roll_face';

        if (skipArollChunkPipeline) {
          logger.info(
            `Skipping multipart broll pipeline for A-roll-first slot clip ${slotClip.id}; waiting for optional B-roll uploads`
          );
          res.json({
            success: true,
            key,
            slotClipId: slotClip.id,
            jobId: voiceoverJobId,
            voiceoverJobId,
          });
          return;
        }

        // Create and queue broll_ingest job (NEW PIPELINE - Phase 2.1)
        const job = await prisma.job.create({
          data: {
            type: 'broll_ingest',
            status: 'pending',
            stage: 'starting',
            episodeId,
            userId,
            inputPaths: [key],
            metadata: {
              uploadType: 'slot_clip',
              slotClipId: slotClip.id,
              slotId: resolvedSlotId,
              slotType: resolvedSlotType,
            },
          },
        });

        try {
          await queueService.addBrollIngestJob({
            jobId: job.id,
            episodeId,
            userId,
            slotClipId: slotClip.id,
            s3Key: key,
          });
        } catch (error) {
          logger.warn(`Redis queue failed for job ${job.id}, but job created in DB. Workers will pick it up:`, error);
          await prisma.job.update({
            where: { id: job.id },
            data: {
              metadata: {
                uploadType: 'slot_clip',
                slotClipId: slotClip.id,
                slotId: resolvedSlotId,
                slotType: resolvedSlotType,
                queueRetryNeeded: true,
                queueError: error instanceof Error ? error.message : 'Redis connection failed',
              },
            },
          });
        }

        res.json({
          success: true,
          key,
          slotClipId: slotClip.id,
          jobId: job.id,
          voiceoverJobId,
        });
        return;
      }
    }

    res.json({ success: true, key });
  } catch (error) {
    logger.error('Failed to complete multipart upload:', error);
    res.status(500).json({ error: 'Failed to complete multipart upload' });
  }
});
