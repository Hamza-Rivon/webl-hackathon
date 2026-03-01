/**
 * WEBL Mobile Theme
 *
 * Unified tokens for color, typography, spacing, radius, elevation, and motion.
 * Tuned for high contrast and daylight readability on iPhone/Android.
 */

import { Platform } from 'react-native';

const headingFont = Platform.select({
  ios: 'Avenir Next',
  android: 'sans-serif-condensed',
  default: 'System',
});

const bodyFont = Platform.select({
  ios: 'Avenir',
  android: 'sans-serif-medium',
  default: 'System',
});

const monoFont = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'monospace',
});

export const colors = {
  // Brand intent
  primary: {
    DEFAULT: '#0EA5A8',
    dark: '#0A7E80',
    light: '#59CDD0',
  },
  secondary: {
    DEFAULT: '#F59E0B',
    dark: '#D97706',
    light: '#FCD34D',
  },
  accent: {
    DEFAULT: '#22C55E',
    dark: '#16A34A',
    light: '#86EFAC',
  },

  // Core light palette
  background: '#EEF4FB',
  surface: '#FFFFFF',
  panel: '#F7FAFF',
  panelAlt: '#EAF1FC',
  overlay: 'rgba(245, 250, 255, 0.9)',
  border: '#C8D4E3',

  text: {
    DEFAULT: '#10233D',
    muted: '#445875',
    light: '#647895',
    inverse: '#FFFFFF',
  },

  // Semantic
  success: '#0A9F6A',
  warning: '#B46900',
  error: '#C7354F',
  info: '#1D6FD8',

  // Legacy aliases used in older screens/components
  pastel: {
    pink: '#FFEFF4',
    blue: '#EEF5FF',
    green: '#EAFBF2',
    yellow: '#FFF7E8',
    purple: '#F3EEFF',
    orange: '#FFF2E8',
  },
} as const;

export const statusColors = {
  draft: '#73839B',
  voiceover_uploaded: '#2E87D9',
  voiceover_cleaning: '#0EA5A8',
  voiceover_cleaned: '#199C7A',
  collecting_clips: '#2E76C9',
  needs_more_clips: '#B46900',
  chunking_clips: '#4A76C8',
  enriching_chunks: '#586CCF',
  matching: '#665BCB',
  cut_plan_ready: '#2F8E38',
  rendering: '#CC7A00',
  ready: '#0A9F6A',
  published: '#067A56',
  failed: '#C7354F',
} as const;

export const typography = {
  fontFamily: {
    heading: headingFont,
    sans: bodyFont,
    body: bodyFont,
    mono: monoFont,
  },
  fontSize: {
    xs: 11,
    sm: 13,
    base: 16,
    lg: 18,
    xl: 22,
    '2xl': 28,
    '3xl': 34,
    '4xl': 42,
  },
  fontWeight: {
    normal: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
    extrabold: '800',
  },
  lineHeight: {
    tight: 1.15,
    normal: 1.45,
    relaxed: 1.65,
  },
} as const;

// 4pt grid
export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 24,
  '3xl': 32,
  '4xl': 40,
  '5xl': 48,
  '6xl': 56,
} as const;

export const borderRadius = {
  xs: 6,
  sm: 10,
  md: 14,
  lg: 20,
  xl: 28,
  full: 9999,
} as const;

export const opacity = {
  disabled: 0.45,
  muted: 0.75,
  subtle: 0.12,
} as const;

export const shadows = {
  none: {
    shadowColor: 'transparent',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
  sm: {
    shadowColor: '#17304E',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
  },
  md: {
    shadowColor: '#17304E',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 5,
  },
  lg: {
    shadowColor: '#17304E',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.16,
    shadowRadius: 18,
    elevation: 9,
  },
  xl: {
    shadowColor: '#17304E',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.2,
    shadowRadius: 24,
    elevation: 12,
  },
} as const;

export const motion = {
  duration: {
    instant: 90,
    fast: 160,
    base: 240,
    slow: 360,
    cinematic: 520,
  },
  spring: {
    soft: { damping: 18, stiffness: 170 },
    crisp: { damping: 14, stiffness: 240 },
  },
} as const;

export const gradients = {
  panelGlowTop: 'rgba(14, 165, 168, 0.14)',
  panelGlowBottom: 'rgba(245, 158, 11, 0.12)',
} as const;

// ── Dark Palette ──────────────────────────────────────────────
export const darkColors = {
  primary: {
    DEFAULT: '#5CF6FF',
    dark: '#0EA5A8',
    light: '#99FBFF',
  },
  secondary: {
    DEFAULT: '#FCD34D',
    dark: '#F59E0B',
    light: '#FDE68A',
  },
  accent: {
    DEFAULT: '#4ADE80',
    dark: '#22C55E',
    light: '#86EFAC',
  },

  background: '#0A0E14',
  surface: '#141820',
  panel: '#1C2230',
  panelAlt: '#232B3B',
  overlay: 'rgba(10, 14, 20, 0.92)',
  border: 'rgba(255,255,255,0.15)',

  text: {
    DEFAULT: '#F1F5F9',
    muted: 'rgba(255,255,255,0.78)',
    light: 'rgba(255,255,255,0.56)',
    inverse: '#10233D',
  },

  success: '#4ADE80',
  warning: '#FBBF24',
  error: '#FB7185',
  info: '#60A5FA',

  pastel: {
    pink: 'rgba(251,113,133,0.12)',
    blue: 'rgba(96,165,250,0.12)',
    green: 'rgba(74,222,128,0.12)',
    yellow: 'rgba(251,191,36,0.12)',
    purple: 'rgba(167,139,250,0.12)',
    orange: 'rgba(251,146,60,0.12)',
  },
} as const;

// Light palette (pure white base for branding)
export const lightColors = {
  ...colors,
  background: '#FFFFFF',
  surface: '#F8F9FA',
  panel: '#F1F3F5',
  panelAlt: '#E9ECEF',
  overlay: 'rgba(255, 255, 255, 0.92)',
  border: '#DEE2E6',
} as const;

export type ThemeMode = 'light' | 'dark';

export type ThemeColors = typeof colors;

export function getThemeColors(mode: ThemeMode): ThemeColors {
  if (mode === 'dark') return darkColors as unknown as ThemeColors;
  return lightColors as unknown as ThemeColors;
}

// Pipeline phase gradients for 3D cards
export const phaseGradients = {
  1: ['#667EEA', '#764BA2'] as const, // Voiceover: purple-blue
  2: ['#F093FB', '#F5576C'] as const, // Footage: pink-coral
  3: ['#4FACFE', '#00F2FE'] as const, // Matching: cyan-blue
  4: ['#43E97B', '#38F9D7'] as const, // Edit Plan: green-teal
  5: ['#FA709A', '#FEE140'] as const, // Render: pink-gold
} as const;

// Semantic surface and elevation tokens for consistent hierarchy.
export const surfaceLevels = {
  base: colors.background,
  sunken: colors.panelAlt,
  raised: colors.panel,
  floating: colors.surface,
} as const;

export const elevation = {
  none: shadows.none,
  low: shadows.sm,
  medium: shadows.md,
  high: shadows.lg,
} as const;

export type EpisodeTone = keyof typeof statusColors;

export function getStatusTone(status: string) {
  return statusColors[status as EpisodeTone] ?? colors.text.muted;
}

// Legacy compatibility exports used by existing modules.
export type Colors = typeof colors;
export type Typography = typeof typography;
export interface Theme {
  colors: Colors;
  typography: Typography;
  spacing: typeof spacing;
  borderRadius: typeof borderRadius;
  shadows: typeof shadows;
  surfaceLevels: typeof surfaceLevels;
  elevation: typeof elevation;
}

export const theme: Theme = {
  colors,
  typography,
  spacing,
  borderRadius,
  shadows,
  surfaceLevels,
  elevation,
};

export const buttonStyles = {
  base: {
    borderRadius: borderRadius.md,
    minHeight: 48,
    paddingHorizontal: spacing.lg,
  },
};

export const cardStyles = {
  base: {
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
};

export const inputStyles = {
  base: {
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
  },
};

export const badgeStyles = {
  base: {
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
};

export const progressStyles = {
  trackColor: colors.panel,
  fillColor: colors.primary.DEFAULT,
};

export const tabBarStyles = {
  height: 74,
  backgroundColor: colors.surface,
  borderTopColor: colors.border,
};
