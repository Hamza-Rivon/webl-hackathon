/**
 * Series Validation Schemas
 */

import { z } from 'zod';

// Cadence enum
export const CadenceSchema = z.enum(['daily', 'weekly', 'biweekly', 'monthly']);

// Platform enum (shared with templates)
export const PlatformSchema = z.enum(['tiktok', 'reels', 'shorts', 'all']);

// Persona overrides for series-specific customization
export const PersonaOverridesSchema = z
  .object({
    tone: z.string().max(50).optional(),
    targetAudience: z.string().max(200).optional(),
    cta: z.string().max(500).optional(),
  })
  .strict();

// Create series input
export const CreateSeriesSchema = z
  .object({
    name: z
      .string()
      .min(1, 'Series name is required')
      .max(200, 'Series name too long')
      .regex(/^[a-zA-Z0-9\s\-_.,!?'"]+$/, 'Invalid characters in name'),
    description: z.string().max(1000, 'Description too long').optional(),
    cadence: CadenceSchema.default('weekly'),
    templateId: z.string().cuid('Invalid template ID').optional(),
    personaOverrides: PersonaOverridesSchema.optional(),
  })
  .strict();

// Update series input
export const UpdateSeriesSchema = CreateSeriesSchema.partial();

// Series query filters
export const SeriesQuerySchema = z
  .object({
    page: z.coerce.number().positive().default(1),
    limit: z.coerce.number().positive().max(100).default(20),
    cadence: CadenceSchema.optional(),
    search: z.string().max(100).optional(),
  })
  .strict();
