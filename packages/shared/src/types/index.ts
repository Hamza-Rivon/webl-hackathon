/**
 * Type Exports
 *
 * Central export file for all shared types.
 * Organized by domain: Template, Episode, Series, Persona, Slot
 */

// Template types (primary source for Platform, Niche, Tone, SlotType, SlotSource types)
export * from './template.js';

// Slot types (exclude SlotType, SlotSource - already exported from template)
export type {
  VideoOrientation,
  ModerationStatus,
  SelectedSegment,
  SlotClip,
  CreateSlotClipInput,
  UpdateSlotClipInput,
  SlotValidationResult,
  SlotValidationIssue,
  SlotProgress,
  SlotClipSummary,
  EpisodeSlotProgress,
} from './slot.js';

// Episode types
export * from './episode.js';

// Series types (exclude Platform - already exported from template)
export type {
  Cadence,
  PersonaOverrides,
  Series,
  SeriesWithEpisodeCount,
  SeriesWithTemplate,
} from './series.js';

// Persona types (exclude Niche, Tone - already exported from template)
export type { Persona, PersonaProfile, OnboardingProgress } from './persona.js';
