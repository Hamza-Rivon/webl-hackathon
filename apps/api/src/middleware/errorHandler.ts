/**
 * Global Error Handler Middleware
 *
 * Catches all errors and returns appropriate responses.
 */

import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { logger } from '@webl/shared';

interface AppError extends Error {
  statusCode?: number;
  code?: string;
}

export function errorHandler(
  err: AppError,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  // Log the error
  logger.error('API Error:', {
    message: err.message,
    stack: err.stack,
    code: err.code,
  });

  // Handle Zod validation errors
  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'Validation Error',
      details: err.errors.map((e) => ({
        path: e.path.join('.'),
        message: e.message,
      })),
    });
    return;
  }

  // Handle known error codes
  if (err.code === 'UNAUTHORIZED') {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  if (err.code === 'FORBIDDEN') {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  if (err.code === 'NOT_FOUND') {
    res.status(404).json({ error: 'Not Found' });
    return;
  }

  // Handle custom status codes
  const statusCode = err.statusCode || 500;

  // Don't expose internal errors in production
  const message =
    process.env.NODE_ENV === 'production' && statusCode === 500
      ? 'Internal Server Error'
      : err.message;

  res.status(statusCode).json({ error: message });
}
