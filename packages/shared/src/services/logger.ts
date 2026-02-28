/**
 * Logger Service
 *
 * Simple structured logger for consistent log formatting.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

/**
 * Serialize data for logging, properly handling Error objects
 * 
 * Error objects have non-enumerable properties (message, stack, name)
 * that JSON.stringify ignores, resulting in `{}`. This function
 * extracts those properties explicitly.
 */
function serializeForLog(data: unknown): string {
  if (data instanceof Error) {
    const errorObj: Record<string, unknown> = {
      message: data.message,
      name: data.name,
      stack: data.stack,
    };
    // Include any custom properties on the error
    // Object.keys works on Error objects for enumerable custom props
    const errorAsAny = data as unknown as Record<string, unknown>;
    for (const key of Object.keys(data)) {
      errorObj[key] = errorAsAny[key];
    }
    return JSON.stringify(errorObj);
  }
  
  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
}

function formatMessage(level: LogLevel, message: string, data?: unknown): string {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level.toUpperCase()}]`;

  if (data !== undefined) {
    return `${prefix} ${message} ${serializeForLog(data)}`;
  }
  return `${prefix} ${message}`;
}

export const logger = {
  debug(message: string, data?: unknown): void {
    if (shouldLog('debug')) {
      console.debug(formatMessage('debug', message, data));
    }
  },

  info(message: string, data?: unknown): void {
    if (shouldLog('info')) {
      console.info(formatMessage('info', message, data));
    }
  },

  warn(message: string, data?: unknown): void {
    if (shouldLog('warn')) {
      console.warn(formatMessage('warn', message, data));
    }
  },

  error(message: string, data?: unknown): void {
    if (shouldLog('error')) {
      console.error(formatMessage('error', message, data));
    }
  },
};
