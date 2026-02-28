/**
 * Security Utilities
 *
 * Helper functions for input sanitization and security.
 */
/**
 * Sanitize user content by stripping HTML
 */
export function sanitizeUserContent(input) {
    // Remove all HTML tags
    return input
        .replace(/<[^>]*>/g, '')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#x27;/g, "'");
}
/**
 * Escape special characters for JSON strings
 */
export function escapeForJson(input) {
    return input
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/\t/g, '\\t');
}
/**
 * Validate filename is safe (no path traversal)
 */
export function isSafeFilename(filename) {
    // Must not contain path separators or ..
    if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
        return false;
    }
    // Must match safe pattern
    const safePattern = /^[a-zA-Z0-9_\-]+\.[a-zA-Z0-9]+$/;
    return safePattern.test(filename);
}
/**
 * Validate S3 key is safe
 */
export function isSafeS3Key(key) {
    // Must not contain ..
    if (key.includes('..')) {
        return false;
    }
    // Must start with users/ or templates/ or assets/
    const validPrefixes = ['users/', 'templates/', 'assets/'];
    return validPrefixes.some((prefix) => key.startsWith(prefix));
}
//# sourceMappingURL=security.js.map