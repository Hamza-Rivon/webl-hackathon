/**
 * Zod Schema Exports
 */

// Template schemas (primary source for Platform, Niche, Tone schemas)
export * from './template.js';

// Episode schemas
export * from './episode.js';
export * from './voiceover.js';

// Series schemas (exclude PlatformSchema - already exported from template)
export {
  CadenceSchema,
  PersonaOverridesSchema,
  CreateSeriesSchema,
  UpdateSeriesSchema,
  SeriesQuerySchema,
} from './series.js';

// Persona schemas (exclude NicheSchema, ToneSchema - already exported from template)
export {
  CreatePersonaSchema,
  UpdatePersonaSchema,
  OnboardingNicheSchema,
  OnboardingAudienceSchema,
  OnboardingToneSchema,
  OnboardingPlatformsSchema,
  OnboardingOfferSchema,
} from './persona.js';
