/**
 * Rate Limit Manager
 * 
 * Manages global rate limit state to prevent excessive API requests.
 * When rate limited, polling is paused until the retryAfter period expires.
 */

import { RateLimitError } from './api';

class RateLimitManager {
  private routeRateLimits = new Map<string, number>();
  private listeners: Set<() => void> = new Set();

  private normalizeRoute(url?: string): string {
    if (!url) return 'global';
    const path = url.split('?')[0] || url;
    if (path.includes('/jobs')) return '/jobs';
    return path;
  }

  private pruneExpired(): void {
    const now = Date.now();
    for (const [route, expiresAt] of this.routeRateLimits.entries()) {
      if (now >= expiresAt) {
        this.routeRateLimits.delete(route);
      }
    }
  }

  /**
   * Check if currently rate limited
   */
  isRateLimited(url?: string): boolean {
    this.pruneExpired();
    if (this.routeRateLimits.size === 0) return false;
    if (!url) return true;

    const key = this.normalizeRoute(url);
    return this.routeRateLimits.has(key);
  }

  /**
   * Get remaining time until rate limit expires (in seconds)
   */
  getRemainingTime(url?: string): number {
    this.pruneExpired();
    if (this.routeRateLimits.size === 0) return 0;

    if (url) {
      const route = this.normalizeRoute(url);
      const until = this.routeRateLimits.get(route);
      if (!until) return 0;
      return Math.max(0, Math.ceil((until - Date.now()) / 1000));
    }

    let remaining = 0;
    for (const until of this.routeRateLimits.values()) {
      remaining = Math.max(remaining, Math.ceil((until - Date.now()) / 1000));
    }
    return Math.max(0, remaining);
  }

  /**
   * Handle a rate limit error
   */
  handleRateLimit(error: RateLimitError, url?: string): void {
    const route = this.normalizeRoute(url || String(error.details?.url || ''));
    // Avoid freezing polling for very long server windows on mobile clients.
    const cappedRetryAfterSec = Math.min(Math.max(error.retryAfter || 60, 5), 90);
    const retryAfterMs = cappedRetryAfterSec * 1000;
    const expiresAt = Date.now() + retryAfterMs;
    this.routeRateLimits.set(route, expiresAt);
    
    console.warn('🚫 Rate limit active:', {
      route,
      retryAfter: `${cappedRetryAfterSec}s`,
      expiresAt: new Date(expiresAt).toISOString(),
    });
    
    this.notifyListeners();
    
    // Auto-clear after retryAfter period
    setTimeout(() => {
      this.pruneExpired();
      if (this.routeRateLimits.size === 0) {
        this.notifyListeners();
        console.log('✅ Rate limit expired, resuming polling');
      }
    }, retryAfterMs);
  }

  /**
   * Subscribe to rate limit state changes
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Notify all listeners of state change
   */
  private notifyListeners(): void {
    this.listeners.forEach(listener => listener());
  }

  /**
   * Clear rate limit (for testing or manual override)
   */
  clear(): void {
    this.routeRateLimits.clear();
    this.notifyListeners();
  }
}

export const rateLimitManager = new RateLimitManager();
