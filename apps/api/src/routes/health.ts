/**
 * Health Check Route
 *
 * Public endpoint for load balancer and monitoring.
 */

import { Router, Request, Response } from 'express';

export const healthRouter = Router();

healthRouter.get('/', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'webl-api',
  });
});
