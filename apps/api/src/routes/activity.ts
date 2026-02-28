import { Router, Request, Response } from 'express';
import { prisma } from '@webl/prisma';
import { getUserId } from '../middleware/clerk.js';
import { logger } from '@webl/shared';

export const activityRouter = Router();

type ActivityMode = 'active' | 'recent' | 'all';
type ActivityBucket = 'attention' | 'active' | 'recent' | 'history';
type ActivityPriority = 'needs_attention' | 'in_progress' | 'needs_input' | 'recently_completed' | 'history';
type JobStatus = 'pending' | 'processing' | 'done' | 'error' | 'cancelled';
type EpisodeStatus =
  | 'draft'
  | 'voiceover_uploaded'
  | 'voiceover_cleaning'
  | 'voiceover_cleaned'
  | 'collecting_clips'
  | 'needs_more_clips'
  | 'chunking_clips'
  | 'enriching_chunks'
  | 'matching'
  | 'cut_plan_ready'
  | 'rendering'
  | 'ready'
  | 'published'
  | 'failed';

type JobListItem = {
  id: string;
  type: string;
  status: JobStatus;
  stage: string;
  progress: number;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  episodeId: string | null;
};

type EpisodeSummary = {
  episodeId: string;
  title: string;
  status: EpisodeStatus;
  updatedAt: string;
  priority: ActivityPriority;
  hasActionRequired: boolean;
  counts: {
    total: number;
    active: number;
    pending: number;
    failed: number;
    done: number;
    cancelled: number;
  };
  latestJob: {
    id: string;
    type: string;
    status: JobStatus;
    stage: string;
    progress: number;
    updatedAt: string;
    errorMessage: string | null;
  } | null;
};

const PRIORITY_WEIGHT: Record<ActivityPriority, number> = {
  needs_attention: 0,
  in_progress: 1,
  needs_input: 2,
  recently_completed: 3,
  history: 4,
};

const NEEDS_INPUT_STATUSES: ReadonlySet<EpisodeStatus> = new Set([
  'voiceover_cleaned',
  'collecting_clips',
  'needs_more_clips',
]);

function toMode(input: unknown): ActivityMode {
  if (input === 'recent' || input === 'all') return input;
  return 'active';
}

function toBucket(input: unknown): ActivityBucket {
  if (input === 'attention' || input === 'recent' || input === 'history') {
    return input;
  }
  return 'active';
}

function parseLimit(input: unknown, defaultValue = 12, max = 50): number {
  const parsed = Number(input);
  if (!Number.isFinite(parsed)) return defaultValue;
  return Math.max(1, Math.min(max, Math.floor(parsed)));
}

function computePriority(status: EpisodeStatus, counts: EpisodeSummary['counts'], updatedAt: Date): ActivityPriority {
  if (counts.failed > 0 || status === 'failed') {
    return 'needs_attention';
  }

  if (counts.active > 0 || counts.pending > 0) {
    return 'in_progress';
  }

  if (NEEDS_INPUT_STATUSES.has(status)) {
    return 'needs_input';
  }

  const ageMs = Date.now() - updatedAt.getTime();
  const oneDayMs = 24 * 60 * 60 * 1000;
  if (counts.done > 0 && ageMs <= oneDayMs) {
    return 'recently_completed';
  }

  return 'history';
}

function shouldIncludeByMode(summary: EpisodeSummary, mode: ActivityMode): boolean {
  if (mode === 'all') return true;
  if (mode === 'recent') {
    return summary.priority === 'recently_completed' || summary.priority === 'history';
  }
  return summary.priority !== 'history';
}

function buildEpisodeSummary(
  episode: { id: string; title: string; status: EpisodeStatus; updatedAt: Date },
  jobs: JobListItem[]
): EpisodeSummary {
  const counts = {
    total: jobs.length,
    active: jobs.filter((job) => job.status === 'processing').length,
    pending: jobs.filter((job) => job.status === 'pending').length,
    failed: jobs.filter((job) => job.status === 'error').length,
    done: jobs.filter((job) => job.status === 'done').length,
    cancelled: jobs.filter((job) => job.status === 'cancelled').length,
  };

  const latestJob = jobs[0]
    ? {
        id: jobs[0].id,
        type: jobs[0].type,
        status: jobs[0].status,
        stage: jobs[0].stage,
        progress: jobs[0].progress,
        updatedAt: jobs[0].updatedAt.toISOString(),
        errorMessage: jobs[0].errorMessage,
      }
    : null;

  const priority = computePriority(episode.status, counts, episode.updatedAt);

  return {
    episodeId: episode.id,
    title: episode.title,
    status: episode.status,
    updatedAt: episode.updatedAt.toISOString(),
    priority,
    hasActionRequired: priority === 'needs_attention' || priority === 'needs_input',
    counts,
    latestJob,
  };
}

function splitSections(items: EpisodeSummary[]) {
  return {
    needsAttention: items.filter((item) => item.priority === 'needs_attention'),
    inProgress: items.filter((item) => item.priority === 'in_progress'),
    needsInput: items.filter((item) => item.priority === 'needs_input'),
    recentlyCompleted: items.filter((item) => item.priority === 'recently_completed'),
    history: items.filter((item) => item.priority === 'history'),
  };
}

activityRouter.get('/events', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const episodeId = typeof req.query.episodeId === 'string' ? req.query.episodeId : undefined;
  const cursor = typeof req.query.cursor === 'string' && req.query.cursor ? req.query.cursor : undefined;
  const limit = parseLimit(req.query.limit, 50, 200);

  try {
    const items = await prisma.activityEvent.findMany({
      where: {
        userId,
        ...(episodeId ? { episodeId } : {}),
      },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasNextPage = items.length > limit;
    const pageItems = hasNextPage ? items.slice(0, limit) : items;
    const nextCursor = hasNextPage ? pageItems[pageItems.length - 1]?.id : null;

    res.json({
      items: pageItems,
      nextCursor,
    });
  } catch (error) {
    logger.error('Failed to fetch activity events:', error);
    res.status(500).json({ error: 'Failed to fetch activity events' });
  }
});

activityRouter.get('/episodes', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const mode = toMode(req.query.mode);
  const limit = parseLimit(req.query.limit, 12, 40);
  const cursor = typeof req.query.cursor === 'string' && req.query.cursor ? req.query.cursor : undefined;

  try {
    const episodes = await prisma.episode.findMany({
      where: {
        userId,
        jobs: { some: {} },
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        title: true,
        status: true,
        updatedAt: true,
      },
    });

    const hasNextPage = episodes.length > limit;
    const slice = hasNextPage ? episodes.slice(0, limit) : episodes;
    const nextCursor = hasNextPage ? slice[slice.length - 1]?.id : null;

    const typedSlice = slice as Array<{ id: string; title: string; status: EpisodeStatus; updatedAt: Date }>;
    const episodeIds = typedSlice.map((episode: { id: string }) => episode.id);

    const jobs = episodeIds.length
      ? await prisma.job.findMany({
          where: {
            userId,
            episodeId: { in: episodeIds },
          },
          orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
          select: {
            id: true,
            type: true,
            status: true,
            stage: true,
            progress: true,
            errorMessage: true,
            createdAt: true,
            updatedAt: true,
            episodeId: true,
          },
        })
      : [];

    const jobsByEpisode = new Map<string, JobListItem[]>();
    for (const job of jobs) {
      if (!job.episodeId) continue;
      const existing = jobsByEpisode.get(job.episodeId) || [];
      existing.push(job);
      jobsByEpisode.set(job.episodeId, existing);
    }

    const summaries = typedSlice
      .map((episode: { id: string; title: string; status: EpisodeStatus; updatedAt: Date }) =>
        buildEpisodeSummary(episode, jobsByEpisode.get(episode.id) || [])
      )
      .filter((summary: EpisodeSummary) => shouldIncludeByMode(summary, mode))
      .sort((a: EpisodeSummary, b: EpisodeSummary) => {
        const weightDelta = PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority];
        if (weightDelta !== 0) return weightDelta;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });

    res.json({
      items: summaries,
      sections: splitSections(summaries),
      nextCursor,
    });
  } catch (error) {
    logger.error('Failed to fetch activity episode summaries:', error);
    res.status(500).json({ error: 'Failed to fetch activity episodes' });
  }
});

activityRouter.get('/episodes/:episodeId/summary', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const episodeId = req.params.episodeId ?? '';
  if (episodeId.length === 0) {
    res.status(400).json({ error: 'Episode ID required' });
    return;
  }

  try {
    const episode = await prisma.episode.findFirst({
      where: { id: episodeId, userId },
      select: {
        id: true,
        title: true,
        status: true,
        updatedAt: true,
      },
    });

    if (!episode) {
      res.status(404).json({ error: 'Episode not found' });
      return;
    }

    const jobs = await prisma.job.findMany({
      where: {
        userId,
        episodeId,
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        type: true,
        status: true,
        stage: true,
        progress: true,
        errorMessage: true,
        createdAt: true,
        updatedAt: true,
        episodeId: true,
      },
    });

    res.json({ item: buildEpisodeSummary(episode, jobs) });
  } catch (error) {
    logger.error(`Failed to fetch activity summary for episode ${episodeId}:`, error);
    res.status(500).json({ error: 'Failed to fetch episode summary' });
  }
});

activityRouter.get('/episodes/:episodeId/jobs', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const episodeId = req.params.episodeId ?? '';
  if (episodeId.length === 0) {
    res.status(400).json({ error: 'Episode ID required' });
    return;
  }
  const bucket = toBucket(req.query.bucket);
  const limit = parseLimit(req.query.limit, 12, 50);
  const cursor = typeof req.query.cursor === 'string' && req.query.cursor ? req.query.cursor : undefined;

  try {
    const episode = await prisma.episode.findFirst({ where: { id: episodeId, userId }, select: { id: true } });
    if (!episode) {
      res.status(404).json({ error: 'Episode not found' });
      return;
    }

    const where: {
      userId: string;
      episodeId: string;
      status?: { in: JobStatus[] };
    } = {
      userId,
      episodeId,
    };

    if (bucket === 'attention') {
      where.status = { in: ['error', 'cancelled'] };
    }

    if (bucket === 'active') {
      where.status = { in: ['pending', 'processing'] };
    }

    if (bucket === 'recent') {
      where.status = { in: ['done'] };
    }

    if (bucket === 'history') {
      where.status = { in: ['done', 'cancelled', 'error'] };
    }

    const jobs = await prisma.job.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        type: true,
        status: true,
        stage: true,
        progress: true,
        errorMessage: true,
        createdAt: true,
        updatedAt: true,
        episodeId: true,
        userId: true,
      },
    });

    const hasNextPage = jobs.length > limit;
    const items = hasNextPage ? jobs.slice(0, limit) : jobs;
    const nextCursor = hasNextPage ? items[items.length - 1]?.id : null;

    res.json({
      bucket,
      items,
      nextCursor,
    });
  } catch (error) {
    logger.error(`Failed to fetch activity jobs for episode ${episodeId}:`, error);
    res.status(500).json({ error: 'Failed to fetch activity jobs' });
  }
});
