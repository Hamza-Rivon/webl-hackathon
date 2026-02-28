/**
 * Slot Clip Types
 *
 * TypeScript interfaces for slot-based capture data structures.
 * These types align with the Prisma schema and WEBL-USER-JOURNEY-FINAL.md specification.
 */

// ==================== SLOT ENUMS ====================

export type SlotType =
  | 'a_roll_face'
  | 'b_roll_illustration'
  | 'b_roll_action'
  | 'screen_record'
  | 'product_shot'
  | 'pattern_interrupt'
  | 'cta_overlay';

export type SlotSource = 'recorded' | 'uploaded';

export type VideoOrientation = 'portrait' | 'landscape' | 'square';

export type ModerationStatus = 'safe' | 'review' | 'blocked';

// ==================== SEGMENT TYPES ====================

export interface SelectedSegment {
  startTime: number;
  endTime: number;
  score?: number;
}

// ==================== SLOT CLIP TYPES ====================

export interface SlotClip {
  id: string;
  episodeId: string;
  slotId: string;
  slotType: SlotType;

  // Source tracking
  source: SlotSource;

  // Media (S3 canonical)
  s3Key: string;

  // Mux asset
  muxAssetId: string | null;
  muxPlaybackId: string | null;

  // Metadata
  duration: number | null;
  fps: number | null;
  orientation: VideoOrientation | null;
  width: number | null;
  height: number | null;

  // AI enrichment
  aiTags: string[];
  aiSummary: string | null;
  aiEmbeddingsRef: string | null;
  moderationStatus: ModerationStatus | null;

  // Segment selection
  selectedSegments: SelectedSegment[] | null;

  createdAt: Date;
  updatedAt: Date;
}

export interface CreateSlotClipInput {
  episodeId: string;
  slotId: string;
  slotType: SlotType;
  source: SlotSource;
  s3Key: string;
  duration?: number;
  fps?: number;
  orientation?: VideoOrientation;
  width?: number;
  height?: number;
}

export interface UpdateSlotClipInput {
  muxAssetId?: string;
  muxPlaybackId?: string;
  duration?: number;
  fps?: number;
  orientation?: VideoOrientation;
  width?: number;
  height?: number;
  aiTags?: string[];
  aiSummary?: string;
  aiEmbeddingsRef?: string;
  moderationStatus?: ModerationStatus;
  selectedSegments?: SelectedSegment[];
}

// ==================== SLOT VALIDATION TYPES ====================

export interface SlotValidationResult {
  slotId: string;
  valid: boolean;
  issues: SlotValidationIssue[];
}

export interface SlotValidationIssue {
  type: 'duration_too_short' | 'duration_too_long' | 'wrong_orientation' | 'moderation_failed';
  message: string;
  severity: 'error' | 'warning';
}

// ==================== SLOT PROGRESS TYPES ====================

export interface SlotProgress {
  slotId: string;
  slotType: SlotType;
  required: boolean;
  status: 'pending' | 'uploading' | 'processing' | 'ready' | 'error';
  clips: SlotClipSummary[];
  totalDuration: number;
  targetDuration: number;
  meetsRequirement: boolean;
}

export interface SlotClipSummary {
  id: string;
  duration: number | null;
  muxPlaybackId: string | null;
  status: 'uploading' | 'processing' | 'ready' | 'error';
}

export interface EpisodeSlotProgress {
  episodeId: string;
  totalRequired: number;
  completedRequired: number;
  totalOptional: number;
  completedOptional: number;
  slots: SlotProgress[];
  canProceed: boolean;
}
