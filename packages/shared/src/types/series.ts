/**
 * Series Types
 */

export type Cadence = 'daily' | 'weekly' | 'biweekly' | 'monthly';
export type Platform = 'tiktok' | 'reels' | 'shorts' | 'all';

export interface PersonaOverrides {
  tone?: string;
  targetAudience?: string;
  cta?: string;
}

export interface Series {
  id: string;
  name: string;
  description: string | null;
  cadence: Cadence;
  personaOverrides: PersonaOverrides | null;
  createdAt: Date;
  updatedAt: Date;
  userId: string;
  templateId: string | null;
}

export interface SeriesWithEpisodeCount extends Series {
  _count: {
    episodes: number;
  };
}

export interface SeriesWithTemplate extends Series {
  template: {
    id: string;
    name: string;
    platform: Platform;
  } | null;
}
