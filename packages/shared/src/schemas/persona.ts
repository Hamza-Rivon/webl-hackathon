/**
 * Persona Validation Schemas
 */

import { z } from 'zod';
import { PlatformSchema } from './series.js';

// Valid niches
export const NicheSchema = z.enum([
  'fitness',
  'business',
  'lifestyle',
  'tech',
  'finance',
  'health',
  'education',
  'entertainment',
  'food',
  'travel',
  'beauty',
  'fashion',
  'gaming',
  'music',
  'art',
  'sports',
  'parenting',
  'relationships',
  'spirituality',
  'productivity',
  'other',
]);

// Valid tones
export const ToneSchema = z.enum([
  'aggressive',
  'calm',
  'educational',
  'motivational',
  'conversational',
  'humorous',
  'professional',
  'casual',
  'inspiring',
  'authoritative',
]);

// Create persona input
export const CreatePersonaSchema = z
  .object({
    niche: NicheSchema,
    subNiche: z.string().max(100).optional(),
    targetAudience: z
      .string()
      .min(1, 'Target audience is required')
      .max(200, 'Target audience description too long'),
    tone: ToneSchema,
    language: z.string().length(2).default('en'),
    platforms: z.array(PlatformSchema).min(1, 'Select at least one platform'),
    offer: z.string().max(500, 'Offer description too long').optional(),
    cta: z.string().max(200, 'CTA too long').optional(),
  })
  .strict();

// Update persona input
export const UpdatePersonaSchema = CreatePersonaSchema.partial();

// Onboarding step schemas
export const OnboardingNicheSchema = z
  .object({
    niche: NicheSchema,
    subNiche: z.string().max(100).optional(),
  })
  .strict();

export const OnboardingAudienceSchema = z
  .object({
    targetAudience: z.string().min(1).max(200),
  })
  .strict();

export const OnboardingToneSchema = z
  .object({
    tone: ToneSchema,
  })
  .strict();

export const OnboardingPlatformsSchema = z
  .object({
    platforms: z.array(PlatformSchema).min(1),
    language: z.string().length(2).default('en'),
  })
  .strict();

export const OnboardingOfferSchema = z
  .object({
    offer: z.string().max(500).optional(),
    cta: z.string().max(200).optional(),
  })
  .strict();
