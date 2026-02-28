/**
 * Template Validation Schemas
 *
 * Comprehensive Zod schemas for template validation including
 * script structure, editing recipes, and persona tags.
 */

import { z } from 'zod';

// ==================== BEAT SCHEMAS ====================

/**
 * Beat types for script structure
 */
export const BeatTypeSchema = z.enum([
  'hook',
  'setup',
  'tension',
  'resolution',
  'tip1',
  'tip2',
  'tip3',
  'myth',
  'truth',
  'proof',
  'before',
  'process',
  'after',
  'context',
  'argument',
  'challenge',
  'morning',
  'midday',
  'evening',
  'unbox',
  'features',
  'verdict',
  'skincare',
  'makeup',
  'outfit',
  'final',
  'step1',
  'step2',
  'step3',
  'result',
  'insight',
  'content',
  'cta',
]);

export type BeatType = z.infer<typeof BeatTypeSchema>;

/**
 * Template beat with visual and audio guidance
 */
export const TemplateBeatSchema = z.object({
  type: z.string().min(1).max(50),
  duration: z.number().positive().max(120),
  description: z.string().min(1).max(500),
  visualGuidance: z.string().max(500).optional(),
  audioGuidance: z.string().max(500).optional(),
});

export type TemplateBeat = z.infer<typeof TemplateBeatSchema>;

/**
 * Script structure containing beats and total duration
 */
export const TemplateStructureSchema = z.object({
  beats: z.array(TemplateBeatSchema).min(1).max(20),
  totalDuration: z.number().positive().max(300).optional(),
});

export type TemplateStructure = z.infer<typeof TemplateStructureSchema>;

// ==================== EDITING RECIPE SCHEMAS ====================

/**
 * Cut rhythm options
 */
export const CutRhythmSchema = z.enum(['fast', 'medium', 'slow', 'variable']);

/**
 * Caption style options
 */
export const CaptionStyleTypeSchema = z.enum(['animated', 'bold', 'minimal', 'none']);

/**
 * Music type options
 */
export const MusicTypeSchema = z.enum(['upbeat', 'cinematic', 'dramatic', 'ambient', 'none']);

/**
 * Caption animation options
 */
export const CaptionAnimationSchema = z.enum([
  'none',
  'fade',
  'pop',
  'slam',
  'slide-up',
  'word-by-word',
  'karaoke',
]);

/**
 * Caption position options
 */
export const CaptionPositionSchema = z.enum(['top', 'center', 'bottom']);

/**
 * Temperature options for color grading
 */
export const TemperatureSchema = z.enum(['warm', 'neutral', 'cool']);

/**
 * Transition rules for editing
 */
export const TransitionRulesSchema = z.record(z.string(), z.string()).default({ default: 'cut' });

/**
 * Caption style configuration
 */
export const CaptionStyleSchema = z.object({
  type: CaptionStyleTypeSchema,
  position: CaptionPositionSchema.default('bottom'),
  font: z.string().max(50).default('bold-sans'),
  size: z.enum(['small', 'medium', 'large']).default('medium'),
  animation: CaptionAnimationSchema.default('fade'),
  highlightKeywords: z.boolean().default(false),
  backgroundColor: z.string().max(50).default('semi-transparent'),
  color: z.string().max(50).optional(),
});

export type CaptionStyle = z.infer<typeof CaptionStyleSchema>;

/**
 * Music guidance configuration
 */
export const MusicGuidanceSchema = z.object({
  type: MusicTypeSchema,
  bpm: z.string().max(20).optional(),
  mood: z.string().max(100).optional(),
  fadeIn: z.boolean().default(false),
  fadeInDuration: z.number().positive().max(10).optional(),
  fadeOut: z.boolean().default(true),
  fadeOutDuration: z.number().positive().max(10).optional(),
  duckOnVoice: z.boolean().default(true),
  volume: z.number().min(0).max(1).default(0.7),
});

export type MusicGuidance = z.infer<typeof MusicGuidanceSchema>;

/**
 * Color grading configuration
 */
export const ColorGradingSchema = z.object({
  contrast: z.number().min(0.5).max(2).default(1.0),
  saturation: z.number().min(0).max(2).default(1.0),
  temperature: TemperatureSchema.default('neutral'),
});

export type ColorGrading = z.infer<typeof ColorGradingSchema>;

/**
 * Editing rules configuration
 */
export const EditingRulesSchema = z.object({
  cutRhythm: CutRhythmSchema,
  avgCutLength: z.number().positive().max(30).optional(),
  transitions: TransitionRulesSchema,
  textOverlays: z
    .object({
      stepNumbers: z.boolean().optional(),
      position: z.string().optional(),
    })
    .optional(),
});

export type EditingRules = z.infer<typeof EditingRulesSchema>;

/**
 * Complete editing recipe schema
 */
export const EditingRecipeSchema = z.object({
  cutRhythm: CutRhythmSchema,
  captionStyle: z.union([CaptionStyleTypeSchema, CaptionStyleSchema]),
  musicType: MusicTypeSchema,
  transitions: z.union([z.array(z.string()), TransitionRulesSchema]),
  musicGuidance: MusicGuidanceSchema.optional(),
  colorGrading: ColorGradingSchema.optional(),
});

export type EditingRecipe = z.infer<typeof EditingRecipeSchema>;

/**
 * Full editing recipe file schema (for JSON files)
 */
export const EditingRecipeFileSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  version: z.string().regex(/^\d+\.\d+\.\d+$/).default('1.0.0'),
  totalDuration: z.number().positive().max(300),
  aspectRatio: z.string().default('9:16'),
  resolution: z.string().default('1080p'),
  fps: z.number().positive().max(120).default(30),
  beats: z.array(TemplateBeatSchema).min(1).max(20),
  editingRules: EditingRulesSchema,
  captionStyle: CaptionStyleSchema,
  musicGuidance: MusicGuidanceSchema,
  colorGrading: ColorGradingSchema.optional(),
});

export type EditingRecipeFile = z.infer<typeof EditingRecipeFileSchema>;

// ==================== PERSONA TAG SCHEMAS ====================

/**
 * Valid niche categories
 */
export const NicheSchema = z.enum([
  'general',
  'fitness',
  'business',
  'lifestyle',
  'beauty',
  'tech',
  'education',
  'food',
  'travel',
  'finance',
  'health',
  'entertainment',
]);

export type Niche = z.infer<typeof NicheSchema>;

/**
 * Valid tone options
 */
export const ToneSchema = z.enum([
  'aggressive',
  'calm',
  'educational',
  'motivational',
  'humorous',
  'professional',
  'casual',
  'conversational',
]);

export type Tone = z.infer<typeof ToneSchema>;

/**
 * Platform options
 */
export const PlatformSchema = z.enum(['tiktok', 'reels', 'shorts', 'all']);

export type Platform = z.infer<typeof PlatformSchema>;

export const RenderEngineSchema = z.enum(['ffmpeg_microcut_v2']);

export type RenderEngine = z.infer<typeof RenderEngineSchema>;

// ==================== TEMPLATE SCHEMAS ====================

/**
 * Template data from JSON file (before database import)
 */
export const TemplateDataSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  description: z.string().min(1).max(1000),
  platform: PlatformSchema,
  language: z.string().min(2).max(10).default('en'),
  durationTarget: z.number().positive().max(300),
  renderEngine: RenderEngineSchema.default('ffmpeg_microcut_v2'),
  editingRecipe: z.string().min(1).max(200), // Reference to recipe file
  personaTags: z.array(z.string().max(50)).default([]),
  niche: z.string().max(100),
  tone: z.string().max(50),
  viewCount: z.number().nonnegative().default(0),
  retentionRate: z.number().min(0).max(1).optional(),
  saveRate: z.number().min(0).max(1).optional(),
});

export type TemplateData = z.infer<typeof TemplateDataSchema>;

/**
 * Templates JSON file schema
 */
export const TemplatesFileSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/).default('1.0.0'),
  templates: z.array(TemplateDataSchema).min(1),
});

export type TemplatesFile = z.infer<typeof TemplatesFileSchema>;

/**
 * Create template input schema (for API)
 */
export const CreateTemplateSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  platform: PlatformSchema,
  language: z.string().min(2).max(10).default('en'),
  durationTarget: z.number().positive().max(300),
  renderEngine: RenderEngineSchema.default('ffmpeg_microcut_v2'),
  canonicalScript: z.string().min(1).max(10000),
  scriptStructure: TemplateStructureSchema,
  editingRecipe: EditingRecipeSchema,
  personaTags: z.array(z.string().max(50)).default([]),
  niche: z.string().max(100).optional(),
  tone: z.string().max(50).optional(),
});

export type CreateTemplateInput = z.infer<typeof CreateTemplateSchema>;

/**
 * Full template schema (database model)
 */
export const TemplateSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(200),
  description: z.string().max(1000).nullable(),
  platform: PlatformSchema,
  language: z.string().min(2).max(10),
  durationTarget: z.number().positive().max(300),
  renderEngine: RenderEngineSchema,
  canonicalScript: z.string().min(1).max(10000),
  scriptStructure: TemplateStructureSchema,
  editingRecipe: EditingRecipeSchema,
  personaTags: z.array(z.string().max(50)),
  niche: z.string().max(100).nullable(),
  tone: z.string().max(50).nullable(),
  viewCount: z.number().nonnegative(),
  retentionRate: z.number().min(0).max(1).nullable(),
  saveRate: z.number().min(0).max(1).nullable(),
  embeddingId: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type Template = z.infer<typeof TemplateSchema>;

// ==================== VALIDATION HELPERS ====================

/**
 * Validate template data from JSON
 */
export function validateTemplateData(data: unknown): TemplateData {
  return TemplateDataSchema.parse(data);
}

/**
 * Validate templates file
 */
export function validateTemplatesFile(data: unknown): TemplatesFile {
  return TemplatesFileSchema.parse(data);
}

/**
 * Validate editing recipe file
 */
export function validateEditingRecipeFile(data: unknown): EditingRecipeFile {
  return EditingRecipeFileSchema.parse(data);
}

/**
 * Safe validation with error details
 */
export function safeValidateTemplateData(data: unknown): {
  success: boolean;
  data?: TemplateData;
  errors?: z.ZodError;
} {
  const result = TemplateDataSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, errors: result.error };
}

/**
 * Safe validation for editing recipe file
 */
export function safeValidateEditingRecipeFile(data: unknown): {
  success: boolean;
  data?: EditingRecipeFile;
  errors?: z.ZodError;
} {
  const result = EditingRecipeFileSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, errors: result.error };
}
