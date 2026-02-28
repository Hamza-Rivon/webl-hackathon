/**
 * Error Messages Utility
 *
 * Translates technical error messages to user-friendly language.
 * Requirements: 10.8-10.10
 */

/**
 * Error categories for classification
 */
export type ErrorCategory = 'network' | 'validation' | 'timeout' | 'server' | 'unknown';

/**
 * Error pattern matching for categorization
 */
interface ErrorPattern {
  patterns: RegExp[];
  category: ErrorCategory;
  userMessage: string;
  suggestion?: string;
}

/**
 * Error patterns for matching and translation
 * Requirements: 10.8-10.10
 */
const ERROR_PATTERNS: ErrorPattern[] = [
  // Network errors - Requirement 10.9
  {
    patterns: [
      /network/i,
      /connection/i,
      /ECONNREFUSED/i,
      /ENOTFOUND/i,
      /ETIMEDOUT/i,
      /fetch failed/i,
      /no internet/i,
      /offline/i,
      /socket hang up/i,
    ],
    category: 'network',
    userMessage: 'Unable to connect to the server.',
    suggestion: 'Please check your internet connection and try again.',
  },
  // Timeout errors
  {
    patterns: [
      /timeout/i,
      /timed out/i,
      /deadline exceeded/i,
      /request took too long/i,
    ],
    category: 'timeout',
    userMessage: 'The request took too long to complete.',
    suggestion: 'Please try again. If the problem persists, the server may be busy.',
  },
  // Validation errors - Requirement 10.10
  {
    patterns: [
      /invalid/i,
      /validation/i,
      /required field/i,
      /missing.*field/i,
      /must be/i,
      /cannot be empty/i,
      /format.*incorrect/i,
    ],
    category: 'validation',
    userMessage: 'The data provided is invalid.',
    suggestion: 'Please check your input and try again.',
  },
  // File/Media errors
  {
    patterns: [
      /file.*not found/i,
      /media.*error/i,
      /upload.*failed/i,
      /download.*failed/i,
      /corrupt/i,
      /unsupported.*format/i,
    ],
    category: 'validation',
    userMessage: 'There was a problem with the media file.',
    suggestion: 'Please try uploading the file again or use a different file.',
  },
  // Authentication errors
  {
    patterns: [
      /unauthorized/i,
      /authentication/i,
      /not authenticated/i,
      /session.*expired/i,
      /token.*invalid/i,
    ],
    category: 'server',
    userMessage: 'Your session has expired.',
    suggestion: 'Please sign in again to continue.',
  },
  // Rate limiting
  {
    patterns: [
      /rate limit/i,
      /too many requests/i,
      /throttle/i,
    ],
    category: 'server',
    userMessage: 'Too many requests. Please slow down.',
    suggestion: 'Wait a moment before trying again.',
  },
  // Server errors
  {
    patterns: [
      /internal server/i,
      /500/,
      /502/,
      /503/,
      /504/,
      /server error/i,
      /service unavailable/i,
    ],
    category: 'server',
    userMessage: 'The server encountered an error.',
    suggestion: 'Please try again later. Our team has been notified.',
  },
  // Processing errors
  {
    patterns: [
      /processing.*failed/i,
      /job.*failed/i,
      /render.*failed/i,
      /transcription.*failed/i,
    ],
    category: 'server',
    userMessage: 'Processing failed.',
    suggestion: 'Please try again. If the problem persists, try with different content.',
  },
  // AI/ML errors
  {
    patterns: [
      /ai.*error/i,
      /model.*error/i,
      /embedding.*failed/i,
      /analysis.*failed/i,
    ],
    category: 'server',
    userMessage: 'AI processing encountered an issue.',
    suggestion: 'Please try again. The AI service may be temporarily unavailable.',
  },
  // Storage errors
  {
    patterns: [
      /storage/i,
      /s3/i,
      /bucket/i,
      /disk.*full/i,
      /quota.*exceeded/i,
    ],
    category: 'server',
    userMessage: 'Storage service error.',
    suggestion: 'Please try again later.',
  },
];

/**
 * Categorize an error message
 * 
 * @param errorMessage - The technical error message
 * @returns The error category
 */
export function categorizeError(errorMessage: string): ErrorCategory {
  if (!errorMessage) return 'unknown';

  for (const pattern of ERROR_PATTERNS) {
    for (const regex of pattern.patterns) {
      if (regex.test(errorMessage)) {
        return pattern.category;
      }
    }
  }

  return 'unknown';
}

/**
 * Translate a technical error message to user-friendly language
 * Requirements: 10.8-10.10
 * 
 * @param errorMessage - The technical error message
 * @returns User-friendly error message
 */
export function translateErrorMessage(errorMessage: string): string {
  if (!errorMessage) {
    return 'An unexpected error occurred. Please try again.';
  }

  // Find matching pattern
  for (const pattern of ERROR_PATTERNS) {
    for (const regex of pattern.patterns) {
      if (regex.test(errorMessage)) {
        return pattern.suggestion
          ? `${pattern.userMessage} ${pattern.suggestion}`
          : pattern.userMessage;
      }
    }
  }

  // If no pattern matches, return a cleaned version of the original message
  // Remove technical details like stack traces, file paths, etc.
  const cleanedMessage = errorMessage
    .replace(/at\s+\S+\s+\([^)]+\)/g, '') // Remove stack trace lines
    .replace(/\/[^\s]+/g, '') // Remove file paths
    .replace(/\{[^}]+\}/g, '') // Remove JSON objects
    .replace(/\[[^\]]+\]/g, '') // Remove arrays
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();

  // If the cleaned message is too short or empty, return generic message
  if (cleanedMessage.length < 10) {
    return 'An unexpected error occurred. Please try again.';
  }

  // Capitalize first letter and ensure it ends with a period
  const formattedMessage = cleanedMessage.charAt(0).toUpperCase() + cleanedMessage.slice(1);
  return formattedMessage.endsWith('.') ? formattedMessage : `${formattedMessage}.`;
}

/**
 * Get suggestion for an error category
 * 
 * @param category - The error category
 * @returns Suggestion text
 */
export function getErrorSuggestion(category: ErrorCategory): string {
  const suggestions: Record<ErrorCategory, string> = {
    network: 'Please check your internet connection and try again.',
    validation: 'Please check your input and try again.',
    timeout: 'Please try again. If the problem persists, the server may be busy.',
    server: 'Please try again later. Our team has been notified.',
    unknown: 'Please try again. If the problem persists, contact support.',
  };
  return suggestions[category];
}

/**
 * Get a user-friendly title for an error category
 * 
 * @param category - The error category
 * @returns Title text
 */
export function getErrorTitle(category: ErrorCategory): string {
  const titles: Record<ErrorCategory, string> = {
    network: 'Connection Error',
    validation: 'Invalid Input',
    timeout: 'Request Timeout',
    server: 'Server Error',
    unknown: 'Something Went Wrong',
  };
  return titles[category];
}

/**
 * Check if an error is retryable
 * 
 * @param category - The error category
 * @returns Whether the error is retryable
 */
export function isRetryableError(category: ErrorCategory): boolean {
  // Network, timeout, and server errors are typically retryable
  return ['network', 'timeout', 'server', 'unknown'].includes(category);
}

/**
 * Format error for display with all relevant information
 * 
 * @param errorMessage - The technical error message
 * @returns Formatted error object
 */
export function formatError(errorMessage: string): {
  category: ErrorCategory;
  title: string;
  message: string;
  suggestion: string;
  isRetryable: boolean;
} {
  const category = categorizeError(errorMessage);
  return {
    category,
    title: getErrorTitle(category),
    message: translateErrorMessage(errorMessage),
    suggestion: getErrorSuggestion(category),
    isRetryable: isRetryableError(category),
  };
}
