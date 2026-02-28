import type { Server as HttpServer } from 'http';
import { randomUUID } from 'crypto';
import { Server as SocketIOServer, type Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import IORedis from 'ioredis';
import { verifyToken } from '@clerk/express';
import { prisma } from '@webl/prisma';
import { logger } from '@webl/shared';
import { config } from '../config/index.js';

type JobProgressMessage = {
  jobId: string;
  status: 'pending' | 'processing' | 'done' | 'error' | 'cancelled';
  stage: string;
  progress: number;
  message?: string;
  timestamp: number;
};

type GatewaySocketData = {
  userId: string;
};

type JobSnapshot = {
  id: string;
  type: string;
  status: string;
  stage: string;
  progress: number;
  errorMessage: string | null;
  updatedAt: Date;
  userId: string;
  episodeId: string | null;
  episode: {
    id: string;
    title: string;
    status: string;
    updatedAt: Date;
  } | null;
};

type JobEmitState = {
  status: string;
  stage: string;
  progressBucket: number;
};

type ActivityEventType =
  | 'episode_status_changed'
  | 'job_created'
  | 'job_updated'
  | 'job_completed'
  | 'job_failed'
  | 'job_cancelled';

type ActivityEntityType = 'episode' | 'job';

function getIsUpstash(url: string): boolean {
  return url.includes('upstash.io');
}

function mapJobEventType(status: string): ActivityEventType {
  if (status === 'done') return 'job_completed';
  if (status === 'error') return 'job_failed';
  if (status === 'cancelled') return 'job_cancelled';
  return 'job_updated';
}

function tokenFromSocket(socket: Socket<any, any, any, GatewaySocketData>): string | null {
  const authToken = typeof socket.handshake.auth?.token === 'string' ? socket.handshake.auth.token : null;
  if (authToken) return authToken;

  const authorization = socket.handshake.headers.authorization;
  if (typeof authorization === 'string' && authorization.toLowerCase().startsWith('bearer ')) {
    return authorization.slice(7);
  }

  const queryToken = socket.handshake.query?.token;
  if (typeof queryToken === 'string') {
    return queryToken;
  }

  return null;
}

class ActivityRealtimeGateway {
  private io: SocketIOServer<any, any, any, GatewaySocketData> | null = null;
  private jobProgressSubscriber: IORedis | null = null;
  private readonly lastSentByJob = new Map<string, JobEmitState>();
  private readonly redisUrl = config.redis.url;

  async attach(server: HttpServer): Promise<void> {
    this.io = new SocketIOServer(server, {
      path: '/realtime',
      cors: {
        origin: config.security.corsOrigins,
        credentials: true,
      },
      transports: ['websocket', 'polling'],
      pingInterval: 25_000,
      pingTimeout: 20_000,
    });

    await this.configureAdapter();
    await this.configureProgressFanout();
    this.configureConnectionHandlers();

    logger.info('Realtime gateway initialized on /realtime');
  }

  private async configureAdapter(): Promise<void> {
    if (!this.io || !this.redisUrl) return;

    try {
      const pubClient = createClient({
        url: this.redisUrl,
        ...(getIsUpstash(this.redisUrl)
          ? {
              socket: {
                tls: true,
              },
            }
          : {}),
      });
      const subClient = pubClient.duplicate();

      await Promise.all([pubClient.connect(), subClient.connect()]);
      this.io.adapter(createAdapter(pubClient, subClient));
      logger.info('Realtime gateway Redis adapter connected');
    } catch (error) {
      logger.warn('Realtime gateway adapter initialization failed, running single-instance mode:', error);
    }
  }

  private async configureProgressFanout(): Promise<void> {
    if (!this.io || !this.redisUrl) return;

    const isUpstash = getIsUpstash(this.redisUrl);
    this.jobProgressSubscriber = new IORedis(this.redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      ...(isUpstash
        ? {
            tls: {
              rejectUnauthorized: true,
            },
          }
        : {}),
    });

    this.jobProgressSubscriber.on('pmessage', (pattern: string, channel: string, message: string) => {
      void this.handleJobProgressMessage(pattern, channel, message);
    });

    this.jobProgressSubscriber.on('error', (error) => {
      logger.error('Realtime gateway progress subscriber error:', error);
    });

    await this.jobProgressSubscriber.psubscribe('job:progress:*');
  }

  private configureConnectionHandlers(): void {
    if (!this.io) return;

    this.io.use(async (socket, next) => {
      try {
        const token = tokenFromSocket(socket);
        if (!token) {
          next(new Error('Authentication required'));
          return;
        }

        const claims = await verifyToken(token, {
          secretKey: config.clerk.secretKey,
        });

        const userId = (claims.sub || claims.sid || claims.userId) as string | undefined;
        if (!userId) {
          next(new Error('Invalid token claims'));
          return;
        }

        socket.data.userId = userId;
        next();
      } catch (error) {
        logger.warn('Realtime authentication failed:', error);
        next(new Error('Authentication failed'));
      }
    });

    this.io.on('connection', (socket) => {
      const userId = socket.data.userId;
      socket.join(`user:${userId}`);

      socket.emit('realtime:ready', {
        userId,
        connectedAt: new Date().toISOString(),
      });

      socket.on('episode:subscribe', async (episodeId: unknown, ack?: (payload: Record<string, unknown>) => void) => {
        const id = typeof episodeId === 'string' ? episodeId : '';
        if (!id) {
          ack?.({ ok: false, error: 'Invalid episode id' });
          return;
        }

        const episode = await prisma.episode.findFirst({
          where: {
            id,
            userId,
          },
          select: { id: true },
        });

        if (!episode) {
          ack?.({ ok: false, error: 'Episode not found' });
          return;
        }

        socket.join(`episode:${id}`);
        ack?.({ ok: true, episodeId: id });
      });

      socket.on('episode:unsubscribe', (episodeId: unknown, ack?: (payload: Record<string, unknown>) => void) => {
        const id = typeof episodeId === 'string' ? episodeId : '';
        if (!id) {
          ack?.({ ok: false, error: 'Invalid episode id' });
          return;
        }

        socket.leave(`episode:${id}`);
        ack?.({ ok: true, episodeId: id });
      });

      socket.on('heartbeat:ping', (ack?: (payload: { ok: true; ts: string }) => void) => {
        ack?.({ ok: true, ts: new Date().toISOString() });
      });

      socket.on(
        'activity:resume',
        async (
          payload: { cursor?: string; limit?: number; episodeId?: string } | undefined,
          ack?: (response: { ok: boolean; items?: unknown[]; error?: string }) => void
        ) => {
          try {
            const cursor = payload?.cursor;
            const limit = Math.max(1, Math.min(200, Number(payload?.limit || 100)));
            const episodeId = typeof payload?.episodeId === 'string' ? payload.episodeId : undefined;

            const items = await prisma.activityEvent.findMany({
              where: {
                userId,
                ...(episodeId ? { episodeId } : {}),
              },
              orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
              take: limit,
              ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
            });

            ack?.({ ok: true, items });
          } catch (error) {
            logger.warn('Realtime activity resume failed:', error);
            ack?.({ ok: false, error: 'Failed to resume activity stream' });
          }
        }
      );
    });
  }

  private shouldEmit(progress: JobProgressMessage): boolean {
    const current: JobEmitState = {
      status: progress.status,
      stage: progress.stage,
      progressBucket: Math.max(0, Math.min(20, Math.floor((progress.progress || 0) / 5))),
    };

    const previous = this.lastSentByJob.get(progress.jobId);
    this.lastSentByJob.set(progress.jobId, current);

    if (!previous) return true;
    if (progress.status === 'done' || progress.status === 'error' || progress.status === 'cancelled') {
      return true;
    }

    return (
      previous.status !== current.status ||
      previous.stage !== current.stage ||
      previous.progressBucket !== current.progressBucket
    );
  }

  private async handleJobProgressMessage(
    _pattern: string,
    channel: string,
    message: string
  ): Promise<void> {
    if (!this.io) return;

    let progress: JobProgressMessage;

    try {
      progress = JSON.parse(message) as JobProgressMessage;
    } catch {
      logger.warn('Realtime gateway received invalid JSON progress payload');
      return;
    }

    const jobId = progress.jobId || channel.split(':').at(-1);
    if (!jobId) return;

    if (!this.shouldEmit({ ...progress, jobId })) {
      return;
    }

    const job = await prisma.job.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        type: true,
        status: true,
        stage: true,
        progress: true,
        errorMessage: true,
        updatedAt: true,
        userId: true,
        episodeId: true,
        episode: {
          select: {
            id: true,
            title: true,
            status: true,
            updatedAt: true,
          },
        },
      },
    }) as JobSnapshot | null;

    if (!job) {
      return;
    }

    const eventType = mapJobEventType(job.status);
    const occurredAt = new Date(progress.timestamp || Date.now());

    const eventPayload = {
      id: randomUUID(),
      userId: job.userId,
      episodeId: job.episodeId,
      jobId: job.id,
      entityType: 'job' as ActivityEntityType,
      eventType,
      occurredAt: occurredAt.toISOString(),
      payload: {
        message: progress.message || null,
        job: {
          id: job.id,
          type: job.type,
          status: job.status,
          stage: job.stage,
          progress: job.progress,
          errorMessage: job.errorMessage,
          updatedAt: job.updatedAt.toISOString(),
          episodeId: job.episodeId,
        },
        episode: job.episode
          ? {
              id: job.episode.id,
              title: job.episode.title,
              status: job.episode.status,
              updatedAt: job.episode.updatedAt.toISOString(),
            }
          : null,
      },
    };

    this.io.to(`user:${job.userId}`).emit('activity:event', eventPayload);
    if (job.episodeId) {
      this.io.to(`episode:${job.episodeId}`).emit('activity:event', eventPayload);
    }

    // Persist normalized activity events for replay/history.
    await prisma.activityEvent
      .create({
        data: {
          id: eventPayload.id,
          userId: eventPayload.userId,
          episodeId: eventPayload.episodeId,
          jobId: eventPayload.jobId,
          entityType: eventPayload.entityType,
          eventType: eventPayload.eventType,
          payload: eventPayload.payload,
          occurredAt,
        },
      })
      .catch((error: unknown) => {
        logger.warn('Failed to persist activity event:', error);
      });
  }
}

export const activityRealtimeGateway = new ActivityRealtimeGateway();
