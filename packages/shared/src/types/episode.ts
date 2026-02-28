/**
 * Episode Types
 *
 * TypeScript interfaces for episode data structures.
 * These types align with the Prisma schema and WEBL-USER-JOURNEY-FINAL.md specification.
 */

import type { SlotClip } from './slot.js';

// ==================== EPISODE ENUMS ====================

export type EpisodeStatus =
  | 'draft'
  | 'voiceover_uploaded'
  | 'voiceover_cleaning'
  | 'voiceover_cleaned'
  | 'collecting_clips'
  | 'needs_more_clips'
  | 'chunking_clips'
  | 'enriching_chunks'
  | 'matching'
  | 'cut_plan_ready'
  | 'rendering'
  | 'ready'
  | 'published'
  | 'failed';

export type EpisodeMode = 'template_copy' | 'auto_edit';

// ==================== SCRIPT TYPES ====================

export interface ScriptBeat {
  index: number;
  beatType: string;
  text: string;
  duration: number;
  startTime: number;
  endTime: number;
  emphasisWords?: string[];
}

export interface VoiceoverTranscript {
  language: string;
  segments: TranscriptSegment[];
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  words?: TranscriptWord[];
}

export interface TranscriptWord {
  start: number;
  end: number;
  word: string;
}

// ==================== EPISODE TYPES ====================

export interface Episode {
  id: string;
  title: string;
  status: EpisodeStatus;

  // Template reference
  templateId: string | null;
  templateVersion: string | null;
  mode: EpisodeMode;

  // Script
  scriptContent: string | null;
  scriptBeats: ScriptBeat[] | null;

  // Media (S3 canonical)
  voiceoverS3Key: string | null;
  finalS3Key: string | null;

  // Mux references
  muxVoiceoverAssetId: string | null;
  muxClipAssetIds: string[];
  muxFinalAssetId: string | null;
  muxFinalPlaybackId: string | null;

  // Template compilation
  templateCompile: Record<string, unknown> | null;
  renderSpec: Record<string, unknown> | null;

  // Legacy fields (for migration)
  voiceoverPath: string | null;
  rawClipPaths: string[];
  proxyPaths: string[];
  finalVideoPath: string | null;
  thumbnailPath: string | null;
  editPlan: unknown | null;

  // Metadata
  duration: number | null;
  publishedAt: Date | null;

  createdAt: Date;
  updatedAt: Date;

  // Relations
  seriesId: string | null;
  userId: string;
}

export interface EpisodeWithSlots extends Episode {
  slotClips: SlotClip[];
}

export interface EpisodeWithTemplate extends Episode {
  template: {
    id: string;
    name: string;
    platform: string;
    durationTarget: number;
  } | null;
}

// ==================== CREATE/UPDATE TYPES ====================

export interface CreateEpisodeInput {
  title: string;
  seriesId?: string;
  templateId?: string;
  mode?: EpisodeMode;
}

export interface UpdateEpisodeInput {
  title?: string;
  scriptContent?: string;
  scriptBeats?: ScriptBeat[];
  status?: EpisodeStatus;
}

export interface RegenerateScriptInput {
  topic?: string;
  customPrompt?: string;
}

// ==================== RESPONSE TYPES ====================

export interface EpisodeDetailResponse extends Episode {
  muxPlaybackUrl?: string;
  downloadUrl?: string;
  template?: {
    id: string;
    name: string;
    platform: string;
    durationTarget: number;
  };
  complianceScore?: number;
  fidelityMessage?: string;
}

export interface EpisodeListItem {
  id: string;
  title: string;
  status: EpisodeStatus;
  duration: number | null;
  muxFinalPlaybackId: string | null;
  thumbnailUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
  templateName: string | null;
}
