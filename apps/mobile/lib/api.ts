/**
 * API Client
 *
 * Axios client with Clerk token injection and comprehensive error handling.
 * Requirements: 3.1
 */

import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { useAuth } from '@clerk/clerk-expo';
import { useCallback, useMemo } from 'react';
import Constants from 'expo-constants';
import { rateLimitManager } from './rateLimitManager';

const apiUrlFromExpoConfig = (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl;
const apiUrlFromEnv = process.env.EXPO_PUBLIC_API_URL;
const API_URL = apiUrlFromExpoConfig || apiUrlFromEnv || 'http://localhost:3000';
const REQUEST_TIMEOUT_MS = 45_000;
const DEBUG_API_LOGS = __DEV__ && process.env.EXPO_PUBLIC_DEBUG_API !== '0';
const API_URL_SOURCE = apiUrlFromExpoConfig ? 'expoConfig.extra.apiUrl' : apiUrlFromEnv ? 'EXPO_PUBLIC_API_URL' : 'fallback';
let lastNetworkDiagnosticsAt = 0;

// Log API URL resolution for debugging on every dev launch.
if (DEBUG_API_LOGS) {
  console.log('🔗 API URL configured:', API_URL);
  console.log('🔎 API URL source:', API_URL_SOURCE);
  console.log('🔗 EXPO_PUBLIC_API_URL from env:', apiUrlFromEnv || 'NOT SET');
  console.log('🔗 Expo extra.apiUrl:', apiUrlFromExpoConfig || 'NOT SET');
  if (API_URL.includes('localhost') || API_URL.includes('127.0.0.1')) {
    console.warn('⚠️ API_URL points to localhost. Physical devices cannot reach your Mac localhost.');
  }
}

async function runNetworkDiagnostics(): Promise<void> {
  if (!DEBUG_API_LOGS) return;
  const now = Date.now();
  if (now - lastNetworkDiagnosticsAt < 15000) return;
  lastNetworkDiagnosticsAt = now;

  try {
    const healthUrl = `${API_URL}/health`;
    const healthResponse = await fetch(healthUrl, { method: 'GET' });
    console.log('🧪 Health probe result:', {
      url: healthUrl,
      status: healthResponse.status,
      ok: healthResponse.ok,
    });
  } catch (healthError) {
    console.error('🧪 Health probe failed:', {
      url: `${API_URL}/health`,
      error:
        healthError instanceof Error
          ? { name: healthError.name, message: healthError.message }
          : String(healthError),
    });
  }

  try {
    const internetResponse = await fetch('https://www.google.com/generate_204', { method: 'GET' });
    console.log('🧪 Internet probe result:', {
      status: internetResponse.status,
      ok: internetResponse.ok,
    });
  } catch (internetError) {
    console.error('🧪 Internet probe failed:', {
      error:
        internetError instanceof Error
          ? { name: internetError.name, message: internetError.message }
          : String(internetError),
    });
  }
}

// API Error types
export class ApiError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class NetworkError extends ApiError {
  constructor(message = 'Network error. Please check your connection.') {
    super(0, 'NETWORK_ERROR', message);
    this.name = 'NetworkError';
  }
}

export class AuthenticationError extends ApiError {
  constructor(message = 'Authentication required. Please sign in.') {
    super(401, 'AUTHENTICATION_ERROR', message);
    this.name = 'AuthenticationError';
  }
}

export class ValidationError extends ApiError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(400, 'VALIDATION_ERROR', message, details);
    this.name = 'ValidationError';
  }
}

export class RateLimitError extends ApiError {
  constructor(
    message: string,
    public retryAfter: number,
    details?: Record<string, unknown>
  ) {
    super(429, 'RATE_LIMIT_EXCEEDED', message, details);
    this.name = 'RateLimitError';
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function resolveAuthToken(
  getToken: () => Promise<string | null>
): Promise<string | null> {
  const firstAttempt = await getToken();
  if (firstAttempt) return firstAttempt;

  // Clerk can briefly report "signed in" before token is ready.
  await delay(120);
  return getToken();
}

function isJobsPollingRequest(config: {
  method?: string;
  url?: string;
}): boolean {
  const method = (config.method || 'get').toLowerCase();
  const url = config.url || '';
  return method === 'get' && url.includes('/jobs');
}

// Response types
export interface ApiResponse<T> {
  data: T;
  success: boolean;
}

// Input types for mutations
export interface CreateSeriesInput {
  name: string;
  description?: string;
  cadence?: 'daily' | 'weekly' | 'biweekly' | 'monthly';
  templateId?: string;
}

export interface UpdateSeriesInput {
  name?: string;
  description?: string;
  cadence?: 'daily' | 'weekly' | 'biweekly' | 'monthly';
  templateId?: string;
}

export interface CreateEpisodeInput {
  title: string;
  seriesId?: string;
  templateId: string;
  scriptContent?: string;
  mode?: 'template_copy' | 'auto_edit';
}

export interface UpdateEpisodeInput {
  title?: string;
  seriesId?: string;
  templateId?: string;
  scriptContent?: string;
  captionsEnabled?: boolean;
}

export interface TemplateFilters {
  platform?: 'tiktok' | 'reels' | 'shorts' | 'all';
  niche?: string;
  tone?: string;
  limit?: number;
  offset?: number;
}

export interface TemplateSearchInput {
  query: string;
  platform?: 'tiktok' | 'reels' | 'shorts' | 'all';
  niche?: string;
  tone?: string;
  limit?: number;
}

// Slot types for template-driven capture
export type SlotType =
  | 'a_roll_face'
  | 'b_roll_illustration'
  | 'b_roll_action'
  | 'screen_record'
  | 'product_shot'
  | 'pattern_interrupt'
  | 'cta_overlay';

export type SlotSource = 'recorded' | 'uploaded';

export interface SlotClip {
  id: string;
  episodeId: string;
  slotId: string;
  slotType: SlotType;
  source: SlotSource;
  s3Key: string;
  muxAssetId?: string;
  muxPlaybackId?: string;
  duration?: number;
  fps?: number;
  orientation?: 'portrait' | 'landscape' | 'square';
  width?: number;
  height?: number;
  aiTags?: string[];
  aiSummary?: string;
  moderationStatus?: string;
  selectedSegments?: Array<{ startTime: number; endTime: number; score?: number }>;
  createdAt: string;
  updatedAt: string;
}

export interface SlotRequirement {
  slotId: string;
  slotType: SlotType;
  priority: 'required' | 'optional';
  duration: { min: number; target: number; max: number };
  allowedSources: SlotSource[];
  description: string;
  examples: string[];
  layoutUsage: {
    beatIndices: number[];
    position: 'fullscreen' | 'top' | 'bottom' | 'overlay';
  };
}

export interface SlotProgress {
  requiredTotal: number;
  requiredCompleted: number;
  optionalTotal: number;
  optionalCompleted: number;
  isComplete: boolean;
}

export interface CreateSlotClipInput {
  slotId: string;
  slotType: SlotType;
  source: SlotSource;
  s3Key: string;
  duration?: number;
  width?: number;
  height?: number;
  fps?: number;
}


// Unauthenticated client for public endpoints
export const apiClient = axios.create({
  baseURL: `${API_URL}/api`,
  timeout: REQUEST_TIMEOUT_MS,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Log API client base URL for debugging
if (DEBUG_API_LOGS) {
  console.log('🔗 API Client baseURL:', apiClient.defaults.baseURL);
}

// Error response handler
function handleApiError(error: AxiosError | RateLimitError): never {
  // Preserve RateLimitError instances thrown from request interceptors
  if (error instanceof RateLimitError) {
    throw error;
  }

  if (!error.response) {
    const isTimeout = error.code === 'ECONNABORTED';
    // Log detailed error information for debugging
    const logPayload = {
      message: error.message,
      code: error.code,
      config: {
        url: error.config?.url,
        method: error.config?.method,
        baseURL: error.config?.baseURL,
        timeout: error.config?.timeout,
      },
      request: error.request ? 'Request object exists' : 'No request object',
    };

    if (isTimeout) {
      if (DEBUG_API_LOGS) {
        console.warn('⏱️ API request timed out:', logPayload);
      }
      throw new NetworkError('Request timed out. Please check your connection and try again.');
    }

    if (DEBUG_API_LOGS) {
      const axiosJson = typeof error.toJSON === 'function' ? error.toJSON() : null;
      console.error('🔴 Network Error Details:', {
        ...logPayload,
        axios: axiosJson,
      });
      void runNetworkDiagnostics();
    }
    throw new NetworkError();
  }

  const { status, data, headers } = error.response;
  const errorData = data as { 
    error?: string; 
    message?: string; 
    details?: Record<string, unknown>;
    retryAfter?: number;
  };
  const message = errorData?.error || errorData?.message || 'An error occurred';

  if (status === 401) {
    throw new AuthenticationError(message);
  }

  if (status === 400) {
    throw new ValidationError(message, errorData?.details);
  }

  if (status === 429) {
    // Extract retryAfter from response body or Retry-After header
    const retryAfter = errorData?.retryAfter || 
                      (headers['retry-after'] ? parseInt(headers['retry-after'], 10) : 60);
    const rateLimitError = new RateLimitError(message, retryAfter, errorData?.details);
    // Notify rate limit manager
    rateLimitManager.handleRateLimit(rateLimitError, error.config?.url);
    throw rateLimitError;
  }

  throw new ApiError(status, `HTTP_${status}`, message, errorData?.details);
}

// Add response interceptor for error handling
apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError | RateLimitError) => handleApiError(error)
);

/**
 * Hook to get an authenticated API client
 * Automatically injects Clerk token into Authorization header
 */
export function useApiClient(): AxiosInstance {
  const { getToken } = useAuth();

  const authenticatedClient = useMemo(() => {
    const client = axios.create({
      baseURL: `${API_URL}/api`,
      timeout: REQUEST_TIMEOUT_MS,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Request interceptor to add auth token and respect global rate limiting
    client.interceptors.request.use(
      async (config: InternalAxiosRequestConfig) => {
        // If global rate limit is active, short-circuit before hitting the network
        if (isJobsPollingRequest(config) && rateLimitManager.isRateLimited(config.url)) {
          const remaining = rateLimitManager.getRemainingTime(config.url) || 60;
          if (DEBUG_API_LOGS) {
            console.warn('⚠️ Rate limit active: blocking request', {
              url: config.url,
              retryAfter: `${remaining}s`,
            });
          }
          return Promise.reject(
            new RateLimitError(
              'Polling paused until rate limit resets',
              remaining,
              { url: config.url }
            )
          );
        }

        try {
          const token = await resolveAuthToken(getToken);
          if (token) {
            config.headers.Authorization = `Bearer ${token}`;
            if (DEBUG_API_LOGS) {
              console.log('🔐 Auth token added to request:', config.url);
            }
          } else if (config.url !== '/health') {
            return Promise.reject(
              new AuthenticationError('Authentication token not ready. Please retry.')
            );
          }
        } catch (err) {
          if (err instanceof AuthenticationError) {
            return Promise.reject(err);
          }
          if (DEBUG_API_LOGS) {
            console.error('❌ Failed to get auth token:', err);
          }
          return Promise.reject(
            new AuthenticationError('Failed to load authentication token. Please retry.')
          );
        }
        if (DEBUG_API_LOGS) {
          console.log('📤 Making API request:', {
            method: config.method?.toUpperCase(),
            url: config.url,
            baseURL: config.baseURL,
            fullURL: `${config.baseURL}${config.url}`,
          });
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    // Response interceptor for error handling (including rate limits)
    client.interceptors.response.use(
      (response) => {
        if (DEBUG_API_LOGS) {
          console.log('✅ API Response received:', {
            status: response.status,
            url: response.config.url,
          });
        }
        return response;
      },
      (error: AxiosError | RateLimitError) => {
        // If this is a RateLimitError coming from the request interceptor, just rethrow
        if (error instanceof RateLimitError) {
          return Promise.reject(error);
        }

        // Network-level errors (timeouts, offline, DNS) are handled centrally.
        if (!error.response) {
          return handleApiError(error);
        }

        const status = error.response?.status;
        
        // Don't log 404 errors for series/episodes (expected when resources are deleted)
        const is404 = status === 404;
        const isDeletedResource = error.config?.url?.includes('/series/') || 
                                  error.config?.url?.includes('/episodes/') ||
                                  error.config?.url?.startsWith('/jobs') ||
                                  error.config?.url?.startsWith('/activity');
        
        // Don't log 404 errors for base routes when no auth token (expected during app initialization)
        const hasAuthToken = error.config?.headers?.Authorization;
        const isBaseRoute = error.config?.url && (
          error.config.url === '/series' ||
          error.config.url === '/episodes' ||
          error.config.url.startsWith('/jobs') ||
          error.config.url.startsWith('/activity') ||
          error.config.url === '/templates'
        );
        const isUnauthenticated404 = is404 && !hasAuthToken && isBaseRoute;
        
        // Don't log 429 errors repeatedly - they're handled by rate limit manager
        const is429 = status === 429;
        
        if (DEBUG_API_LOGS && (!is404 || (!isDeletedResource && !isUnauthenticated404))) {
          const errorData = error.response?.data as any || {};
          const validationDetails = errorData?.details || errorData?.errors || [];
          
          // Only log 429 once per retryAfter period to avoid spam
          if (is429) {
            const retryAfter = errorData?.retryAfter || 60;
            console.warn('⚠️ Rate limit exceeded:', {
              retryAfter: `${retryAfter}s`,
              url: error.config?.url,
              message: 'Polling paused until rate limit resets',
            });
          } else {
            let requestData: unknown;
            if (typeof error.config?.data === 'string') {
              try {
                requestData = JSON.parse(error.config.data);
              } catch {
                requestData = error.config.data;
              }
            } else {
              requestData = error.config?.data;
            }

            console.error('❌ API Error in response interceptor:', {
              message: error.message,
              code: error.code,
              status,
              url: error.config?.url,
              error: errorData?.error || errorData?.message || 'Unknown error',
              validationDetails: Array.isArray(validationDetails) 
                ? validationDetails.map((detail: any) => ({
                    path: detail?.path || detail?.field || 'unknown',
                    message: detail?.message || detail?.msg || JSON.stringify(detail),
                    code: detail?.code,
                  }))
                : validationDetails,
              requestData,
              fullErrorData: errorData,
            });
          }
        }
        return handleApiError(error);
      }
    );

    return client;
  }, [getToken]);

  return authenticatedClient;
}

// Ensure unauthenticated client also respects global rate limit to avoid spamming the API
apiClient.interceptors.request.use(
  async (config: InternalAxiosRequestConfig) => {
    if (isJobsPollingRequest(config) && rateLimitManager.isRateLimited(config.url)) {
      const remaining = rateLimitManager.getRemainingTime(config.url) || 60;
      if (DEBUG_API_LOGS) {
        console.warn('⚠️ Rate limit active: blocking unauthenticated request', {
          url: config.url,
          retryAfter: `${remaining}s`,
        });
      }
      return Promise.reject(
        new RateLimitError(
          'Polling paused until rate limit resets',
          remaining,
          { url: config.url }
        )
      );
    }
    return config;
  },
  (error) => Promise.reject(error)
);

/**
 * Hook to get API URL for SSE connections
 */
export function useApiUrl(): string {
  return API_URL;
}

/**
 * Hook to get auth token for SSE connections
 */
export function useAuthToken(): () => Promise<string | null> {
  const { getToken } = useAuth();
  return useCallback(() => getToken(), [getToken]);
}
