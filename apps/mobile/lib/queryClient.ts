/**
 * React Query Client Configuration
 *
 * Configures the query client with default options for caching,
 * retries, and stale time management.
 */

import { QueryClient } from '@tanstack/react-query';
import { AuthenticationError, RateLimitError } from './api';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Data is considered fresh for 30 seconds
      staleTime: 30 * 1000,
      // Cache data for 5 minutes
      gcTime: 5 * 60 * 1000,
      // Retry failed requests, but not on rate limit errors
      retry: (failureCount, error) => {
        // Don't retry on rate limit errors - wait for rate limit to expire
        if (error instanceof RateLimitError || error instanceof AuthenticationError) {
          return false;
        }
        // Retry other errors up to 2 times
        return failureCount < 2;
      },
      // Don't refetch on window focus for mobile
      refetchOnWindowFocus: false,
      // Refetch on reconnect
      refetchOnReconnect: true,
    },
    mutations: {
      // Retry mutations, but not on rate limit errors
      retry: (failureCount, error) => {
        if (error instanceof RateLimitError || error instanceof AuthenticationError) {
          return false;
        }
        return failureCount < 1;
      },
    },
  },
});
