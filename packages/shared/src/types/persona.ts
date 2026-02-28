/**
 * Persona Types
 */

import type { Platform } from './series.js';

export type Niche =
  | 'fitness'
  | 'business'
  | 'lifestyle'
  | 'tech'
  | 'finance'
  | 'health'
  | 'education'
  | 'entertainment'
  | 'food'
  | 'travel'
  | 'beauty'
  | 'fashion'
  | 'gaming'
  | 'music'
  | 'art'
  | 'sports'
  | 'parenting'
  | 'relationships'
  | 'spirituality'
  | 'productivity'
  | 'other';

export type Tone =
  | 'aggressive'
  | 'calm'
  | 'educational'
  | 'motivational'
  | 'conversational'
  | 'humorous'
  | 'professional'
  | 'casual'
  | 'inspiring'
  | 'authoritative';

export interface Persona {
  id: string;
  userId: string;
  niche: string;
  subNiche: string | null;
  targetAudience: string;
  tone: string;
  language: string;
  platforms: Platform[];
  offer: string | null;
  cta: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PersonaProfile {
  niche: string;
  subNiche?: string;
  targetAudience: string;
  tone: string;
  platforms: string[];
}

export interface OnboardingProgress {
  currentStep: number;
  totalSteps: number;
  completedSteps: string[];
  persona: Partial<Persona>;
}
