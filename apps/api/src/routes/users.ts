/**
 * User Routes
 *
 * User profile and account management endpoints.
 */

import { Router, Request, Response } from 'express';
import { getUserId } from '../middleware/clerk.js';
import { prisma } from '@webl/prisma';
import { clerkService } from '../services/clerk.js';
import { usageService } from '../services/usage.js';
import { encrypt } from '../services/encryption.js';
import { logger, evaluateUsageLimits } from '@webl/shared';

export const usersRouter = Router();

/**
 * Helper to get or create user from Clerk data
 */
async function getOrCreateUser(userId: string) {
  // Try to find existing user
  let user = await prisma.user.findUnique({
    where: { id: userId },
    include: { personaData: true, usage: true },
  });

  if (!user) {
    // Sync user from Clerk to DB
    logger.info(`User ${userId} not found in DB, syncing from Clerk...`);
    await clerkService.syncUser(userId);
    user = await prisma.user.findUnique({
      where: { id: userId },
      include: { personaData: true, usage: true },
    });
    logger.info(`User ${userId} synced successfully`);
  }

  // Transform to match mobile app expectations
  if (user) {
    return {
      ...user,
      isOnboarded: user.onboarded, // Mobile app expects isOnboarded
    };
  }

  return user;
}

/**
 * GET /api/users/me - Get current user profile
 *
 * Includes computed usageLimits alongside raw usage data for the frontend.
 */
usersRouter.get('/me', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const user = await getOrCreateUser(userId);

    if (user) {
      // Compute usage limits from the user and usage records
      const usageLimits = evaluateUsageLimits(
        {
          subscriptionActive: (user as any).subscriptionActive ?? true,
          subscriptionTier: (user as any).subscriptionTier ?? 'free',
        },
        user.usage
          ? {
              totalExternalApiCalls: (user.usage as any).totalExternalApiCalls ?? 0,
              totalLlmCalls: (user.usage as any).totalLlmCalls ?? 0,
              totalEmbeddingCalls: (user.usage as any).totalEmbeddingCalls ?? 0,
              totalEpisodesCreated: (user.usage as any).totalEpisodesCreated ?? 0,
              totalRendersCompleted: (user.usage as any).totalRendersCompleted ?? 0,
              totalEstimatedCostUSD: (user.usage as any).totalEstimatedCostUSD ?? 0,
              maxTotalExternalApiCalls: (user.usage as any).maxTotalExternalApiCalls ?? 500,
              maxTotalLlmCalls: (user.usage as any).maxTotalLlmCalls ?? 200,
              maxTotalEmbeddingCalls: (user.usage as any).maxTotalEmbeddingCalls ?? 300,
              maxTotalEpisodesCreated: (user.usage as any).maxTotalEpisodesCreated ?? 50,
              maxTotalRendersCompleted: (user.usage as any).maxTotalRendersCompleted ?? 20,
              maxEstimatedCostUSD: (user.usage as any).maxEstimatedCostUSD ?? 10.0,
            }
          : null
      );

      res.json({ ...user, usageLimits });
    } else {
      res.json(user);
    }
  } catch (error) {
    logger.error('Failed to get user profile:', error);
    res.status(500).json({ error: 'Failed to get user profile' });
  }
});

/**
 * GET /api/users/profile - Alias for /me (used by mobile app)
 */
usersRouter.get('/profile', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const user = await getOrCreateUser(userId);
    res.json(user);
  } catch (error) {
    logger.error('Failed to get user profile:', error);
    res.status(500).json({ error: 'Failed to get user profile' });
  }
});

/**
 * PUT /api/users/me - Update current user profile
 */
usersRouter.put('/me', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { firstName, lastName } = req.body;

  const user = await prisma.user.update({
    where: { id: userId },
    data: { firstName, lastName },
  });

  res.json(user);
});

// Note: Persona validation is done manually in the route handler
// to accommodate flexible mobile app data formats

/**
 * POST /api/users/persona - Save user persona data
 */
usersRouter.post(
  '/persona',
  async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    try {
      const personaData = req.body;
      
      logger.info(`Saving persona for user ${userId}:`, JSON.stringify(personaData));
      
      // Validate required fields
      if (!personaData.niche || !personaData.tone || !personaData.platforms?.length) {
        res.status(400).json({ 
          error: 'Missing required fields: niche, tone, and at least one platform are required' 
        });
        return;
      }
      
      // Build target audience from available fields
      const targetAudience = personaData.targetAudience 
        || personaData.audienceAge 
        || 'General audience';

      // Map mobile app fields to Prisma Persona schema
      const prismaData = {
        niche: String(personaData.niche),
        subNiche: personaData.subNiche ? String(personaData.subNiche) : null,
        targetAudience: String(targetAudience),
        tone: String(personaData.tone),
        language: personaData.language ? String(personaData.language) : 'en',
        platforms: personaData.platforms as ('tiktok' | 'reels' | 'shorts' | 'all')[],
        offer: personaData.offer ? String(personaData.offer) : null,
        cta: personaData.cta ? String(personaData.cta) : null,
      };

      logger.info(`Prisma data for persona:`, JSON.stringify(prismaData));

      await prisma.persona.upsert({
        where: { userId },
        create: {
          userId,
          ...prismaData,
        },
        update: prismaData,
      });

      logger.info(`Persona saved for user ${userId}`);
      res.json({ success: true });
    } catch (error: any) {
      logger.error('Failed to save persona:', { 
        message: error.message, 
        code: error.code,
        meta: error.meta,
        name: error.name 
      });
      res.status(500).json({ error: 'Failed to save persona', details: error.message });
    }
  }
);

/**
 * POST /api/users/complete-onboarding - Mark onboarding as complete
 */
usersRouter.post('/complete-onboarding', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    await prisma.user.update({
      where: { id: userId },
      data: { onboarded: true },
    });

    logger.info(`Onboarding completed for user ${userId}`);
    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to complete onboarding:', error);
    res.status(500).json({ error: 'Failed to complete onboarding' });
  }
});

/**
 * Validate ElevenLabs API key format and optionally test it
 * Uses /v1/user instead of TTS so validation does not depend on a specific voice ID/plan.
 */
async function validateElevenLabsApiKey(
  apiKey: string,
  usageUserId?: string
): Promise<{ valid: boolean; error?: string }> {
  // First, validate the format
  if (!apiKey || typeof apiKey !== 'string') {
    return { valid: false, error: 'Invalid API key format' };
  }

  const trimmedKey = apiKey.trim();
  
  // ElevenLabs API keys typically start with specific prefixes
  // Format validation: should be a non-empty string, typically starts with alphanumeric
  if (trimmedKey.length < 20) {
    return { valid: false, error: 'API key appears to be too short. Please check your key.' };
  }

  // Optional: Validate with API (non-blocking unless key is clearly invalid).
  try {
    const response = await fetch('https://api.elevenlabs.io/v1/user', {
      method: 'GET',
      headers: {
        'xi-api-key': trimmedKey,
      },
    });

    if (usageUserId) {
      await usageService.recordUsage(usageUserId, {
        elevenLabsValidationCalls: 1,
        elevenLabsCharacters: 0,
      });
    }

    // 200 means key works.
    if (response.ok) {
      await response.text().catch(() => {});
      return { valid: true };
    }

    // 401 = invalid key
    if (response.status === 401) {
      await response.text().catch(() => {}); // Consume response
      return { 
        valid: false, 
        error: 'Invalid API key. Please check your key and try again.' 
      };
    }

    // 403/429 => key can still be valid.
    if (response.status === 403 || response.status === 429) {
      logger.info(`API key validation: Key format valid but got ${response.status} - will allow save`);
      return { valid: true };
    }

    // Other errors - log but allow (might be temporary/provider-side).
    const errorText = await response.text().catch(() => 'Unknown error');
    logger.warn(`ElevenLabs API key validation: ${response.status} - ${errorText}`);

    if (response.status === 400) {
      return { 
        valid: false, 
        error: 'Invalid API key format or configuration. Please check your key.' 
      };
    }

    return { valid: true };
  } catch (error) {
    if (usageUserId) {
      await usageService.recordUsage(usageUserId, {
        elevenLabsValidationCalls: 1,
        elevenLabsCharacters: 0,
      });
    }

    logger.warn('Failed to validate ElevenLabs API key (network error), allowing save:', error);
    return { valid: true };
  }
}

/**
 * PUT /api/users/elevenlabs-voice-id - Update user's ElevenLabs voice ID
 */
usersRouter.put('/elevenlabs-voice-id', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const { voiceId } = req.body;

    // Validate voice ID format (should be a non-empty string if provided)
    if (voiceId !== undefined && voiceId !== null && voiceId !== '' && typeof voiceId !== 'string') {
      res.status(400).json({ error: 'Invalid voice ID format' });
      return;
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: { 
        elevenLabsVoiceId: voiceId && voiceId.trim() ? voiceId.trim() : null,
      },
    });

    logger.info(`Updated ElevenLabs voice ID for user ${userId}`);
    res.json({ 
      success: true, 
      elevenLabsVoiceId: user.elevenLabsVoiceId,
    });
  } catch (error) {
    logger.error('Failed to update ElevenLabs voice ID:', error);
    res.status(500).json({ error: 'Failed to update ElevenLabs voice ID' });
  }
});

/**
 * PUT /api/users/elevenlabs-api-key - Update user's ElevenLabs API key
 */
usersRouter.put('/elevenlabs-api-key', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const { apiKey } = req.body;

    // Validate API key format
    if (apiKey !== undefined && apiKey !== null && apiKey !== '') {
      if (typeof apiKey !== 'string' || apiKey.trim().length === 0) {
        res.status(400).json({ error: 'Invalid API key format' });
        return;
      }

      const trimmedApiKey = apiKey.trim();
      
      // Basic format validation
      if (trimmedApiKey.length < 20) {
        res.status(400).json({ 
          error: 'API key appears to be too short. Please check your key.' 
        });
        return;
      }

      // Optional: Try to validate with API (non-blocking)
      // Only reject if it's clearly an invalid key (401), not permission issues
      try {
        const validation = await validateElevenLabsApiKey(trimmedApiKey, userId);
        if (!validation.valid && validation.error?.includes('Invalid API key')) {
          // Only reject if it's clearly an invalid key (401)
          res.status(400).json({ 
            error: validation.error || 'Invalid ElevenLabs API key. Please check your key and try again.' 
          });
          return;
        }
        // For permission errors or other issues, allow save
        logger.info(`API key validation: ${validation.valid ? 'valid' : validation.error || 'unknown'}`);
      } catch (validationError) {
        logger.warn('API key validation error (allowing save):', validationError);
        // Allow save - validation errors shouldn't block users
      }

      // Encrypt and store the API key
      const encryptedApiKey = encrypt(apiKey.trim());
      
      await prisma.user.update({
        where: { id: userId },
        data: { 
          elevenLabsApiKey: encryptedApiKey,
        } as any, // Type assertion needed until Prisma client is regenerated
      });

      logger.info(`Updated ElevenLabs API key for user ${userId}`);
      res.json({ 
        success: true,
        message: 'API key updated successfully',
      });
    } else {
      // Clear the API key
      await prisma.user.update({
        where: { id: userId },
        data: { 
          elevenLabsApiKey: null,
        } as any, // Type assertion needed until Prisma client is regenerated
      });

      logger.info(`Cleared ElevenLabs API key for user ${userId}`);
      res.json({ 
        success: true,
        message: 'API key cleared successfully',
      });
    }
  } catch (error) {
    logger.error('Failed to update ElevenLabs API key:', error);
    res.status(500).json({ error: 'Failed to update ElevenLabs API key' });
  }
});

/**
 * PUT /api/users/elevenlabs-settings - Update both voice ID and API key at once
 */
usersRouter.put('/elevenlabs-settings', async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const { voiceId, apiKey } = req.body;

    // Validate voice ID format
    if (voiceId !== undefined && voiceId !== null && voiceId !== '' && typeof voiceId !== 'string') {
      res.status(400).json({ error: 'Invalid voice ID format' });
      return;
    }

    // Validate and encrypt API key if provided
    let encryptedApiKey: string | null = null;
    if (apiKey !== undefined && apiKey !== null && apiKey !== '') {
      if (typeof apiKey !== 'string' || apiKey.trim().length === 0) {
        res.status(400).json({ error: 'Invalid API key format' });
        return;
      }

      const trimmedApiKey = apiKey.trim();
      
      // Basic format validation
      if (trimmedApiKey.length < 20) {
        res.status(400).json({ 
          error: 'API key appears to be too short. Please check your key.' 
        });
        return;
      }

      // Optional: Try to validate with API (non-blocking)
      // If validation fails due to permissions, we still allow save
      try {
        const validation = await validateElevenLabsApiKey(trimmedApiKey, userId);
        if (!validation.valid) {
          // Only reject if it's clearly an invalid key (401), not permission issues
          logger.warn(`API key validation result: ${validation.error}`);
          // Allow save anyway - errors will surface during actual use
          // This is more user-friendly than blocking them
        }
      } catch (validationError) {
        logger.warn('API key validation error (allowing save):', validationError);
        // Allow save - validation errors shouldn't block users
      }

      // Encrypt and save the key
      encryptedApiKey = encrypt(trimmedApiKey);
    }

    // Update both fields
    const updateData: any = {
      elevenLabsVoiceId: voiceId && voiceId.trim() ? voiceId.trim() : null,
    };
    
    // Only update API key if it was provided
    if (encryptedApiKey !== undefined) {
      updateData.elevenLabsApiKey = encryptedApiKey;
    }
    
    const user = await prisma.user.update({
      where: { id: userId },
      data: updateData,
    });

    logger.info(`Updated ElevenLabs settings for user ${userId}`);
    res.json({ 
      success: true,
      elevenLabsVoiceId: user.elevenLabsVoiceId,
      message: 'Settings updated successfully',
    });
  } catch (error) {
    logger.error('Failed to update ElevenLabs settings:', error);
    res.status(500).json({ error: 'Failed to update ElevenLabs settings' });
  }
});
