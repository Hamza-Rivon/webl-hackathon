/**
 * Constants
 *
 * Shared configuration constants for WEBL.
 */

// API Keys (from environment)
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
export const GEMINI_MODEL_NAME = 'gemini-3-pro-preview';

// Mux (new)
export const MUX_TOKEN_ID = process.env.MUX_TOKEN_ID || '';
export const MUX_TOKEN_SECRET = process.env.MUX_TOKEN_SECRET || '';
export const MUX_WEBHOOK_SECRET = process.env.MUX_WEBHOOK_SECRET || '';

// Testing
export const IS_TESTING = process.env.NODE_ENV === 'test';

// Limits
export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024 * 1024; // 5GB
export const MAX_EPISODE_DURATION = 180; // 3 minutes
export const MAX_TEMPLATE_DESCRIPTION = 1000;
export const MAX_SCRIPT_LENGTH = 10000;

// Chunk Configuration
export const CHUNK_DURATION_SECONDS = Number(process.env.CHUNK_DURATION_SECONDS) || 2;
export const CHUNK_DURATION_MS = CHUNK_DURATION_SECONDS * 1000;

// Feature flag for full chunk concatenation
export const USE_FULL_CHUNK_CONCATENATION = 
  process.env.USE_FULL_CHUNK_CONCATENATION === 'true' || 
  process.env.USE_FULL_CHUNK_CONCATENATION === '1';
