/**
 * Clerk Configuration
 *
 * Token cache using expo-secure-store for secure credential storage.
 * Provides secure token persistence for Clerk authentication.
 */

import * as SecureStore from 'expo-secure-store';
import { TokenCache } from '@clerk/clerk-expo';

/**
 * Secure token cache implementation using expo-secure-store.
 * Encrypts tokens before storage for enhanced security.
 */
export const tokenCache: TokenCache = {
  async getToken(key: string) {
    try {
      const token = await SecureStore.getItemAsync(key);
      return token;
    } catch (err) {
      console.error('Failed to get token from secure store:', err);
      return null;
    }
  },
  async saveToken(key: string, value: string) {
    try {
      await SecureStore.setItemAsync(key, value);
    } catch (err) {
      console.error('Failed to save token to secure store:', err);
    }
  },
  async clearToken(key: string) {
    try {
      await SecureStore.deleteItemAsync(key);
    } catch (err) {
      console.error('Failed to clear token from secure store:', err);
    }
  },
};

/**
 * Clear all Clerk-related tokens from secure storage.
 * Used during sign-out to ensure complete session cleanup.
 */
export async function clearAllTokens(): Promise<void> {
  const keysToDelete = [
    '__clerk_client_jwt',
    '__clerk_session_jwt',
    '__clerk_session_id',
  ];

  await Promise.all(
    keysToDelete.map(async (key) => {
      try {
        await SecureStore.deleteItemAsync(key);
      } catch (err) {
        // Ignore errors for keys that don't exist
      }
    })
  );
}
