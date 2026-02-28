/**
 * Episode Validation Schemas
 */

import { z } from 'zod';

export const CreateEpisodeSchema = z
  .object({
    title: z
      .string()
      .min(1, 'Title required')
      .max(200, 'Title too long')
      .regex(/^[a-zA-Z0-9\s\-_.,!?'"]+$/, 'Invalid characters'),
    seriesId: z.string().cuid('Invalid series ID').optional(),
    templateId: z.string().cuid('Invalid template ID').optional(),
    scriptContent: z.string().max(10000, 'Script too long').optional(),
  })
  .strict();

export const UpdateEpisodeSchema = CreateEpisodeSchema.partial().extend({
  captionsEnabled: z.boolean().optional(),
});

export const EpisodeStatusSchema = z.enum([
  'draft',
  'voiceover_uploaded',
  'voiceover_cleaning',
  'voiceover_cleaned',
  'collecting_clips',
  'needs_more_clips',
  'chunking_clips',
  'enriching_chunks',
  'matching',
  'cut_plan_ready',
  'rendering',
  'ready',
  'published',
  'failed',
]);

export type CreateEpisodeInput = z.infer<typeof CreateEpisodeSchema>;
export type UpdateEpisodeInput = z.infer<typeof UpdateEpisodeSchema>;
