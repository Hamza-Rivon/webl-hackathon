import type { NextFunction, Request, Response } from 'express';
import crypto from 'crypto';
import IORedis from 'ioredis';
import { config } from '../config/index.js';

interface StoredResponse {
  statusCode: number;
  body: unknown;
}

interface IdempotencyMiddlewareOptions {
  ttlSeconds?: number;
  lockTtlSeconds?: number;
}

interface IdempotencyStore {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string, ttlSeconds: number) => Promise<void>;
  setNx: (key: string, value: string, ttlSeconds: number) => Promise<boolean>;
  del: (key: string) => Promise<void>;
}

type MemoryEntry = { value: string; expiresAt: number };

const memoryStore = new Map<string, MemoryEntry>();

function cleanupMemoryStore() {
  const now = Date.now();
  for (const [key, entry] of memoryStore.entries()) {
    if (entry.expiresAt <= now) {
      memoryStore.delete(key);
    }
  }
}

function getMemoryStore(): IdempotencyStore {
  return {
    async get(key: string) {
      cleanupMemoryStore();
      const entry = memoryStore.get(key);
      if (!entry) return null;
      if (entry.expiresAt <= Date.now()) {
        memoryStore.delete(key);
        return null;
      }
      return entry.value;
    },
    async set(key: string, value: string, ttlSeconds: number) {
      memoryStore.set(key, {
        value,
        expiresAt: Date.now() + ttlSeconds * 1000,
      });
    },
    async setNx(key: string, value: string, ttlSeconds: number) {
      cleanupMemoryStore();
      const existing = memoryStore.get(key);
      if (existing && existing.expiresAt > Date.now()) {
        return false;
      }
      memoryStore.set(key, {
        value,
        expiresAt: Date.now() + ttlSeconds * 1000,
      });
      return true;
    },
    async del(key: string) {
      memoryStore.delete(key);
    },
  };
}

function createRedisStore(): IdempotencyStore | null {
  if (!config.redis.url) return null;

  try {
    const isUpstash = config.redis.url.includes('upstash.io');
    const redis = new IORedis(config.redis.url, {
      maxRetriesPerRequest: 1,
      enableReadyCheck: false,
      ...(isUpstash && {
        tls: {
          rejectUnauthorized: true,
        },
      }),
    });

    return {
      async get(key: string) {
        return redis.get(key);
      },
      async set(key: string, value: string, ttlSeconds: number) {
        await redis.set(key, value, 'EX', ttlSeconds);
      },
      async setNx(key: string, value: string, ttlSeconds: number) {
        const result = await redis.set(key, value, 'EX', ttlSeconds, 'NX');
        return result === 'OK';
      },
      async del(key: string) {
        await redis.del(key);
      },
    };
  } catch {
    return null;
  }
}

const store: IdempotencyStore = createRedisStore() || getMemoryStore();

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return String(value);
  if (typeof value !== 'object') return JSON.stringify(value);

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  const objectValue = value as Record<string, unknown>;
  const keys = Object.keys(objectValue).sort();
  const keyValues = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(objectValue[key])}`);
  return `{${keyValues.join(',')}}`;
}

function buildFallbackKey(req: Request): string {
  const userId = req.auth?.userId || 'anonymous';
  const payload = stableStringify(req.body || {});
  const hash = crypto
    .createHash('sha256')
    .update(`${req.method}:${req.baseUrl}${req.path}:${userId}:${payload}`)
    .digest('hex');
  return `auto-${hash}`;
}

function normalizeProvidedKey(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > 140) return null;
  return trimmed;
}

export function withIdempotency(options: IdempotencyMiddlewareOptions = {}) {
  const ttlSeconds = options.ttlSeconds ?? 90;
  const lockTtlSeconds = options.lockTtlSeconds ?? 20;

  return async function idempotencyMiddleware(req: Request, res: Response, next: NextFunction) {
    const headerKey = normalizeProvidedKey(req.header('Idempotency-Key') || undefined);
    if (req.header('Idempotency-Key') && !headerKey) {
      res.status(400).json({
        error: 'Invalid Idempotency-Key header',
      });
      return;
    }

    const rawKey = headerKey || buildFallbackKey(req);
    const userId = req.auth?.userId || 'anonymous';
    const routeKey = `${req.baseUrl}${req.path}`;
    const cacheKey = `idem:${userId}:${req.method}:${routeKey}:${rawKey}`;
    const lockKey = `${cacheKey}:lock`;

    const cached = await store.get(cacheKey);
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as StoredResponse;
        res.setHeader('Idempotency-Replayed', 'true');
        res.setHeader('Idempotency-Key', rawKey);
        res.status(parsed.statusCode).json(parsed.body);
        return;
      } catch {
        // If cache parsing fails, continue as a normal request.
      }
    }

    const lockAcquired = await store.setNx(lockKey, '1', lockTtlSeconds);
    if (!lockAcquired) {
      // Another request with the same key is in-flight. Wait briefly for it to finish.
      for (let attempt = 0; attempt < 12; attempt += 1) {
        await sleep(120);
        const replay = await store.get(cacheKey);
        if (replay) {
          try {
            const parsed = JSON.parse(replay) as StoredResponse;
            res.setHeader('Idempotency-Replayed', 'true');
            res.setHeader('Idempotency-Key', rawKey);
            res.status(parsed.statusCode).json(parsed.body);
            return;
          } catch {
            break;
          }
        }
      }

      res.status(409).json({
        error: 'An identical request is already in progress.',
      });
      return;
    }

    let responseBody: unknown = null;
    const originalJson = res.json.bind(res);
    res.json = ((body: unknown) => {
      responseBody = body;
      return originalJson(body);
    }) as Response['json'];

    res.on('finish', () => {
      void (async () => {
        try {
          if (res.statusCode < 500) {
            await store.set(
              cacheKey,
              JSON.stringify({
                statusCode: res.statusCode,
                body: responseBody,
              } satisfies StoredResponse),
              ttlSeconds
            );
          }
        } finally {
          await store.del(lockKey);
        }
      })();
    });

    res.on('close', () => {
      void store.del(lockKey);
    });

    next();
  };
}

