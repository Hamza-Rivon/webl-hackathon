/**
 * Security Middleware Stack
 *
 * Configures Helmet, CORS, and Rate Limiting for API security.
 * Uses in-memory rate limiting (can be upgraded to Redis for multi-instance deployments).
 */

import { Express, Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { config } from '../config/index.js';

/**
 * Extract user identifier for rate limiting
 * Uses Clerk user ID if authenticated, otherwise falls back to IP
 */
function getUserIdentifier(req: Request): string {
  // Check for Clerk auth (set by clerkAuth middleware)
  const auth = (req as Request & { auth?: { userId?: string } }).auth;
  if (auth?.userId) {
    return `user:${auth.userId}`;
  }
  // Fall back to IP address
  return `ip:${req.ip || req.socket.remoteAddress || 'unknown'}`;
}

/**
 * Health check paths that should skip rate limiting
 */
const SKIP_PATHS = ['/health', '/health/ready', '/health/live'];

/**
 * Paths with higher rate limits (uploads, slots, etc.)
 */
const HIGH_LIMIT_PATHS = ['/api/uploads', '/api/slot-clips', '/api/episodes'];

export function setupSecurityMiddleware(app: Express): void {
  // 1. Helmet - Security Headers
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'https:', 'data:'],
          connectSrc: ["'self'", 'https://api.clerk.com', 'https://api.mux.com', 'https://stream.mux.com'],
          frameSrc: ["'none'"],
          objectSrc: ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false, // For video embeds
      hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true,
      },
    })
  );

  // 2. CORS - Strict Origin Control
  app.use(
    cors({
      origin: config.security.corsOrigins,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'Idempotency-Key'],
      maxAge: 86400, // 24 hours
    })
  );

  // 3. Higher rate limit for upload-heavy endpoints (500 requests per 15 minutes)
  // Using in-memory store (no Redis dependency)
  const uploadLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 500, // 500 requests per window (uploads need many calls)
    standardHeaders: true,
    legacyHeaders: false,
    // No store specified = uses default in-memory store
    keyGenerator: getUserIdentifier,
    handler: (_req: Request, res: Response, _next: NextFunction, options) => {
      const retryAfter = Math.ceil(options.windowMs / 1000);
      res.setHeader('Retry-After', retryAfter.toString());
      res.status(429).json({
        error: 'Too many upload requests, please try again later',
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter,
      });
    },
  });
  app.use('/api/uploads', uploadLimiter);
  app.use('/api/slot-clips', uploadLimiter);

  // 4. Global Rate Limiting (2500 requests per 15 minutes per user)
  // Using in-memory store (no Redis dependency)
  const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 2500, // 2500 requests per window (increased for app usage)
    standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
    legacyHeaders: false, // Disable `X-RateLimit-*` headers
    // No store specified = uses default in-memory store
    keyGenerator: getUserIdentifier,
    skip: (req) => SKIP_PATHS.includes(req.path) || HIGH_LIMIT_PATHS.some(p => req.path.startsWith(p)),
    handler: (_req: Request, res: Response, _next: NextFunction, options) => {
      const retryAfter = Math.ceil(options.windowMs / 1000);
      res.setHeader('Retry-After', retryAfter.toString());
      res.status(429).json({
        error: 'Too many requests, please try again later',
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter,
      });
    },
  });
  app.use('/api', globalLimiter);

  // 5. Stricter limits for webhook endpoints (10 requests per hour)
  // Using in-memory store (no Redis dependency)
  const webhookLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10, // 10 requests per hour
    standardHeaders: true,
    legacyHeaders: false,
    // No store specified = uses default in-memory store
    keyGenerator: (req) => `ip:${req.ip || req.socket.remoteAddress || 'unknown'}`,
    handler: (_req: Request, res: Response, _next: NextFunction, options) => {
      const retryAfter = Math.ceil(options.windowMs / 1000);
      res.setHeader('Retry-After', retryAfter.toString());
      res.status(429).json({
        error: 'Too many webhook requests',
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter,
      });
    },
  });
  app.use('/webhooks', webhookLimiter);

  // 6. Trust proxy for proper IP detection behind load balancer
  app.set('trust proxy', 1);
}
