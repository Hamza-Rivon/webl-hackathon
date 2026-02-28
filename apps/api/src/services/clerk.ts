/**
 * Clerk Service
 *
 * Handles Clerk user operations and synchronization.
 */

import { createClerkClient } from '@clerk/express';
import { config } from '../config/index.js';
import { prisma } from '@webl/prisma';
import { logger } from '@webl/shared';

// Log clerk config status at startup (without exposing the key)
const secretKeyLength = config.clerk.secretKey?.length || 0;
logger.info(`Clerk service initializing with secret key length: ${secretKeyLength}`);

if (!config.clerk.secretKey || secretKeyLength < 20) {
  logger.error('CLERK_SECRET_KEY is missing or too short! Check your .env file.');
}

const clerk = createClerkClient({
  secretKey: config.clerk.secretKey,
});

export interface ClerkUserData {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  imageUrl: string | null;
}

export const clerkService = {
  /**
   * Get user data from Clerk
   */
  async getUser(userId: string): Promise<ClerkUserData | null> {
    try {
      const user = await clerk.users.getUser(userId);
      return {
        id: user.id,
        email: user.emailAddresses[0]?.emailAddress || '',
        firstName: user.firstName,
        lastName: user.lastName,
        imageUrl: user.imageUrl,
      };
    } catch (error: any) {
      logger.error('Failed to get Clerk user:', {
        userId,
        message: error?.message || 'Unknown error',
        status: error?.status,
        clerkError: error?.errors,
      });
      return null;
    }
  },

  /**
   * Sync user from Clerk to database
   */
  async syncUser(userId: string): Promise<void> {
    const clerkUser = await this.getUser(userId);
    if (!clerkUser) {
      throw new Error('User not found in Clerk');
    }

    await prisma.user.upsert({
      where: { id: userId },
      create: {
        id: clerkUser.id,
        email: clerkUser.email,
        firstName: clerkUser.firstName,
        lastName: clerkUser.lastName,
        imageUrl: clerkUser.imageUrl,
      },
      update: {
        email: clerkUser.email,
        firstName: clerkUser.firstName,
        lastName: clerkUser.lastName,
        imageUrl: clerkUser.imageUrl,
      },
    });

    logger.info(`User synced: ${userId}`);
  },

  /**
   * Update user metadata in Clerk
   */
  async updateUserMetadata(
    userId: string,
    publicMetadata: Record<string, unknown>
  ): Promise<void> {
    try {
      await clerk.users.updateUserMetadata(userId, { publicMetadata });
    } catch (error) {
      logger.error('Failed to update Clerk metadata:', error);
      throw error;
    }
  },

  /**
   * Mark user as onboarded in Clerk metadata
   */
  async markOnboarded(userId: string): Promise<void> {
    await this.updateUserMetadata(userId, { onboarded: true });
  },
};
