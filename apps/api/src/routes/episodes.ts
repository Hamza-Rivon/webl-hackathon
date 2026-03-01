/**
 * Episode Routes
 *
 * CRUD operations for episodes with template-copy workflow support.
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getUserId } from '../middleware/clerk.js';
import { validate } from '../middleware/validation.js';
import { withIdempotency } from '../middleware/idempotency.js';
import { requireUsageWithinLimits } from '../middleware/usageGuard.js';
import { prisma } from '@webl/prisma';
import { geminiService } from '../services/gemini.js';
import { s3Service } from '../services/s3.js';
import { muxService } from '../services/mux.js';
import { queueService } from '../services/queue.js';
import { usageService } from '../services/usage.js';
import { decrypt } from '../services/encryption.js';
import {
  logger,
  extractNormalizedKeytermCandidatesFromScript,
  normalizeKeytermTerm,
  CHUNK_DURATION_MS,
} from '@webl/shared';

export const episodesRouter = Router();

// ==================== SCHEMAS ====================

const CreateEpisodeSchema = z.object({
  title: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[a-zA-Z0-9\s\-_.,!?'"]+$/, 'Invalid characters'),
  seriesId: z.string().cuid().optional(),
  templateId: z.string().cuid(),
  scriptContent: z.string().max(10000).optional(),
  mode: z.enum(['template_copy', 'auto_edit']).optional().default('template_copy'),
});

const UpdateEpisodeSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  seriesId: z.string().cuid().nullable().optional(),
  templateId: z.string().cuid().nullable().optional(),
  scriptContent: z.string().max(10000).optional(),
  scriptBeats: z.array(z.any()).optional(),
});

const RegenerateScriptSchema = z.object({
  topic: z.string().max(500).optional(),
  archetype: z.string().max(50).optional(),
});

const UpdateScriptSchema = z.object({
  scriptContent: z.string().min(1).max(10000),
});

const KeytermCategorySchema = z.enum([
  'company',
  'product',
  'jargon',
  'non_english',
  'person',
  'location',
  'other',
]);

const AddEpisodeKeytermSchema = z.object({
  term: z.string().min(1).max(80),
  category: KeytermCategorySchema.default('other'),
  language: z.string().max(16).optional(),
});

const ResumeEpisodeSchema = z.object({
  execute: z.boolean().optional().default(false),
});

// ==================== HELPER FUNCTIONS ====================

function getSingleParamValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

const ALLOWED_TEMPLATE_NAME_KEYS = new Set(['arollcleanthenbroll', 'purebroll60s']);

function normalizeTemplateNameKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isAllowedEpisodeTemplateName(name: string): boolean {
  return ALLOWED_TEMPLATE_NAME_KEYS.has(normalizeTemplateNameKey(name));
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function toSafeVideoFilename(title: string): string {
  const normalized = title
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `${normalized || 'webl_video'}.mp4`;
}

function parseElevenLabsErrorPayload(raw: string): {
  code?: string;
  message?: string;
  status?: string;
} | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as {
      detail?: {
        code?: string;
        message?: string;
        status?: string;
      };
      message?: string;
      code?: string;
      status?: string;
    };

    if (parsed?.detail) {
      return {
        code: parsed.detail.code,
        message: parsed.detail.message,
        status: parsed.detail.status,
      };
    }

    return {
      code: parsed?.code,
      message: parsed?.message,
      status: parsed?.status,
    };
  } catch {
    return null;
  }
}

function getEffectiveRequiredSlotIds(slotRequirements: {
  workflow?: string;
  slots?: Array<{
    slotId?: string;
    slotType?: string;
    priority?: 'required' | 'optional' | string;
  }>;
} | null | undefined): string[] {
  const slots = slotRequirements?.slots ?? [];
  const required = slots
    .filter((slot) => slot.priority === 'required' && typeof slot.slotId === 'string')
    .map((slot) => slot.slotId as string);

  // For A-roll-first workflow, enforce at least one B-roll upload before matching.
  if (slotRequirements?.workflow === 'aroll_clean_then_broll') {
    const hasRequiredBroll = slots.some(
      (slot) =>
        slot.priority === 'required' &&
        typeof slot.slotType === 'string' &&
        slot.slotType.startsWith('b_roll')
    );

    if (!hasRequiredBroll) {
      const fallbackBroll = slots.find(
        (slot) =>
          typeof slot.slotId === 'string' &&
          typeof slot.slotType === 'string' &&
          slot.slotType.startsWith('b_roll')
      );
      if (fallbackBroll?.slotId) {
        required.push(fallbackBroll.slotId);
      }
    }
  }

  return [...new Set(required)];
}

async function syncEpisodeKeytermsFromLibrary(args: {
  episodeId: string;
  userId: string;
  scriptContent: string;
}): Promise<void> {
  const maxKeyterms = 50;
  const candidates = extractNormalizedKeytermCandidatesFromScript(args.scriptContent, {
    maxPhraseLen: 4,
    maxCandidates: 6000,
  });
  if (candidates.length === 0) return;

  const matched = await prisma.keyterm.findMany({
    where: {
      userId: args.userId,
      normalizedTerm: { in: candidates },
    },
    orderBy: [{ usageCount: 'desc' }, { updatedAt: 'desc' }],
    take: maxKeyterms,
    select: { id: true },
  });

  if (matched.length === 0) return;

  await prisma.episodeKeyterm.createMany({
    data: matched.map((m: { id: string }) => ({
      episodeId: args.episodeId,
      keytermId: m.id,
      source: 'matched',
      confirmed: true,
    })),
    skipDuplicates: true,
  });
}

/**
 * Format episode response with Mux URLs
 */
async function formatEpisodeResponse(episode: {
  id: string;
  title: string;
  status: string;
  mode: string;
  templateId: string | null;
  templateVersion: string | null;
  scriptContent: string | null;
  scriptBeats: unknown;
  voiceoverS3Key: string | null;
  finalS3Key: string | null;
  muxVoiceoverAssetId: string | null;
  rawVoiceoverMuxAssetId: string | null;
  rawVoiceoverPlaybackId: string | null;
  rawVoiceoverDuration: number | null;
  cleanVoiceoverS3Key: string | null;
  cleanVoiceoverMuxAssetId: string | null;
  cleanVoiceoverPlaybackId: string | null;
  cleanVoiceoverDuration: number | null;
  muxClipAssetIds: string[];
  muxFinalAssetId: string | null;
  muxFinalPlaybackId: string | null;
  templateCompile: unknown;
  renderSpec: unknown;
  voiceoverPath: string | null;
  rawClipPaths: string[];
  proxyPaths: string[];
  finalVideoPath: string | null;
  thumbnailPath: string | null;
  editPlan: unknown;
  duration: number | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  seriesId: string | null;
  userId: string;
  series?: { id: string; name: string } | null;
  template?: { id: string; name: string; platform: string; slotRequirements: unknown } | null;
  jobs?: Array<{ id: string; type: string; status: string; progress: number }>;
  slotClips?: Array<{
    id: string;
    slotId: string;
    slotType: string;
    muxPlaybackId: string | null;
    duration: number | null;
  }>;
}) {
  // Generate Mux playback URL
  let muxPlaybackUrl: string | null = null;
  let thumbnailUrl: string | null = null;

  if (episode.muxFinalPlaybackId) {
    muxPlaybackUrl = muxService.getPlaybackUrl(episode.muxFinalPlaybackId);
    thumbnailUrl = muxService.getThumbnailUrl(episode.muxFinalPlaybackId, {
      time: 1,
      width: 640,
    });
  }

  // Generate S3 download URLs
  let finalVideoUrl: string | null = null;
  let legacyFinalVideoUrl: string | null = null;

  if (episode.finalS3Key) {
    try {
      finalVideoUrl = await s3Service.getSignedDownloadUrl(episode.finalS3Key);
    } catch (e) {
      logger.warn(`Failed to generate final video URL for episode ${episode.id}`);
    }
  }

  // Legacy field support
  if (episode.finalVideoPath) {
    try {
      if (isHttpUrl(episode.finalVideoPath)) {
        legacyFinalVideoUrl = episode.finalVideoPath;
      } else {
        legacyFinalVideoUrl = await s3Service.getSignedDownloadUrl(episode.finalVideoPath);
      }
    } catch (e) {
      logger.warn(`Failed to generate legacy video URL for episode ${episode.id}`);
    }
  }

  // Extract data from templateCompile
  const templateCompile = episode.templateCompile as {
    complianceScore?: number;
    slotPlan?: unknown;
    beatPlan?: unknown;
  } | null;
  const renderSpec = episode.renderSpec as Record<string, unknown> | null;
  const arollCleanPreviewS3Key =
    typeof renderSpec?.arollCleanPreviewS3Key === 'string'
      ? renderSpec.arollCleanPreviewS3Key
      : null;
  const arollCleanPreviewMuxAssetId =
    typeof renderSpec?.arollCleanPreviewMuxAssetId === 'string'
      ? renderSpec.arollCleanPreviewMuxAssetId
      : null;
  const arollCleanPreviewPlaybackId =
    typeof renderSpec?.arollCleanPreviewPlaybackId === 'string'
      ? renderSpec.arollCleanPreviewPlaybackId
      : null;
  const arollCleanPreviewDuration =
    typeof renderSpec?.arollCleanPreviewDuration === 'number'
      ? renderSpec.arollCleanPreviewDuration
      : null;

  // Resolve raw voiceover playback ID (lazy-fetch from Mux for existing episodes)
  let rawVoiceoverPlaybackId = episode.rawVoiceoverPlaybackId ?? null;
  if (!rawVoiceoverPlaybackId && episode.rawVoiceoverMuxAssetId) {
    try {
      rawVoiceoverPlaybackId = await muxService.getPlaybackId(episode.rawVoiceoverMuxAssetId);
      // Backfill the database so future requests are fast
      if (rawVoiceoverPlaybackId) {
        await prisma.episode.update({
          where: { id: episode.id },
          data: { rawVoiceoverPlaybackId },
        }).catch(() => { /* best-effort backfill */ });
      }
    } catch {
      logger.warn(`Could not resolve raw voiceover playback ID for episode ${episode.id}`);
    }
  }

  return {
    ...episode,
    // Explicit "which voiceover should UI play" field (cleaned takes priority)
    activeVoiceoverPlaybackId: episode.cleanVoiceoverPlaybackId ?? null,
    // Raw voiceover (original recording)
    rawVoiceoverPlaybackId,
    rawVoiceoverDuration: episode.rawVoiceoverDuration ?? null,
    // Mux URLs
    muxPlaybackUrl,
    thumbnailUrl,
    finalVideoUrl: finalVideoUrl || legacyFinalVideoUrl,
    // Compliance info
    complianceScore: templateCompile?.complianceScore,
    // A-roll cleaned preview (A-roll-first workflow)
    arollCleanPreviewS3Key,
    arollCleanPreviewMuxAssetId,
    arollCleanPreviewPlaybackId,
    arollCleanPreviewDuration,
    // Slot clips with playback URLs
    slotClips: episode.slotClips?.map((clip) => ({
      ...clip,
      playbackUrl: clip.muxPlaybackId ? muxService.getPlaybackUrl(clip.muxPlaybackId) : null,
    })),
  };
}

async function startSemanticMatchingForEpisode(args: {
  episodeId: string;
  userId: string;
  triggeredBy: string;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  const { episodeId, userId, triggeredBy } = args;

  const episode = await prisma.episode.findFirst({
    where: { id: episodeId, userId },
    include: {
      template: { select: { slotRequirements: true } },
      slotClips: { select: { slotId: true } },
    },
  });

  if (!episode) {
    return { status: 404, body: { error: 'Episode not found' } };
  }

  const nonRestartableStatuses = [
    'matching',
    'cut_plan_ready',
    'rendering',
    'ready',
    'published',
  ];

  if (nonRestartableStatuses.includes(episode.status)) {
    return {
      status: 400,
      body: { error: `Episode is already in ${episode.status} status` },
    };
  }

  const voiceoverSegmentsCountResult = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*) as count
    FROM "VoiceoverSegment"
    WHERE "episodeId" = ${episode.id}
  `;
  const voiceoverSegmentsCount = Number(voiceoverSegmentsCountResult[0]?.count ?? 0);

  if (voiceoverSegmentsCount === 0) {
    return {
      status: 400,
      body: {
        error: 'Voiceover processing is not complete. Please wait for Phase 1 to finish.',
        details: { phase: 'voiceover', status: episode.status },
      },
    };
  }

  const slotRequirements = episode.template?.slotRequirements as {
    workflow?: string;
    slots?: Array<{
      slotId?: string;
      slotType?: string;
      priority?: 'required' | 'optional';
    }>;
  } | null;

  const requiredSlotIds = getEffectiveRequiredSlotIds(slotRequirements);
  if (requiredSlotIds.length > 0) {
    const uploadedSlotIds = new Set(
      episode.slotClips.map((clip: { slotId: string }) => clip.slotId)
    );
    const missingSlots = requiredSlotIds.filter((slotId) => !uploadedSlotIds.has(slotId));

    if (missingSlots.length > 0) {
      return {
        status: 400,
        body: {
          error: 'Missing required slots',
          details: {
            missingSlots,
            requiredSlots: requiredSlotIds,
            uploadedSlots: Array.from(uploadedSlotIds),
          },
          message: `Please upload clips for required slots: ${missingSlots.join(', ')}`,
        },
      };
    }
  }

  const chunkStatsResult = await prisma.$queryRaw<
    Array<{ usable: bigint; duration_ms: bigint }>
  >`
    SELECT
      COUNT(*) FILTER (
        WHERE "s3Key" IS NOT NULL
          AND embedding IS NOT NULL
          AND "moderationStatus" = 'safe'
      )::bigint as usable,
      COALESCE(SUM(
        CASE
          WHEN "s3Key" IS NOT NULL
            AND embedding IS NOT NULL
            AND "moderationStatus" = 'safe'
          THEN "durationMs"
          ELSE 0
        END
      ), 0)::bigint as duration_ms
    FROM "BrollChunk"
    WHERE "episodeId" = ${episode.id}
  `;

  const usableChunks = Number(chunkStatsResult[0]?.usable ?? 0);
  const availableDurationMs = Number(chunkStatsResult[0]?.duration_ms ?? 0);

  if (usableChunks === 0) {
    return {
      status: 400,
      body: {
        error: 'B-roll processing is not complete. Please wait for Phase 2 to finish.',
        details: { phase: 'broll', status: episode.status },
      },
    };
  }

  const cleanVoiceoverDurationMs = Math.round((episode.cleanVoiceoverDuration ?? 0) * 1000);

  if (cleanVoiceoverDurationMs > 0 && availableDurationMs < cleanVoiceoverDurationMs) {
    const missingMs = cleanVoiceoverDurationMs - availableDurationMs;
    const missingChunks = Math.ceil(missingMs / CHUNK_DURATION_MS);
    const renderSpec = (episode.renderSpec as Record<string, unknown>) || {};

    await prisma.episode.update({
      where: { id: episode.id },
      data: {
        status: 'needs_more_clips',
        renderSpec: {
          ...renderSpec,
          missingMs,
          missingChunks,
          availableDurationMs,
          requiredDurationMs: cleanVoiceoverDurationMs,
        },
      },
    });

    return {
      status: 400,
      body: {
        error: 'Not enough usable footage to match the cleaned voiceover.',
        details: {
          missingMs,
          missingChunks,
          availableDurationMs,
          requiredDurationMs: cleanVoiceoverDurationMs,
        },
      },
    };
  }

  const pendingChunkJobs = await prisma.job.count({
    where: {
      episodeId: episode.id,
      type: {
        in: [
          'broll_ingest',
          'broll_chunking',
          'broll_chunk_ingest',
          'broll_chunk_enrichment',
          'broll_chunk_embedding',
          'slot_clip_enrichment',
          'aroll_chunk_transcript',
          'chunk_refinement',
        ],
      },
      status: {
        in: ['pending', 'processing'],
      },
    },
  });

  if (pendingChunkJobs > 0) {
    return {
      status: 400,
      body: {
        error: 'B-roll processing is still running. Please wait before starting matching.',
        details: { pendingChunkJobs },
      },
    };
  }

  const existingJob = await prisma.job.findFirst({
    where: {
      episodeId: episode.id,
      type: 'semantic_matching',
      status: { in: ['pending', 'processing'] },
    },
    orderBy: { updatedAt: 'desc' },
  });

  if (existingJob) {
    return {
      status: 200,
      body: {
        success: true,
        jobId: existingJob.id,
        message: 'Processing already in progress',
      },
    };
  }

  const completedJob = await prisma.job.findFirst({
    where: {
      episodeId: episode.id,
      type: 'semantic_matching',
      status: 'done',
    },
    orderBy: { updatedAt: 'desc' },
  });

  if (completedJob) {
    return {
      status: 400,
      body: {
        error: 'Semantic matching already completed',
        jobId: completedJob.id,
        message: 'Use /episodes/:id/trigger-cut-plan to continue.',
      },
    };
  }

  const job = await prisma.job.create({
    data: {
      type: 'semantic_matching',
      status: 'pending',
      episodeId: episode.id,
      userId,
      inputData: {
        triggeredBy,
        usableChunks,
        availableDurationMs,
        requiredDurationMs: cleanVoiceoverDurationMs,
      },
    },
  });

  await queueService.addSemanticMatchingJob({
    jobId: job.id,
    episodeId: episode.id,
    userId,
  });

  await prisma.episode.update({
    where: { id: episode.id },
    data: { status: 'matching' },
  });

  return {
    status: 200,
    body: {
      success: true,
      jobId: job.id,
      message: 'Video processing started',
    },
  };
}

async function triggerVoiceoverSegmentationRecovery(args: {
  episodeId: string;
  userId: string;
  triggeredBy: string;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  const episode = await prisma.episode.findFirst({
    where: { id: args.episodeId, userId: args.userId },
    select: {
      id: true,
      status: true,
      cleanVoiceoverS3Key: true,
      wordTranscript: true,
    },
  });

  if (!episode) {
    return { status: 404, body: { error: 'Episode not found' } };
  }

  const segmentCount = await prisma.voiceoverSegment.count({
    where: { episodeId: episode.id },
  });

  const completedSegmentation = await prisma.job.findFirst({
    where: {
      episodeId: episode.id,
      type: 'voiceover_segmentation',
      status: 'done',
    },
    orderBy: { updatedAt: 'desc' },
  });

  if (segmentCount > 0 && completedSegmentation) {
    return {
      status: 200,
      body: {
        success: true,
        resumed: false,
        recommendedAction: 'start_processing',
        message: 'Voiceover segmentation is already complete.',
      },
    };
  }

  const existingActiveJob = await prisma.job.findFirst({
    where: {
      episodeId: episode.id,
      type: 'voiceover_segmentation',
      status: { in: ['pending', 'processing'] },
    },
    orderBy: { updatedAt: 'desc' },
  });

  if (existingActiveJob) {
    return {
      status: 200,
      body: {
        success: true,
        resumed: false,
        recommendedAction: 'wait_voiceover_phase',
        jobId: existingActiveJob.id,
        message: 'Voiceover segmentation is already running.',
      },
    };
  }

  const transcriptWords = Array.isArray(episode.wordTranscript) ? episode.wordTranscript : [];
  if (!episode.cleanVoiceoverS3Key || transcriptWords.length === 0) {
    return {
      status: 400,
      body: {
        error: 'Voiceover assets are not ready for segmentation.',
        details: { phase: 'voiceover', status: episode.status },
      },
    };
  }

  const job = await prisma.job.create({
    data: {
      type: 'voiceover_segmentation',
      status: 'pending',
      episodeId: episode.id,
      userId: args.userId,
      inputData: {
        triggeredBy: args.triggeredBy,
      },
    },
  });

  await queueService.addVoiceoverSegmentationJob({
    jobId: job.id,
    episodeId: episode.id,
    userId: args.userId,
  });

  return {
    status: 200,
    body: {
      success: true,
      jobId: job.id,
      recommendedAction: 'wait_voiceover_phase',
      message: 'Resumed voiceover segmentation.',
    },
  };
}

async function requestRenderForEpisode(args: {
  episodeId: string;
  userId: string;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  const episode = await prisma.episode.findFirst({
    where: { id: args.episodeId, userId: args.userId },
  });

  if (!episode) {
    return { status: 404, body: { error: 'Episode not found' } };
  }

  if (episode.status !== 'cut_plan_ready') {
    return {
      status: 400,
      body: {
        error: `Episode must be in cut_plan_ready status to render. Current status: ${episode.status}`,
      },
    };
  }

  if (episode.renderJobId) {
    return {
      status: 200,
      body: {
        success: true,
        message: 'Render already started.',
        renderRequested: true,
        renderJobId: episode.renderJobId ?? undefined,
      },
    };
  }

  const renderJob = await prisma.job.create({
    data: {
      type: 'ffmpeg_render_microcut_v2',
      status: 'pending',
      episodeId: episode.id,
      userId: args.userId,
    },
  });

  await prisma.episode.update({
    where: { id: episode.id },
    data: {
      renderRequested: true,
      renderRequestedAt: new Date(),
      renderJobId: renderJob.id,
      status: 'rendering',
    },
  });

  await queueService.addFfmpegRenderMicrocutV2Job({
    jobId: renderJob.id,
    episodeId: episode.id,
    userId: args.userId,
  });

  return {
    status: 200,
    body: {
      success: true,
      message: 'Render started.',
      renderRequested: true,
      jobId: renderJob.id,
    },
  };
}

async function triggerCutPlanGenerationForEpisode(args: {
  episodeId: string;
  userId: string;
  triggeredBy: string;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  const episode = await prisma.episode.findFirst({
    where: { id: args.episodeId, userId: args.userId },
  });

  if (!episode) {
    return { status: 404, body: { error: 'Episode not found' } };
  }

  const semanticMatchingJob = await prisma.job.findFirst({
    where: {
      episodeId: episode.id,
      type: 'semantic_matching',
      status: 'done',
    },
    orderBy: { updatedAt: 'desc' },
  });

  if (!semanticMatchingJob) {
    return {
      status: 400,
      body: {
        error: 'Semantic matching not complete',
        message: 'Please wait for semantic matching to complete before triggering cut plan generation',
      },
    };
  }

  const existingJob = await prisma.job.findFirst({
    where: {
      episodeId: episode.id,
      type: 'cut_plan_generation',
      status: {
        in: ['pending', 'processing', 'done'],
      },
    },
  });

  if (existingJob) {
    return {
      status: 200,
      body: {
        success: true,
        jobId: existingJob.id,
        message: 'Cut plan generation job already exists',
        status: existingJob.status,
      },
    };
  }

  const chunkCountResult = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*) as count
    FROM "BrollChunk"
    WHERE "episodeId" = ${episode.id}
      AND embedding IS NOT NULL
  `;
  const brollChunksCount = Number(chunkCountResult[0]?.count ?? 0);

  if (brollChunksCount === 0) {
    return {
      status: 400,
      body: {
        error: 'B-roll processing not complete',
        message: 'Please wait for B-roll chunks to finish processing',
      },
    };
  }

  const job = await prisma.job.create({
    data: {
      type: 'cut_plan_generation',
      status: 'pending',
      episodeId: episode.id,
      userId: args.userId,
      inputData: {
        triggeredBy: args.triggeredBy,
      },
    },
  });

  await queueService.addCutPlanGenerationJob({
    jobId: job.id,
    episodeId: episode.id,
    userId: args.userId,
  });

  return {
    status: 200,
    body: {
      success: true,
      jobId: job.id,
      message: 'Cut plan generation triggered',
    },
  };
}

// ==================== ROUTES ====================

/**
 * GET /api/episodes - List user's episodes
 */
episodesRouter.get('/', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { seriesId, status } = req.query;

  try {
    const episodes = await prisma.episode.findMany({
      where: {
        userId,
        ...(seriesId && { seriesId: seriesId as string }),
        ...(status && { status: status as any }),
      },
      include: {
        series: { select: { id: true, name: true } },
        template: { select: { id: true, name: true, platform: true, slotRequirements: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });

    // Format responses with Mux URLs
    const formattedEpisodes = await Promise.all(
      episodes.map((ep: any) => formatEpisodeResponse(ep))
    );

    res.json(formattedEpisodes);
  } catch (error) {
    logger.error('Failed to list episodes:', error);
    res.status(500).json({ error: 'Failed to fetch episodes' });
  }
});

/**
 * POST /api/episodes - Create new episode
 */
episodesRouter.post(
  '/',
  requireUsageWithinLimits,
  validate({ body: CreateEpisodeSchema }),
  async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { title, seriesId, templateId, scriptContent, mode } = req.body;

    try {
      // Check if user can create more episodes today
      const usageCheck = await usageService.canCreateEpisode(userId);
      if (!usageCheck.allowed) {
        res.status(429).json({
          error: 'Daily episode limit reached',
          limit: usageCheck.limit,
          remaining: 0,
        });
        return;
      }

      const selectedTemplate = await prisma.template.findUnique({
        where: { id: templateId },
        select: { name: true, templatePackageVersion: true },
      });
      if (!selectedTemplate) {
        res.status(400).json({ error: 'Invalid template selected' });
        return;
      }
      if (!isAllowedEpisodeTemplateName(selectedTemplate.name)) {
        res.status(400).json({
          error:
            'Template must be one of: A-Roll Clean Then B-Roll, Pure B-Roll 60s',
        });
        return;
      }
      const templateVersion = selectedTemplate.templatePackageVersion ?? null;

      const episode = await prisma.episode.create({
        data: {
          title,
          seriesId,
          templateId,
          templateVersion,
          scriptContent,
          mode: mode ?? 'template_copy',
          userId,
          status: scriptContent ? 'draft' : 'draft',
        },
        include: {
          series: { select: { id: true, name: true } },
          template: { select: { id: true, name: true, platform: true, slotRequirements: true } },
        },
      });

      if (scriptContent) {
        await syncEpisodeKeytermsFromLibrary({
          episodeId: episode.id,
          userId,
          scriptContent,
        });
      }

      logger.info(`Episode created: ${episode.id} by user ${userId}`);

      // Track episode creation usage (non-blocking)
      await usageService.incrementUsage(userId, 'episodes');

      res.status(201).json(await formatEpisodeResponse(episode as any));
    } catch (error) {
      logger.error('Failed to create episode:', error);
      res.status(500).json({ error: 'Failed to create episode' });
    }
  }
);

/**
 * GET /api/episodes/:id - Get episode details with signed URLs
 */
episodesRouter.get('/:id', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const episode = await prisma.episode.findFirst({
      where: { id: req.params.id, userId },
      include: {
        series: { select: { id: true, name: true } },
        template: { select: { id: true, name: true, platform: true, slotRequirements: true } },
        jobs: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        slotClips: {
          orderBy: [{ slotId: 'asc' }, { createdAt: 'asc' }],
        },
      },
    });

    if (!episode) {
      res.status(404).json({ error: 'Episode not found' });
      return;
    }

    res.json(await formatEpisodeResponse(episode as any));
  } catch (error) {
    logger.error(`Failed to get episode ${req.params.id}:`, error);
    res.status(500).json({ error: 'Failed to fetch episode' });
  }
});

/**
 * PUT /api/episodes/:id - Update episode
 */
episodesRouter.put(
  '/:id',
  validate({ body: UpdateEpisodeSchema }),
  async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    try {
      // Handle captionsEnabled by merging into renderSpec JSON
      const { captionsEnabled, ...standardFields } = req.body;
      const updateData: Record<string, any> = { ...standardFields };

      if (typeof captionsEnabled === 'boolean') {
        const existing = await prisma.episode.findFirst({
          where: { id: req.params.id, userId },
          select: { renderSpec: true },
        });
        const renderSpec = (existing?.renderSpec as Record<string, any>) || {};
        updateData.renderSpec = { ...renderSpec, captionsEnabled };
      }

      const result = await prisma.episode.updateMany({
        where: { id: req.params.id, userId },
        data: updateData,
      });

      if (result.count === 0) {
        res.status(404).json({ error: 'Episode not found' });
        return;
      }

      const updated = await prisma.episode.findUnique({
        where: { id: req.params.id },
        include: {
          series: { select: { id: true, name: true } },
          template: { select: { id: true, name: true, platform: true, slotRequirements: true } },
        },
      });

      res.json(await formatEpisodeResponse(updated as any));
    } catch (error) {
      logger.error(`Failed to update episode ${req.params.id}:`, error);
      res.status(500).json({ error: 'Failed to update episode' });
    }
  }
);

/**
 * DELETE /api/episodes/:id - Delete episode
 */
episodesRouter.delete('/:id', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    // Get episode with Mux assets before deletion
    const episode = await prisma.episode.findFirst({
      where: { id: req.params.id, userId },
      include: { slotClips: true },
    });

    if (!episode) {
      res.status(404).json({ error: 'Episode not found' });
      return;
    }

    // Delete Mux assets (best effort)
    const muxAssetIds = [
      episode.muxVoiceoverAssetId,
      episode.muxFinalAssetId,
      ...episode.muxClipAssetIds,
      ...episode.slotClips.map((c: { muxAssetId: string | null }) => c.muxAssetId),
    ].filter(Boolean) as string[];

    for (const assetId of muxAssetIds) {
      try {
        await muxService.deleteAsset(assetId);
      } catch (e) {
        logger.warn(`Failed to delete Mux asset ${assetId}`);
      }
    }

    // Delete episode (cascades to slotClips and jobs)
    await prisma.episode.delete({
      where: { id: req.params.id },
    });

    logger.info(`Episode deleted: ${req.params.id}`);

    res.json({ success: true });
  } catch (error) {
    logger.error(`Failed to delete episode ${req.params.id}:`, error);
    res.status(500).json({ error: 'Failed to delete episode' });
  }
});

/**
 * GET /api/episodes/:id/script - Get generated script
 */
episodesRouter.get('/:id/script', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const episode = await prisma.episode.findFirst({
    where: { id: req.params.id, userId },
    select: { scriptContent: true, scriptBeats: true },
  });

  if (!episode) {
    res.status(404).json({ error: 'Episode not found' });
    return;
  }

  res.json({
    content: episode.scriptContent,
    beats: episode.scriptBeats,
  });
});

/**
 * GET /api/episodes/:id/keyterms - Get keyterms linked to this episode
 */
episodesRouter.get('/:id/keyterms', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const episode = await prisma.episode.findFirst({
    where: { id: req.params.id, userId },
    select: { id: true, scriptContent: true },
  });

  if (!episode) {
    res.status(404).json({ error: 'Episode not found' });
    return;
  }

  if (episode.scriptContent) {
    await syncEpisodeKeytermsFromLibrary({
      episodeId: episode.id,
      userId,
      scriptContent: episode.scriptContent,
    });
  }

  const linked = await prisma.episodeKeyterm.findMany({
    where: { episodeId: episode.id },
    include: { keyterm: true },
    orderBy: [{ source: 'asc' }, { updatedAt: 'desc' }],
  });

  res.json({
    keyterms: linked.map((ek: {
      keyterm: {
        id: string;
        term: string;
        normalizedTerm: string;
        category: string;
        language: string | null;
      };
      source: string;
      confirmed: boolean;
    }) => ({
      id: ek.keyterm.id,
      term: ek.keyterm.term,
      normalizedTerm: ek.keyterm.normalizedTerm,
      category: ek.keyterm.category,
      language: ek.keyterm.language,
      source: ek.source,
      confirmed: ek.confirmed,
    })),
  });
});

/**
 * POST /api/episodes/:id/keyterms - Save a keyterm for this episode (user-confirmed)
 */
episodesRouter.post(
  '/:id/keyterms',
  validate({ body: AddEpisodeKeytermSchema }),
  async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { term, category, language } = req.body;
    const normalizedTerm = normalizeKeytermTerm(term);

    if (!normalizedTerm) {
      res.status(400).json({ error: 'Invalid keyterm' });
      return;
    }

    const episode = await prisma.episode.findFirst({
      where: { id: req.params.id, userId },
      select: { id: true },
    });

    if (!episode) {
      res.status(404).json({ error: 'Episode not found' });
      return;
    }

    const saved = await prisma.keyterm.upsert({
      where: {
        userId_normalizedTerm: {
          userId,
          normalizedTerm,
        },
      },
      create: {
        userId,
        term: term.trim(),
        normalizedTerm,
        category,
        language,
        source: 'user',
      },
      update: {
        term: term.trim(),
        category,
        language: language ?? undefined,
        source: 'user',
      },
    });

    await prisma.episodeKeyterm.upsert({
      where: {
        episodeId_keytermId: {
          episodeId: episode.id,
          keytermId: saved.id,
        },
      },
      create: {
        episodeId: episode.id,
        keytermId: saved.id,
        source: 'user',
        confirmed: true,
      },
      update: {
        source: 'user',
        confirmed: true,
      },
    });

    res.json({
      keyterm: {
        id: saved.id,
        term: saved.term,
        normalizedTerm: saved.normalizedTerm,
        category: saved.category,
        language: saved.language,
        source: 'user',
        confirmed: true,
      },
    });
  }
);

/**
 * POST /api/episodes/:id/regenerate-script - Regenerate script with AI
 */
episodesRouter.post(
  '/:id/regenerate-script',
  requireUsageWithinLimits,
  withIdempotency({ ttlSeconds: 90 }),
  validate({ body: RegenerateScriptSchema }),
  async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { topic, archetype } = req.body;

    try {
      const episode = await prisma.episode.findFirst({
        where: { id: req.params.id, userId },
        include: { template: true },
      });

      if (!episode) {
        res.status(404).json({ error: 'Episode not found' });
        return;
      }

      if (!episode.template) {
        res.status(400).json({
          error: 'Episode has no template assigned. Please select a template first.',
        });
        return;
      }

      if (!episode.template.canonicalScript) {
        res.status(400).json({
          error:
            'Template is missing canonical script. Please run pnpm db:seed to populate templates.',
        });
        return;
      }

      // Get user persona
      const persona = await prisma.persona.findUnique({
        where: { userId },
      });

      if (!persona) {
        res.status(400).json({
          error: 'User persona not set up. Please complete onboarding first.',
        });
        return;
      }

      // Generate script using selected provider (Gemini or Runpod)
      const generatedResult = await geminiService.generateScriptWithMeta({
        templateScript: episode.template.canonicalScript,
        templateStructure: episode.template.scriptStructure as Record<string, unknown>,
        persona: {
          niche: persona.niche,
          tone: persona.tone,
          targetAudience: persona.targetAudience,
        },
        topic,
        archetype,
      });
      await usageService.recordUsage(userId, {
        ...(generatedResult.provider === 'gemini'
          ? { geminiCalls: 1 }
          : { openAiChatCalls: 1 }),
        scriptGenerationCalls: 1,
      });
      const generated = generatedResult.script;

      // Normalize beats — include energy and emotion for downstream pipeline use
      const normalizedBeats = generated.beats.map((beat, index: number) => ({
        beatType: beat.beatType || beat.type || 'content',
        text: beat.text || '',
        duration: beat.duration || 5,
        startTime: beat.startTime || 0,
        endTime: beat.endTime || beat.duration || 5,
        index: beat.index ?? index,
        energy: beat.energy || undefined,
        emotion: beat.emotion || undefined,
      }));

      // Update episode with generated script
      await prisma.episode.update({
        where: { id: episode.id },
        data: {
          scriptContent: generated.content,
          scriptBeats: normalizedBeats,
          status: 'draft',
        },
      });

      // Script changed: keep user-selected keyterms, refresh auto matches from library.
      await prisma.episodeKeyterm.deleteMany({
        where: { episodeId: episode.id, source: { not: 'user' } },
      });
      await syncEpisodeKeytermsFromLibrary({
        episodeId: episode.id,
        userId,
        scriptContent: generated.content,
      });

      logger.info(`Script regenerated for episode ${req.params.id}`);

      res.json({ content: generated.content, beats: normalizedBeats });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Script generation error:', error);
      res.status(500).json({
        error: 'Failed to generate script',
        details: errorMessage,
      });
    }
  }
);

/**
 * POST /api/episodes/:id/update-script - Update script manually (without AI)
 */
episodesRouter.post(
  '/:id/update-script',
  validate({ body: UpdateScriptSchema }),
  async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { scriptContent } = req.body;

    try {
      const episode = await prisma.episode.findFirst({
        where: { id: req.params.id, userId },
        include: { template: true },
      });

      if (!episode) {
        res.status(404).json({ error: 'Episode not found' });
        return;
      }

      // Generate simple beats from script content
      // Split by sentences and create beats
      const sentences = scriptContent.split(/[.!?]\s+/).filter(Boolean);
      
      // If we have a template with structure, use it as a guide
      let beats: Array<{
        beatType: string;
        text: string;
        duration: number;
        startTime: number;
        endTime: number;
        index: number;
      }> = [];

      if (episode.template?.scriptStructure) {
        const structure = episode.template.scriptStructure as any;
        const templateBeats = structure.beats || [];
        
        // Create beats based on template structure
        beats = templateBeats.map((beat: any, index: number) => ({
          beatType: beat.type || beat.beatType || 'content',
          text: '',
          duration: beat.duration || 5,
          startTime: beat.startTime || 0,
          endTime: beat.endTime || beat.duration || 5,
          index,
        }));

        // Distribute sentences across beats
        if (beats.length > 0 && sentences.length > 0) {
          const sentencesPerBeat = Math.ceil(sentences.length / beats.length);
          let currentTime = 0;

          beats.forEach((beat: any, i: number) => {
            const start = i * sentencesPerBeat;
            const end = Math.min(start + sentencesPerBeat, sentences.length);
            const beatSentences = sentences.slice(start, end);
            
            beat.text = beatSentences.join('. ') + (end < sentences.length ? '.' : '');
            beat.startTime = currentTime;
            beat.endTime = currentTime + beat.duration;
            currentTime = beat.endTime;
          });
        }
      } else {
        // No template structure - create simple beats from sentences
        // Group sentences into beats of ~2-3 sentences each
        const sentencesPerBeat = 2;
        let currentTime = 0;
        const defaultDuration = 5;

        for (let i = 0; i < sentences.length; i += sentencesPerBeat) {
          const beatSentences = sentences.slice(i, i + sentencesPerBeat);
          const beatText = beatSentences.join('. ') + '.';
          
          beats.push({
            beatType: 'content',
            text: beatText,
            duration: defaultDuration,
            startTime: currentTime,
            endTime: currentTime + defaultDuration,
            index: beats.length,
          });
          
          currentTime += defaultDuration;
        }
      }

      // Update episode with script
      await prisma.episode.update({
        where: { id: episode.id },
        data: {
          scriptContent,
          scriptBeats: beats,
          status: 'draft',
        },
      });

      // Script changed: keep user-selected keyterms, refresh auto matches from library.
      await prisma.episodeKeyterm.deleteMany({
        where: { episodeId: episode.id, source: { not: 'user' } },
      });
      await syncEpisodeKeytermsFromLibrary({
        episodeId: episode.id,
        userId,
        scriptContent,
      });

      logger.info(`Script updated manually for episode ${req.params.id}`);

      res.json({ content: scriptContent, beats });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Script update error:', error);
      res.status(500).json({
        error: 'Failed to update script',
        details: errorMessage,
      });
    }
  }
);

/**
 * POST /api/episodes/:id/fix-script-beats - Fix malformed scriptBeats
 * Utility endpoint to regenerate scriptBeats from scriptContent for old episodes
 */
episodesRouter.post('/:id/fix-script-beats', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const episode = await prisma.episode.findFirst({
      where: { id: req.params.id, userId },
      include: { template: true },
    });

    if (!episode) {
      res.status(404).json({ error: 'Episode not found' });
      return;
    }

    // Check if scriptBeats needs fixing (is not an array)
    if (Array.isArray(episode.scriptBeats)) {
      res.json({
        success: true,
        message: 'scriptBeats already in correct format',
        scriptBeats: episode.scriptBeats,
      });
      return;
    }

    // If has scriptContent but no proper scriptBeats, regenerate from template
    if (episode.scriptContent && episode.template?.scriptStructure) {
      const structure = episode.template.scriptStructure as any;

      // Generate simple beats from script content + template structure
      const beats =
        structure.beats?.map((beat: any, index: number) => ({
          beatType: beat.type,
          text: '',
          duration: beat.duration || 5,
          startTime: beat.startTime || 0,
          endTime: beat.endTime || beat.duration || 5,
          index,
        })) || [];

      // If we have the script content, try to split it roughly into beats
      if (beats.length > 0 && episode.scriptContent) {
        const sentences = episode.scriptContent.split(/[.!?]\s+/).filter(Boolean);
        const sentencesPerBeat = Math.ceil(sentences.length / beats.length);

        beats.forEach((beat: any, i: number) => {
          const start = i * sentencesPerBeat;
          const end = start + sentencesPerBeat;
          beat.text = sentences.slice(start, end).join('. ') + '.';
        });
      }

      await prisma.episode.update({
        where: { id: req.params.id },
        data: {
          scriptBeats: beats as any,
        },
      });

      logger.info(`Fixed scriptBeats for episode ${req.params.id}`);
      res.json({ success: true, scriptBeats: beats });
      return;
    }

    res.status(400).json({ error: 'Cannot fix scriptBeats: missing script or template' });
  } catch (error) {
    logger.error('Failed to fix scriptBeats:', error);
    res.status(500).json({ error: 'Failed to fix scriptBeats' });
  }
});

/**
 * GET /api/episodes/:id/download-url - Get signed download URL for video
 */
episodesRouter.get('/:id/download-url', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const episode = await prisma.episode.findFirst({
      where: { id: req.params.id, userId },
      select: { finalS3Key: true, finalVideoPath: true, muxFinalPlaybackId: true, title: true },
    });

    if (!episode) {
      res.status(404).json({ error: 'Episode not found' });
      return;
    }

    let primaryUrl: string | null = null;

    if (episode.finalS3Key) {
      primaryUrl = await s3Service.getSignedDownloadUrl(episode.finalS3Key, 7200);
    } else if (episode.finalVideoPath) {
      if (isHttpUrl(episode.finalVideoPath)) {
        primaryUrl = episode.finalVideoPath;
      } else {
        primaryUrl = await s3Service.getSignedDownloadUrl(episode.finalVideoPath, 7200);
      }
    }

    const muxFallbackUrls = episode.muxFinalPlaybackId
      ? muxService.getStaticMp4FallbackUrls(episode.muxFinalPlaybackId)
      : [];

    if (!primaryUrl && muxFallbackUrls.length > 0) {
      primaryUrl = muxFallbackUrls[0] ?? null;
    }

    if (!primaryUrl) {
      res.status(404).json({ error: 'Video not ready' });
      return;
    }

    res.json({
      url: primaryUrl,
      filename: toSafeVideoFilename(episode.title),
      fallbackUrls: muxFallbackUrls.filter((candidateUrl) => candidateUrl !== primaryUrl),
    });
  } catch (error) {
    logger.error(`Failed to generate download URL for episode ${req.params.id}:`, error);
    res.status(500).json({ error: 'Failed to generate download URL' });
  }
});

// ==================== PHASE 5: RENDERING ROUTES ====================

/**
 * POST /api/episodes/:id/render - Request final render
 *
 * Expresses user intent to render final video. Orchestrator will create job when ready.
 * Phase 4.2: Intent-based action - sets flag, orchestrator executes when eligible.
 *
 * @see WEBL_MASTER_IMPLEMENTATION.md Phase 5
 */
episodesRouter.post('/:id/render', requireUsageWithinLimits, withIdempotency({ ttlSeconds: 120 }), async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const episodeId = getSingleParamValue(req.params.id);
    if (!episodeId) {
      res.status(400).json({ error: 'Episode id is required' });
      return;
    }

    const result = await requestRenderForEpisode({
      episodeId,
      userId,
    });
    res.status(result.status).json(result.body);
  } catch (error) {
    logger.error(`Failed to request render for episode ${req.params.id}:`, error);
    res.status(500).json({ error: 'Failed to request render' });
  }
});

/**
 * POST /api/episodes/:id/start-slot-planning - Start slot planning job
 *
 * Called when all required slots are collected.
 * Triggers the template slot planning job.
 */
episodesRouter.post('/:id/start-slot-planning', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const episodeId = getSingleParamValue(req.params.id);
    if (!episodeId) {
      res.status(400).json({ error: 'Episode id is required' });
      return;
    }

    const result = await startSemanticMatchingForEpisode({
      episodeId,
      userId,
      triggeredBy: 'legacy_start_slot_planning',
    });

    res.status(result.status).json(result.body);
  } catch (error) {
    logger.error(`Failed to start slot planning for episode ${req.params.id}:`, error);
    res.status(500).json({ error: 'Failed to start slot planning' });
  }
});

/**
 * POST /api/episodes/:id/process - Start complete video processing pipeline
 *
 * Triggers the full Phase 1-5 pipeline if not already started.
 * Checks if voiceover and B-roll pipelines are complete, then triggers semantic matching.
 *
 * @see WEBL_MASTER_IMPLEMENTATION.md Phase 3-5
 */
episodesRouter.post('/:id/process', requireUsageWithinLimits, withIdempotency({ ttlSeconds: 120 }), async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const episodeId = getSingleParamValue(req.params.id);
    if (!episodeId) {
      res.status(400).json({ error: 'Episode id is required' });
      return;
    }

    const result = await startSemanticMatchingForEpisode({
      episodeId,
      userId,
      triggeredBy: 'manual_start_processing',
    });

    res.status(result.status).json(result.body);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`Failed to start processing for episode ${req.params.id}:`, {
      error: errorMessage,
      episodeId: req.params.id,
      userId,
    });

    res.status(500).json({
      error: 'Failed to start processing',
      details: process.env.NODE_ENV === 'development' ? errorMessage : undefined,
    });
  }
});

/**
 * POST /api/episodes/:id/resume - Resume from current pipeline phase
 *
 * Returns the recommended next action and route for the current status.
 * When execute=true, attempts to trigger the next actionable backend step.
 */
episodesRouter.post(
  '/:id/resume',
  requireUsageWithinLimits,
  withIdempotency({ ttlSeconds: 90 }),
  validate({ body: ResumeEpisodeSchema }),
  async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { execute } = req.body as { execute?: boolean };

    try {
      const episode = await prisma.episode.findFirst({
        where: { id: req.params.id, userId },
        include: {
          slotClips: { select: { slotId: true } },
          template: { select: { slotRequirements: true } },
        },
      });

      if (!episode) {
        res.status(404).json({ error: 'Episode not found' });
        return;
      }

      const baseRoute = `/(main)/episode/${episode.id}`;
      const processingRoute = `/(main)/episode/${episode.id}/processing`;
      const previewRoute = `/(main)/episode/${episode.id}/preview`;
      const slotsRoute = `/(main)/episode/${episode.id}/slots`;
      const recordRoute = `/(main)/episode/${episode.id}/record`;

      const slotRequirements = episode.template?.slotRequirements as {
        workflow?: string;
        slots?: Array<{
          slotId?: string;
          slotType?: string;
          priority?: 'required' | 'optional';
        }>;
      } | null;
      const requiredSlotIds = getEffectiveRequiredSlotIds(slotRequirements);
      const uploadedSlotIds = new Set(
        episode.slotClips.map((clip: { slotId: string }) => clip.slotId)
      );
      const missingSlots = requiredSlotIds.filter((slotId) => !uploadedSlotIds.has(slotId));

      if (episode.status === 'draft') {
        res.json({
          success: true,
          resumed: false,
          recommendedAction: 'voiceover_capture',
          nextRoute: recordRoute,
          message: 'Record or generate voiceover to move into processing.',
        });
        return;
      }

      if (episode.status === 'voiceover_uploaded' || episode.status === 'voiceover_cleaning') {
        res.json({
          success: true,
          resumed: false,
          recommendedAction: 'wait_voiceover_phase',
          nextRoute: processingRoute,
          message: 'Voiceover cleanup is in progress. Check processing timeline.',
        });
        return;
      }

      if (
        episode.status === 'voiceover_cleaned' ||
        episode.status === 'collecting_clips' ||
        episode.status === 'needs_more_clips'
      ) {
        if (missingSlots.length > 0) {
          res.json({
            success: true,
            resumed: false,
            recommendedAction: 'collect_clips',
            nextRoute: slotsRoute,
            message: `Upload required clips to continue: ${missingSlots.join(', ')}`,
            details: { missingSlots },
          });
          return;
        }

        if (!execute) {
          res.json({
            success: true,
            resumed: false,
            recommendedAction: 'start_processing',
            nextRoute: baseRoute,
            message: 'Processing can start now.',
          });
          return;
        }

        const result = await startSemanticMatchingForEpisode({
          episodeId: episode.id,
          userId,
          triggeredBy: 'resume_endpoint',
        });
        res.status(result.status).json({
          ...result.body,
          resumed: result.status === 200,
          nextRoute: processingRoute,
        });
        return;
      }

      if (
        episode.status === 'chunking_clips' ||
        episode.status === 'enriching_chunks' ||
        episode.status === 'matching'
      ) {
        const semanticDone = await prisma.job.findFirst({
          where: {
            episodeId: episode.id,
            type: 'semantic_matching',
            status: 'done',
          },
          orderBy: { updatedAt: 'desc' },
        });

        if (!execute) {
          res.json({
            success: true,
            resumed: false,
            recommendedAction: 'view_processing',
            nextRoute: processingRoute,
            message: semanticDone
              ? 'Matching finished. You can trigger cut plan generation.'
              : 'Processing is still running. Monitor timeline for completion.',
          });
          return;
        }

        if (semanticDone) {
          const result = await triggerCutPlanGenerationForEpisode({
            episodeId: episode.id,
            userId,
            triggeredBy: 'resume_endpoint',
          });
          res.status(result.status).json({
            ...result.body,
            resumed: result.status === 200,
            nextRoute: processingRoute,
          });
          return;
        }

        const startMatchingResult = await startSemanticMatchingForEpisode({
          episodeId: episode.id,
          userId,
          triggeredBy: 'resume_endpoint',
        });

        if (startMatchingResult.status === 200) {
          res.status(200).json({
            ...startMatchingResult.body,
            resumed: true,
            nextRoute: processingRoute,
          });
          return;
        }

        const maybePhase = ((startMatchingResult.body as Record<string, any>)?.details?.phase ??
          '') as string;
        const maybeError = ((startMatchingResult.body as Record<string, any>)?.error ?? '') as string;
        const shouldRecoverSegmentation =
          maybePhase === 'voiceover' ||
          /voiceover processing is not complete/i.test(maybeError);

        if (shouldRecoverSegmentation) {
          const recoveryResult = await triggerVoiceoverSegmentationRecovery({
            episodeId: episode.id,
            userId,
            triggeredBy: 'resume_endpoint',
          });

          res.status(recoveryResult.status).json({
            ...recoveryResult.body,
            resumed: recoveryResult.status === 200,
            nextRoute: processingRoute,
          });
          return;
        }

        if (startMatchingResult.status >= 500) {
          res.status(startMatchingResult.status).json({
            ...startMatchingResult.body,
            resumed: false,
            nextRoute: processingRoute,
          });
          return;
        }

        const fallbackError =
          ((startMatchingResult.body as Record<string, any>)?.error as string | undefined) ??
          'Processing cannot continue yet. Please review timeline details.';
        res.json({
          ...startMatchingResult.body,
          success: false,
          resumed: false,
          recommendedAction: 'view_processing',
          message: fallbackError,
          nextRoute: processingRoute,
        });
        return;
      }

      if (episode.status === 'cut_plan_ready') {
        if (!execute) {
          res.json({
            success: true,
            resumed: false,
            recommendedAction: 'request_render',
            nextRoute: baseRoute,
            message: 'Cut plan is ready. Request render to continue.',
          });
          return;
        }

        const result = await requestRenderForEpisode({
          episodeId: episode.id,
          userId,
        });
        res.status(result.status).json({
          ...result.body,
          resumed: result.status === 200,
          nextRoute: processingRoute,
        });
        return;
      }

      if (episode.status === 'rendering') {
        res.json({
          success: true,
          resumed: false,
          recommendedAction: 'view_processing',
          nextRoute: processingRoute,
          message: 'Render is in progress.',
        });
        return;
      }

      if (episode.status === 'ready' || episode.status === 'published') {
        res.json({
          success: true,
          resumed: false,
          recommendedAction: 'preview',
          nextRoute: previewRoute,
          message: 'Final output is ready to preview.',
        });
        return;
      }

      res.json({
        success: true,
        resumed: false,
        recommendedAction: 'review_episode',
        nextRoute: baseRoute,
        message: 'Episode is in recovery mode. Review details before retrying.',
      });
    } catch (error) {
      logger.error(`Failed to resume episode ${req.params.id}:`, error);
      res.status(500).json({ error: 'Failed to resume from current phase' });
    }
  }
);

/**
 * POST /api/episodes/:id/trigger-cut-plan - Manually trigger cut plan generation
 *
 * For episodes stuck in "matching" status after semantic matching completes,
 * this endpoint manually triggers cut_plan_generation if all prerequisites are met.
 */
episodesRouter.post('/:id/trigger-cut-plan', withIdempotency({ ttlSeconds: 90 }), async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const episodeId = getSingleParamValue(req.params.id);
    if (!episodeId) {
      res.status(400).json({ error: 'Episode id is required' });
      return;
    }

    const result = await triggerCutPlanGenerationForEpisode({
      episodeId,
      userId,
      triggeredBy: 'manual_api_trigger',
    });
    res.status(result.status).json(result.body);
  } catch (error) {
    logger.error(`Failed to trigger cut plan generation for episode ${req.params.id}:`, error);
    res.status(500).json({ error: 'Failed to trigger cut plan generation' });
  }
});

/**
 * POST /api/episodes/:id/generate-voiceover - Generate voiceover using ElevenLabs
 *
 * Generates voiceover audio from the episode's script using ElevenLabs TTS,
 * uploads it to S3, and triggers the voiceover_ingest job.
 */
episodesRouter.post('/:id/generate-voiceover', requireUsageWithinLimits, withIdempotency({ ttlSeconds: 180 }), async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const episode = await prisma.episode.findFirst({
      where: { id: req.params.id, userId },
    });

    if (!episode) {
      res.status(404).json({ error: 'Episode not found' });
      return;
    }

    // Check if script beats exist
    const scriptBeats = episode.scriptBeats;
    if (!scriptBeats || !Array.isArray(scriptBeats) || scriptBeats.length === 0) {
      res.status(400).json({ error: 'No script beats found. Please generate a script first.' });
      return;
    }

    // Combine all script beat text
    const fullScript = (scriptBeats as Array<{ text?: string }>)
      .map((beat) => beat.text || '')
      .filter(Boolean)
      .join(' ');

    if (!fullScript.trim()) {
      res.status(400).json({ error: 'Script is empty. Please generate a script first.' });
      return;
    }

    // Get user's ElevenLabs settings (API key and voice ID)
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { 
        elevenLabsVoiceId: true,
        elevenLabsApiKey: true,
      },
    });

    // Determine which API key to use (priority: user's key > server's key)
    let elevenLabsApiKey: string | null = null;
    let apiKeySource = 'server';
    
    if (user?.elevenLabsApiKey) {
      try {
        elevenLabsApiKey = decrypt(user.elevenLabsApiKey);
        apiKeySource = 'user';
      } catch (error) {
        logger.error(`[generate-voiceover] Failed to decrypt user's API key:`, error);
        // Fall back to server key
      }
    }

    // Fall back to server API key if user doesn't have one or decryption failed
    if (!elevenLabsApiKey) {
      elevenLabsApiKey = process.env.ELEVENLABS_API_KEY || null;
      apiKeySource = 'server';
    }

    if (!elevenLabsApiKey) {
      res.status(500).json({ 
        error: 'ElevenLabs API key not configured. Please provide your API key in settings or contact support.' 
      });
      return;
    }

    // Resolve voice ID from user settings first, then optional workspace default.
    const configuredDefaultVoiceId = process.env.ELEVENLABS_DEFAULT_VOICE_ID?.trim() || null;
    const voiceId = user?.elevenLabsVoiceId || configuredDefaultVoiceId;

    if (!voiceId) {
      res.status(400).json({
        error:
          'No ElevenLabs voice ID configured. Set one in Settings or define ELEVENLABS_DEFAULT_VOICE_ID in .env.',
      });
      return;
    }

    logger.info(`[generate-voiceover] Generating voiceover for episode ${episode.id}, script length: ${fullScript.length}, voice ID: ${voiceId}, API key source: ${apiKeySource}`);

    // Generate audio using ElevenLabs API
    await usageService.recordUsage(userId, {
      elevenLabsTtsCalls: 1,
      elevenLabsCharacters: fullScript.length,
    });
    const requestVoiceover = (requestedVoiceId: string) =>
      fetch(`https://api.elevenlabs.io/v1/text-to-speech/${requestedVoiceId}`, {
        method: 'POST',
        headers: {
          'Accept': 'audio/mpeg',
          'Content-Type': 'application/json',
          'xi-api-key': elevenLabsApiKey,
        },
        body: JSON.stringify({
          text: fullScript,
          model_id: 'eleven_multilingual_v2',
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0,
            use_speaker_boost: true,
          },
        }),
      });

    let activeVoiceId = voiceId;
    let elevenLabsResponse = await requestVoiceover(activeVoiceId);

    if (!elevenLabsResponse.ok) {
      let errorText = await elevenLabsResponse.text();
      let parsedError = parseElevenLabsErrorPayload(errorText);

      const canFallbackToDefault =
        parsedError?.code === 'paid_plan_required' &&
        !!user?.elevenLabsVoiceId &&
        !!configuredDefaultVoiceId &&
        configuredDefaultVoiceId !== user.elevenLabsVoiceId;

      if (canFallbackToDefault && configuredDefaultVoiceId) {
        logger.warn(
          `[generate-voiceover] Saved user voice requires paid plan. Falling back to ELEVENLABS_DEFAULT_VOICE_ID (${configuredDefaultVoiceId}).`
        );

        activeVoiceId = configuredDefaultVoiceId;
        elevenLabsResponse = await requestVoiceover(activeVoiceId);

        if (!elevenLabsResponse.ok) {
          errorText = await elevenLabsResponse.text();
          parsedError = parseElevenLabsErrorPayload(errorText);
        }
      }

      if (!elevenLabsResponse.ok) {
        logger.error(
          `[generate-voiceover] ElevenLabs API error (voiceId=${activeVoiceId}): ${elevenLabsResponse.status} - ${errorText}`
        );

        if (parsedError?.code === 'paid_plan_required') {
          res.status(402).json({
            error:
              'This voice requires a paid ElevenLabs plan. Use a voice available to your account/API key or upgrade your ElevenLabs plan.',
            details: parsedError,
          });
          return;
        }

        res.status(500).json({
          error: 'Failed to generate voiceover',
          details: parsedError || errorText,
        });
        return;
      }
    }

    // Get audio buffer
    const audioBuffer = await elevenLabsResponse.arrayBuffer();
    const audioData = Buffer.from(audioBuffer);

    logger.info(`[generate-voiceover] Audio generated, size: ${audioData.length} bytes`);

    // Upload to S3
    const timestamp = Date.now();
    const filename = `voiceover_${episode.id}_${timestamp}.mp3`;
    const s3Key = `episodes/${episode.id}/voiceover/${filename}`;

    await s3Service.uploadBuffer(
      s3Key,
      audioData,
      'audio/mpeg',
      {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'public, max-age=31536000',
      }
    );

    logger.info(`[generate-voiceover] Audio uploaded to S3: ${s3Key}`);

    // Update episode with voiceover key
    await prisma.episode.update({
      where: { id: episode.id },
      data: {
        voiceoverS3Key: s3Key,
        voiceoverPath: s3Key,
        status: 'voiceover_uploaded',
      },
    });

    // Create voiceover_ingest job
    const job = await prisma.job.create({
      data: {
        type: 'voiceover_ingest',
        status: 'pending',
        stage: 'starting',
        episodeId: episode.id,
        userId,
        inputPaths: [s3Key],
        metadata: {
          uploadType: 'voiceover',
          segmentCount: 1,
          isMultiSegment: false,
          generatedBy: 'elevenlabs',
        },
      },
    });

    // Queue the job
    try {
      await queueService.addVoiceoverIngestJob({
        jobId: job.id,
        episodeId: episode.id,
        userId,
        s3Key,
      });
      logger.info(`[generate-voiceover] Job ${job.id} queued successfully`);
    } catch (error) {
      logger.warn(`[generate-voiceover] Redis queue failed for job ${job.id}, but job created in DB:`, error);
    }

    logger.info(`[generate-voiceover] Success - Voiceover generated and uploaded for episode ${episode.id}`);

    res.json({
      success: true,
      key: s3Key,
      keys: [s3Key],
      jobId: job.id,
      message: 'Voiceover generated successfully',
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`[generate-voiceover] Failed to generate voiceover for episode ${req.params.id}:`, error);
    res.status(500).json({
      error: 'Failed to generate voiceover',
      details: process.env.NODE_ENV === 'development' ? errorMessage : undefined,
    });
  }
});

// ==================== B-ROLL CHUNKS ====================

/**
 * GET /:id/broll-chunks — Fetch all B-Roll chunks for an episode
 * Returns chunks with AI analysis, thumbnails, quality scores, and matching data.
 */
episodesRouter.get('/:id/broll-chunks', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { id } = req.params;

  try {
    const episode = await prisma.episode.findFirst({
      where: { id, userId },
      select: { id: true },
    });

    if (!episode) {
      res.status(404).json({ error: 'Episode not found' });
      return;
    }

    const chunks = await prisma.brollChunk.findMany({
      where: { episodeId: id },
      select: {
        id: true,
        slotClipId: true,
        chunkIndex: true,
        startMs: true,
        endMs: true,
        durationMs: true,
        s3Key: true,
        muxAssetId: true,
        muxPlaybackId: true,
        thumbnailUrl: true,
        aiTags: true,
        aiSummary: true,
        moderationStatus: true,
        qualityScore: true,
        motionScore: true,
        compositionScore: true,
        matchScore: true,
        matchedToSegmentId: true,
        isUsedInFinalCut: true,
        embeddingText: true,
        metadata: true,
        createdAt: true,
      },
      orderBy: [{ slotClipId: 'asc' }, { chunkIndex: 'asc' }],
    });

    // Attach Mux playback URLs and group by slot clip
    const formatted = chunks.map((chunk: typeof chunks[number]) => ({
      ...chunk,
      playbackUrl: chunk.muxPlaybackId
        ? muxService.getPlaybackUrl(chunk.muxPlaybackId)
        : null,
      thumbnailUrl: chunk.muxPlaybackId
        ? `https://image.mux.com/${chunk.muxPlaybackId}/thumbnail.jpg?width=400&height=400&fit_mode=smartcrop`
        : chunk.thumbnailUrl,
    }));

    res.json({
      chunks: formatted,
      total: formatted.length,
      usedInFinalCut: formatted.filter((c: typeof formatted[number]) => c.isUsedInFinalCut).length,
    });
  } catch (error) {
    logger.error(`Failed to fetch broll chunks for episode ${id}:`, error);
    res.status(500).json({ error: 'Failed to fetch B-Roll chunks' });
  }
});
