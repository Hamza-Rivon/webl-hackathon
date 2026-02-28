/**
 * Security Utilities
 *
 * Helper functions for input sanitization and security.
 */
/**
 * Sanitize user content by stripping HTML
 */
export declare function sanitizeUserContent(input: string): string;
/**
 * Escape special characters for JSON strings
 */
export declare function escapeForJson(input: string): string;
/**
 * Validate filename is safe (no path traversal)
 */
export declare function isSafeFilename(filename: string): boolean;
/**
 * Validate S3 key is safe
 */
export declare function isSafeS3Key(key: string): boolean;
//# sourceMappingURL=security.d.ts.map