/**
 * WEBL Shared Package
 *
 * Common utilities, types, and services shared across apps.
 */

// Constants
export * from './constants/index.js';

// Types (explicit imports to avoid conflicts with schema types)
export type {
  TemplateBeat,
  TemplateStructure,
  EditingRecipe,
  Template,
  RenderEngine,
} from './types/template.js';

export type { EpisodeStatus, ScriptBeat, Episode } from './types/episode.js';

export type {
  Cadence,
  Platform,
  PersonaOverrides,
  Series,
  SeriesWithEpisodeCount,
  SeriesWithTemplate,
} from './types/series.js';

export type {
  Niche,
  Tone,
  Persona,
  PersonaProfile,
  OnboardingProgress,
} from './types/persona.js';

// Schemas (Zod validators)
export * from './schemas/index.js';

// Prompts
export * from './prompts/voiceover.js';
export * from './prompts/scriptArchetypes.js';

// Services
export { logger } from './services/logger.js';
export * from './services/s3.js';
export {
  evaluateUsageLimits,
  type UsageLimitStatus,
  type UsageLimitEntry,
  type UsageGuardUser,
  type UsageGuardUsage,
} from './services/usageGuard.js';

// Utils
export * from './utils/index.js';
