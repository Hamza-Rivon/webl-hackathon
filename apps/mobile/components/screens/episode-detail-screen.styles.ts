/**
 * Episode Detail Screen Styles
 *
 * Theme-aware style factory for the episode detail screen.
 * Returns styles based on current theme mode.
 */

import { StyleSheet } from 'react-native';
import { borderRadius, spacing, typography } from '@/lib/theme';
import type { ThemeColors } from '@/lib/theme';

export function createEpisodeDetailStyles(c: ThemeColors, isDark: boolean) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: c.background,
    },
    content: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.lg,
      paddingBottom: spacing['4xl'],
      gap: spacing.md,
    },
    headerStack: {
      gap: spacing.md,
      marginBottom: spacing.md,
    },
    header: {
      gap: spacing.sm,
    },
    sectionTitle: {
      marginBottom: spacing.sm,
      color: c.text.DEFAULT,
      fontFamily: typography.fontFamily.heading,
      fontSize: typography.fontSize.lg,
      fontWeight: typography.fontWeight.bold as any,
    },
    stack: {
      gap: spacing.sm,
    },
    arollVideoPreviewWrap: {
      marginTop: spacing.md,
      gap: spacing.sm,
    },
    subSectionTitle: {
      color: c.text.DEFAULT,
      fontFamily: typography.fontFamily.body,
      fontSize: typography.fontSize.sm,
      fontWeight: typography.fontWeight.bold as any,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    warningText: {
      color: c.warning,
      fontFamily: typography.fontFamily.body,
      fontSize: typography.fontSize.sm,
    },
    metaText: {
      color: c.text.light,
      fontFamily: typography.fontFamily.body,
      fontSize: typography.fontSize.sm,
    },
    // Glass status card
    glassStatusCard: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: spacing.md,
      borderRadius: borderRadius.lg,
      borderWidth: isDark ? 1 : 1.5,
      borderColor: isDark ? 'rgba(92,246,255,0.3)' : c.primary.DEFAULT,
      backgroundColor: isDark ? 'rgba(92,246,255,0.06)' : 'rgba(14,165,168,0.06)',
    },
    glassStatusLeft: {
      flex: 1,
      gap: spacing.xs,
    },
    glassStatusLabel: {
      color: isDark ? '#5CF6FF' : c.primary.DEFAULT,
      fontFamily: typography.fontFamily.heading,
      fontSize: typography.fontSize.lg,
      fontWeight: typography.fontWeight.bold as any,
      textTransform: 'uppercase',
      letterSpacing: 1,
    },
    glassStatusStep: {
      color: c.text.muted,
      fontFamily: typography.fontFamily.body,
      fontSize: typography.fontSize.sm,
    },
    // Blocking state
    blockingCard: {
      gap: spacing.sm,
      alignItems: 'center',
      paddingVertical: spacing.xl,
    },
    blockingText: {
      color: c.text.DEFAULT,
      fontFamily: typography.fontFamily.body,
      fontSize: typography.fontSize.base,
      fontWeight: typography.fontWeight.semibold as any,
      textAlign: 'center',
    },
    blockingSubtext: {
      color: c.text.muted,
      fontFamily: typography.fontFamily.body,
      fontSize: typography.fontSize.sm,
      textAlign: 'center',
    },
    // Guidance card
    guidanceCard: {
      gap: spacing.xs,
    },
    guidanceTitle: {
      color: c.text.DEFAULT,
      fontFamily: typography.fontFamily.body,
      fontSize: typography.fontSize.sm,
      fontWeight: typography.fontWeight.bold as any,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    guidanceText: {
      color: c.text.muted,
      fontFamily: typography.fontFamily.body,
      fontSize: typography.fontSize.sm,
      lineHeight: 20,
    },
    // Captions toggle row
    captionsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.sm,
      borderWidth: 1,
      borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
      borderRadius: borderRadius.md,
      backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : c.surface,
    },
    captionsTextWrap: {
      flex: 1,
      marginRight: spacing.md,
    },
    captionsLabel: {
      color: c.text.DEFAULT,
      fontFamily: typography.fontFamily.body,
      fontSize: typography.fontSize.base,
      fontWeight: typography.fontWeight.semibold as any,
    },
    captionsHint: {
      marginTop: 2,
      color: c.text.muted,
      fontFamily: typography.fontFamily.body,
      fontSize: typography.fontSize.xs,
    },
    scriptGenerateWrap: {
      marginTop: spacing.lg,
      paddingTop: spacing.sm,
      borderTopWidth: 1,
      borderTopColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
      gap: spacing.sm,
    },
    scriptGenerateHint: {
      color: c.text.muted,
      fontFamily: typography.fontFamily.body,
      fontSize: typography.fontSize.xs,
    },
    // Phase summary rows
    phaseSummaryWrap: {
      gap: spacing.xs,
    },
    phaseRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingVertical: 6,
      paddingHorizontal: spacing.sm,
      borderRadius: borderRadius.md,
      backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : c.surface,
    },
    phaseDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
    },
    phaseLabel: {
      flex: 1,
      color: c.text.DEFAULT,
      fontFamily: typography.fontFamily.body,
      fontSize: typography.fontSize.sm,
      fontWeight: typography.fontWeight.semibold as any,
    },
    phaseStatusText: {
      color: c.text.muted,
      fontFamily: typography.fontFamily.mono,
      fontSize: typography.fontSize.xs,
    },
    phaseStatusDone: {
      color: isDark ? '#4ADE80' : '#0A9F6A',
    },
    phaseStatusError: {
      color: c.error,
      fontWeight: typography.fontWeight.bold as any,
    },
    phaseStatusActive: {
      color: isDark ? '#5CF6FF' : c.primary.DEFAULT,
      fontWeight: typography.fontWeight.semibold as any,
    },
    elevenLabsProgressWrap: {
      width: '100%',
      paddingHorizontal: spacing.md,
    },
  });
}

// Backwards-compatible static export for existing imports
// Uses light theme defaults — components should migrate to createEpisodeDetailStyles
import { colors } from '@/lib/theme';
export const styles = createEpisodeDetailStyles(colors, false);
