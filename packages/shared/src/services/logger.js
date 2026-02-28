/**
 * Logger Service
 *
 * Simple structured logger for consistent log formatting.
 */
const LOG_LEVELS = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
};
const currentLevel = process.env.LOG_LEVEL || 'info';
function shouldLog(level) {
    return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}
function formatMessage(level, message, data) {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
    if (data) {
        return `${prefix} ${message} ${JSON.stringify(data)}`;
    }
    return `${prefix} ${message}`;
}
export const logger = {
    debug(message, data) {
        if (shouldLog('debug')) {
            console.debug(formatMessage('debug', message, data));
        }
    },
    info(message, data) {
        if (shouldLog('info')) {
            console.info(formatMessage('info', message, data));
        }
    },
    warn(message, data) {
        if (shouldLog('warn')) {
            console.warn(formatMessage('warn', message, data));
        }
    },
    error(message, data) {
        if (shouldLog('error')) {
            console.error(formatMessage('error', message, data));
        }
    },
};
//# sourceMappingURL=logger.js.map