/**
 * Express Application Setup
 *
 * Configures Express with security middleware, authentication,
 * and route handlers for the WEBL API.
 */

import express, { Express, Request, Response } from 'express';
import { setupSecurityMiddleware } from './middleware/security.js';
import { clerkAuth, requireAuthentication } from './middleware/clerk.js';
import { errorHandler } from './middleware/errorHandler.js';

// Route imports
import { healthRouter } from './routes/health.js';
import { webhooksRouter } from './routes/webhooks.js';
import { usersRouter } from './routes/users.js';
import { seriesRouter } from './routes/series.js';
import { episodesRouter } from './routes/episodes.js';
import { uploadsRouter } from './routes/uploads.js';
import { jobsRouter } from './routes/jobs.js';
import { onboardingRouter } from './routes/onboarding.js';
import { slotsRouter } from './routes/slots.js';
import { templatesRouter } from './routes/templates.js';
import { activityRouter } from './routes/activity.js';

export async function createApp(): Promise<Express> {
  const app = express();

  // 1. Security middleware first (Helmet, CORS, Rate Limiting)
  setupSecurityMiddleware(app);

  // 2. Public routes (no auth required)
  app.use('/health', healthRouter);
  
  // 3. Webhook routes with raw body for signature verification
  app.use('/webhooks', express.raw({ type: 'application/json', limit: '1mb' }), webhooksRouter);

  // 4. Body parsing (with size limits for security)
  app.use(express.json({ limit: '10kb' }));
  app.use(express.urlencoded({ extended: true, limit: '10kb' }));

  // 5. Clerk authentication middleware for all API routes
  app.use('/api', clerkAuth);

  // 6. Protected API routes
  app.use('/api/users', requireAuthentication, usersRouter);
  app.use('/api/onboarding', requireAuthentication, onboardingRouter);
  app.use('/api/series', requireAuthentication, seriesRouter);
  app.use('/api/episodes', requireAuthentication, episodesRouter);
  app.use('/api/templates', requireAuthentication, templatesRouter);
  app.use('/api/uploads', requireAuthentication, uploadsRouter);
  app.use('/api/jobs', requireAuthentication, jobsRouter);
  app.use('/api/activity', requireAuthentication, activityRouter);
  
  // 7. Slot routes (mounted under /api for slot-specific operations)
  // Note: Episode slot routes are in slotsRouter (/api/episodes/:id/slots)
  app.use('/api', requireAuthentication, slotsRouter);

  // 8. 404 handler
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'Not Found' });
  });

  // 9. Global error handler
  app.use(errorHandler);

  return app;
}
