/**
 * Onboarding Store
 *
 * Zustand store for managing the Bandersnatch-style onboarding flow.
 * Tracks user choices, paths taken, and persona building progress.
 */

import { create } from 'zustand';

export type Niche =
  | 'fitness'
  | 'business'
  | 'lifestyle'
  | 'tech'
  | 'beauty'
  | 'food'
  | 'travel'
  | 'education'
  | 'entertainment'
  | 'gaming';

export type Tone =
  | 'aggressive'
  | 'calm'
  | 'educational'
  | 'motivational'
  | 'humorous';

export type Platform = 'tiktok' | 'reels' | 'shorts';
export type OnboardingRoute =
  | '/(main)/onboarding/niche'
  | '/(main)/onboarding/audience'
  | '/(main)/onboarding/tone'
  | '/(main)/onboarding/platform'
  | '/(main)/onboarding/complete';

export type AudienceAge = '13-17' | '18-24' | '25-34' | '35-44' | '45+';

export type ContentGoal =
  | 'grow_audience'
  | 'monetize'
  | 'brand_awareness'
  | 'community'
  | 'education';

export interface OnboardingChoice {
  step: string;
  choice: string;
  timestamp: number;
}

export interface PersonaData {
  niche: Niche | null;
  subNiche: string | null;
  targetAudience: string | null;
  audienceAge: AudienceAge | null;
  tone: Tone | null;
  platforms: Platform[];
  contentGoal: ContentGoal | null;
  postingFrequency: string | null;
}

interface OnboardingStore {
  // Current step in the journey
  currentStep: number;
  totalSteps: number;
  
  // Path tracking (Bandersnatch-style)
  choiceHistory: OnboardingChoice[];
  
  // Persona data being built
  persona: PersonaData;
  
  // UI state
  isAnimating: boolean;
  showPathReveal: boolean;
  
  // Actions
  setCurrentStep: (step: number) => void;
  nextStep: () => void;
  prevStep: () => void;
  
  // Choice actions
  makeChoice: (step: string, choice: string) => void;
  undoLastChoice: () => void;
  
  // Persona actions
  setNiche: (niche: Niche) => void;
  setSubNiche: (subNiche: string) => void;
  setTargetAudience: (audience: string) => void;
  setAudienceAge: (age: AudienceAge) => void;
  setTone: (tone: Tone) => void;
  togglePlatform: (platform: Platform) => void;
  setContentGoal: (goal: ContentGoal) => void;
  setPostingFrequency: (frequency: string) => void;
  hydrateFromPersona: (persona: Partial<PersonaData>) => void;
  
  // UI actions
  setIsAnimating: (animating: boolean) => void;
  setShowPathReveal: (show: boolean) => void;
  
  // Reset
  resetOnboarding: () => void;
  
  // Computed
  isComplete: () => boolean;
  getProgress: () => number;
  getResumeRoute: () => OnboardingRoute;
}

const initialPersona: PersonaData = {
  niche: null,
  subNiche: null,
  targetAudience: null,
  audienceAge: null,
  tone: null,
  platforms: [],
  contentGoal: null,
  postingFrequency: null,
};

export const useOnboardingStore = create<OnboardingStore>((set, get) => ({
  currentStep: 0,
  totalSteps: 5,
  choiceHistory: [],
  persona: { ...initialPersona },
  isAnimating: false,
  showPathReveal: false,

  setCurrentStep: (step) => set({ currentStep: step }),
  
  nextStep: () => set((state) => ({
    currentStep: Math.min(state.currentStep + 1, state.totalSteps - 1),
  })),
  
  prevStep: () => set((state) => ({
    currentStep: Math.max(state.currentStep - 1, 0),
  })),

  makeChoice: (step, choice) => set((state) => ({
    choiceHistory: [
      ...state.choiceHistory,
      { step, choice, timestamp: Date.now() },
    ],
  })),

  undoLastChoice: () => set((state) => ({
    choiceHistory: state.choiceHistory.slice(0, -1),
  })),

  setNiche: (niche) => set((state) => ({
    persona: { ...state.persona, niche },
  })),

  setSubNiche: (subNiche) => set((state) => ({
    persona: { ...state.persona, subNiche },
  })),

  setTargetAudience: (targetAudience) => set((state) => ({
    persona: { ...state.persona, targetAudience },
  })),

  setAudienceAge: (audienceAge) => set((state) => ({
    persona: { ...state.persona, audienceAge },
  })),

  setTone: (tone) => set((state) => ({
    persona: { ...state.persona, tone },
  })),

  togglePlatform: (platform) => set((state) => {
    const platforms = state.persona.platforms.includes(platform)
      ? state.persona.platforms.filter((p) => p !== platform)
      : [...state.persona.platforms, platform];
    return { persona: { ...state.persona, platforms } };
  }),

  setContentGoal: (contentGoal) => set((state) => ({
    persona: { ...state.persona, contentGoal },
  })),

  setPostingFrequency: (postingFrequency) => set((state) => ({
    persona: { ...state.persona, postingFrequency },
  })),

  hydrateFromPersona: (persona) => set((state) => ({
    persona: {
      ...state.persona,
      ...persona,
      platforms: persona.platforms ?? state.persona.platforms,
    },
  })),

  setIsAnimating: (isAnimating) => set({ isAnimating }),
  
  setShowPathReveal: (showPathReveal) => set({ showPathReveal }),

  resetOnboarding: () => set({
    currentStep: 0,
    choiceHistory: [],
    persona: { ...initialPersona },
    isAnimating: false,
    showPathReveal: false,
  }),

  isComplete: () => {
    const { persona } = get();
    return (
      persona.niche !== null &&
      persona.tone !== null &&
      persona.platforms.length > 0
    );
  },

  getProgress: () => {
    const { currentStep, totalSteps } = get();
    return ((currentStep + 1) / totalSteps) * 100;
  },

  getResumeRoute: () => {
    const { persona } = get();
    const hasAudienceSignal =
      Boolean(persona.audienceAge) ||
      Boolean(persona.contentGoal) ||
      Boolean(persona.targetAudience?.trim());

    if (!persona.niche) return '/(main)/onboarding/niche';
    if (!hasAudienceSignal) return '/(main)/onboarding/audience';
    if (!persona.tone) return '/(main)/onboarding/tone';
    if (!persona.platforms.length) return '/(main)/onboarding/platform';
    return '/(main)/onboarding/complete';
  },
}));
