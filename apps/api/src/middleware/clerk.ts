/**
 * Clerk Authentication Middleware
 *
 * Handles JWT verification and user authentication via Clerk SDK.
 */

import { clerkMiddleware, requireAuth, getAuth } from '@clerk/express';
import type { Request, Response, NextFunction } from 'express';

// Type augmentation for Express Request
declare global {
  namespace Express {
    interface Request {
      auth?: {
        userId: string | null;
        sessionId: string | null;
        getToken: () => Promise<string | null>;
      };
    }
  }
}

/**
 * Initialize Clerk middleware - adds auth to all requests
 */
export const clerkAuth = clerkMiddleware();

/**
 * Protect routes - returns 401 if not authenticated
 */
export const requireAuthentication = requireAuth();

/**
 * Optional auth - get user data without requiring authentication
 */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const auth = getAuth(req);
  req.auth = auth;
  next();
}

/**
 * Get the authenticated user ID from the request
 */
export function getUserId(req: Request): string | null {
  const auth = getAuth(req);
  return auth?.userId || null;
}
