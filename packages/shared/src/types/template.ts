/**
 * Template Types
 *
 * TypeScript interfaces for template data structures.
 * These types align with the Prisma schema and WEBL-USER-JOURNEY-FINAL.md specification.
 */

// ==================== PLATFORM & CATEGORIZATION TYPES ====================

export type Platform = 'tiktok' | 'reels' | 'shorts' | 'all';

export type Niche =
  | 'general'
  | 'fitness'
  | 'business'
  | 'lifestyle'
  | 'beauty'
  | 'tech'
  | 'education'
  | 'food'
  | 'travel'
  | 'finance'
  | 'health'
  | 'entertainment';

export type Tone =
  | 'aggressive'
  | 'calm'
  | 'educational'
  | 'motivational'
  | 'humorous'
  | 'professional'
  | 'casual'
  | 'conversational';

export type RenderEngine = 'ffmpeg_microcut_v2';

// ==================== TEMPLATE TIMELINE SPEC ====================

export type BeatType =
  | 'hook'
  | 'content'
  | 'pattern_interrupt'
  | 'cta'
  | 'setup'
  | 'tension'
  | 'resolution'
  | 'tip1'
  | 'tip2'
  | 'tip3'
  | 'myth'
  | 'truth'
  | 'proof'
  | 'before'
  | 'process'
  | 'after'
  | 'context'
  | 'argument'
  | 'challenge'
  | 'morning'
  | 'midday'
  | 'evening'
  | 'unbox'
  | 'features'
  | 'verdict'
  | 'skincare'
  | 'makeup'
  | 'outfit'
  | 'final'
  | 'step1'
  | 'step2'
  | 'step3'
  | 'result'
  | 'insight';

export type PacingType = 'fast' | 'medium' | 'slow';
export type PacingCurve = 'aggressive' | 'moderate' | 'calm';

export interface TimelineBeat {
  index: number;
  type: BeatType | string;
  startTime: number;
  endTime: number;
  duration: number;
  pacing: PacingType;
}

export interface TemplateTimelineSpec {
  totalDuration: number;
  beats: TimelineBeat[];
  pacingCurve: PacingCurve;
}

// ==================== TEMPLATE LAYOUT SPEC ====================

export type LayoutType =
  | 'fullscreen_a_roll'
  | 'fullscreen_b_roll'
  | 'split_screen'
  | 'picture_in_picture';

export type AspectRatio = '9:16' | '16:9' | '1:1' | '4:5';

export interface SafeArea {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface SplitConfig {
  top: 'a_roll' | 'b_roll';
  bottom: 'a_roll' | 'b_roll';
  ratio: number;
}

export interface LayoutBeat {
  beatIndex: number;
  layout: LayoutType;
  splitConfig?: SplitConfig;
  safeArea: SafeArea;
}

export interface Resolution {
  width: number;
  height: number;
}

export interface TemplateLayoutSpec {
  beats: LayoutBeat[];
  aspectRatio: AspectRatio;
  resolution: Resolution;
}

// ==================== TEMPLATE SLOT REQUIREMENTS ====================

export type SlotType =
  | 'a_roll_face'
  | 'b_roll_illustration'
  | 'b_roll_action'
  | 'screen_record'
  | 'product_shot'
  | 'pattern_interrupt'
  | 'cta_overlay';

export type SlotPriority = 'required' | 'optional';
export type SlotSource = 'recorded' | 'uploaded';
export type SlotPosition = 'fullscreen' | 'top' | 'bottom' | 'overlay';

export interface SlotDuration {
  min: number;
  target: number;
  max: number;
}

export interface SlotLayoutUsage {
  beatIndices: number[];
  position: SlotPosition;
}

export interface SlotRequirement {
  slotId: string;
  slotType: SlotType;
  priority: SlotPriority;
  duration: SlotDuration;
  allowedSources: SlotSource[];
  description: string;
  examples: string[];
  layoutUsage: SlotLayoutUsage;
}

export interface TemplateSlotRequirements {
  slots: SlotRequirement[];
}

// ==================== TEMPLATE STYLE SPEC ====================

export type FontWeight = 'normal' | 'bold' | '600' | '700';
export type CaptionPosition = 'top' | 'bottom' | 'center';
export type CaptionAnimation = 'fade' | 'slide' | 'typewriter' | 'pop';
export type TransitionType = 'cut' | 'fade' | 'dissolve' | 'slide';
export type OverlayType = 'emoji' | 'text' | 'icon' | 'sticker';

export interface CaptionStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: FontWeight;
  color: string;
  backgroundColor: string;
  position: CaptionPosition;
  animation: CaptionAnimation;
  highlightWords: boolean;
  highlightColor: string;
}

export interface Transition {
  fromBeat: number;
  toBeat: number;
  type: TransitionType;
  duration: number;
}

export interface OverlayPosition {
  x: number;
  y: number;
}

export interface Overlay {
  beatIndex: number;
  type: OverlayType;
  content: string;
  position: OverlayPosition;
  animation: string;
}

export interface ColorGrading {
  lut?: string;
  saturation?: number;
  contrast?: number;
}

export interface TemplateStyleSpec {
  captions: CaptionStyle;
  transitions: Transition[];
  overlays: Overlay[];
  colorGrading?: ColorGrading;
}

// ==================== TEMPLATE MOTION SPEC ====================

export type TextAnimationType = 'bounce' | 'shake' | 'pulse' | 'slide_in';
export type BackgroundEffectType = 'blur' | 'pan' | 'none';

export interface TextAnimation {
  beatIndex: number;
  animation: TextAnimationType;
  timing: number;
}

export interface BackgroundEffect {
  beatIndex: number;
  effect: BackgroundEffectType;
}

export interface TemplateMotionSpec {
  textAnimations: TextAnimation[];
  backgroundEffects: BackgroundEffect[];
}

// ==================== TEMPLATE PACKAGE ====================

export interface TemplatePackage {
  templatePackageVersion: string;
  timelineSpec: TemplateTimelineSpec;
  layoutSpec: TemplateLayoutSpec;
  slotRequirements: TemplateSlotRequirements;
  styleSpec: TemplateStyleSpec;
  motionSpec: TemplateMotionSpec;
}

// ==================== LEGACY TYPES (for backward compatibility) ====================

export interface TemplateBeat {
  type: string;
  duration: number;
  description: string;
  visualGuidance?: string;
  audioGuidance?: string;
}

export interface TemplateStructure {
  beats: TemplateBeat[];
  totalDuration?: number;
}

export type CutRhythm = 'fast' | 'medium' | 'slow' | 'variable';
export type CaptionStyleType = 'animated' | 'bold' | 'minimal' | 'none';
export type MusicType = 'upbeat' | 'cinematic' | 'dramatic' | 'ambient' | 'none';

export interface EditingRecipe {
  cutRhythm: CutRhythm;
  captionStyle: CaptionStyleType | CaptionStyle;
  musicType: MusicType;
  transitions: string[] | Record<string, string>;
  musicGuidance?: {
    type: MusicType;
    bpm?: string;
    mood?: string;
    fadeIn: boolean;
    fadeInDuration?: number;
    fadeOut: boolean;
    fadeOutDuration?: number;
    duckOnVoice?: boolean;
    volume?: number;
  };
  colorGrading?: ColorGrading;
}

// ==================== TEMPLATE TYPES ====================

export interface Template {
  id: string;
  name: string;
  description: string | null;
  platform: Platform;
  language: string;
  durationTarget: number;

  // Template Package (NEW)
  templatePackageVersion: string;
  renderEngine: RenderEngine;
  timelineSpec: TemplateTimelineSpec;
  layoutSpec: TemplateLayoutSpec;
  slotRequirements: TemplateSlotRequirements;
  styleSpec: TemplateStyleSpec;
  motionSpec: TemplateMotionSpec;

  // Legacy fields
  canonicalScript: string | null;
  scriptStructure: TemplateStructure | null;
  editingRecipe: EditingRecipe | null;

  // Categorization
  personaTags: string[];
  niche: string | null;
  tone: string | null;

  // Performance
  viewCount: number;
  retentionRate: number | null;
  saveRate: number | null;
  embeddingId: string | null;

  createdAt: Date;
  updatedAt: Date;
}

export interface TemplateWithSlotSummary extends Template {
  requiredSlots: number;
  optionalSlots: number;
  totalArollDuration: number;
  totalBrollDuration: number;
}

export interface CreateTemplateInput {
  name: string;
  description?: string;
  platform: Platform;
  language?: string;
  durationTarget: number;
  timelineSpec: TemplateTimelineSpec;
  layoutSpec: TemplateLayoutSpec;
  slotRequirements: TemplateSlotRequirements;
  styleSpec: TemplateStyleSpec;
  motionSpec: TemplateMotionSpec;
  canonicalScript?: string;
  scriptStructure?: TemplateStructure;
  editingRecipe?: EditingRecipe;
  personaTags?: string[];
  niche?: string;
  tone?: string;
}
