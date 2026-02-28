/**
 * Encryption Service
 *
 * Provides encryption/decryption utilities for sensitive user data like API keys.
 * Uses AES-256-GCM for authenticated encryption.
 */

import crypto from 'crypto';
import { logger } from '@webl/shared';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // 16 bytes for AES
const SALT_LENGTH = 64; // 64 bytes for salt
const TAG_LENGTH = 16; // 16 bytes for GCM auth tag
const KEY_LENGTH = 32; // 32 bytes for AES-256

/**
 * Get encryption key from environment variable
 * Falls back to a default key in development (not secure for production)
 */
function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  
  if (!key) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('ENCRYPTION_KEY environment variable is required in production');
    }
    // Development fallback - warn but allow
    logger.warn('ENCRYPTION_KEY not set, using default key (NOT SECURE FOR PRODUCTION)');
    return crypto.scryptSync('default-dev-key-change-in-production', 'salt', KEY_LENGTH);
  }
  
  // If key is provided as hex string, convert it
  if (key.length === KEY_LENGTH * 2) {
    return Buffer.from(key, 'hex');
  }
  
  // Otherwise, derive key from the provided string
  return crypto.scryptSync(key, 'salt', KEY_LENGTH);
}

/**
 * Encrypt a plaintext string
 * Returns a hex-encoded string containing: salt + iv + tag + encrypted data
 */
export function encrypt(plaintext: string): string {
  if (!plaintext) {
    return '';
  }

  try {
    const key = getEncryptionKey();
    const salt = crypto.randomBytes(SALT_LENGTH);
    const iv = crypto.randomBytes(IV_LENGTH);
    
    // Derive a key from the master key and salt
    const derivedKey = crypto.scryptSync(key, salt, KEY_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, derivedKey, iv);
    
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const tag = cipher.getAuthTag();
    
    // Combine: salt (64 bytes) + iv (16 bytes) + tag (16 bytes) + encrypted data
    const combined = Buffer.concat([
      salt,
      iv,
      tag,
      Buffer.from(encrypted, 'hex'),
    ]);
    
    return combined.toString('hex');
  } catch (error) {
    logger.error('Encryption failed:', error);
    throw new Error('Failed to encrypt data');
  }
}

/**
 * Decrypt an encrypted hex string
 * Expects format: salt + iv + tag + encrypted data
 */
export function decrypt(encryptedHex: string): string {
  if (!encryptedHex) {
    return '';
  }

  try {
    const key = getEncryptionKey();
    const combined = Buffer.from(encryptedHex, 'hex');
    
    // Extract components
    const salt = combined.subarray(0, SALT_LENGTH);
    const iv = combined.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
    const tag = combined.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + TAG_LENGTH);
    const encrypted = combined.subarray(SALT_LENGTH + IV_LENGTH + TAG_LENGTH);
    
    // Derive the same key from master key and salt
    const derivedKey = crypto.scryptSync(key, salt, KEY_LENGTH);
    const decipher = crypto.createDecipheriv(ALGORITHM, derivedKey, iv);
    decipher.setAuthTag(tag);
    
    let decrypted = decipher.update(encrypted, undefined, 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    logger.error('Decryption failed:', error);
    throw new Error('Failed to decrypt data - invalid or corrupted encrypted data');
  }
}
