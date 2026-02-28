import { StyleSheet } from 'react-native';
import { borderRadius, colors, spacing, typography } from '@/lib/theme';

export const styles = StyleSheet.create({
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing['3xl'],
    paddingBottom: spacing['4xl'],
    gap: spacing.md,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: borderRadius.full,
  },
  avatarPressable: {
    position: 'relative',
  },
  avatarFallback: {
    width: 56,
    height: 56,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: colors.text.DEFAULT,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold,
  },
  avatarBadge: {
    position: 'absolute',
    right: -3,
    bottom: -3,
    width: 22,
    height: 22,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.surface,
    backgroundColor: colors.primary.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  userInfo: {
    flex: 1,
  },
  name: {
    color: colors.text.DEFAULT,
    fontFamily: typography.fontFamily.heading,
    fontSize: typography.fontSize.xl,
    fontWeight: typography.fontWeight.bold,
  },
  email: {
    marginTop: 2,
    color: colors.text.muted,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
  },
  avatarHint: {
    marginTop: spacing.xs,
    color: colors.text.light,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.xs,
  },
  sectionTitle: {
    color: colors.text.DEFAULT,
    fontFamily: typography.fontFamily.heading,
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold,
    marginBottom: spacing.sm,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  tile: {
    width: '48%',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.panel,
    padding: spacing.sm,
  },
  tileLabel: {
    color: colors.text.light,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.xs,
  },
  tileValue: {
    marginTop: spacing.xs,
    color: colors.primary.DEFAULT,
    fontFamily: typography.fontFamily.mono,
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold,
  },
  stack: {
    gap: spacing.sm,
  },
  helperText: {
    color: colors.text.light,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
  },
  onboardingBanner: {
    borderWidth: 1,
    borderColor: '#B9E9CE',
    backgroundColor: '#EFFFF6',
    borderRadius: borderRadius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  onboardingBannerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  onboardingBannerTitle: {
    color: '#0B5E3A',
    fontFamily: typography.fontFamily.heading,
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold,
  },
  onboardingBannerBody: {
    color: '#2D6A4B',
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
    lineHeight: 20,
  },

  // ==================== Suspended banner ====================
  suspendedBanner: {
    backgroundColor: colors.error,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  suspendedBannerText: {
    flex: 1,
    color: colors.text.inverse,
    fontFamily: typography.fontFamily.heading,
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.bold,
  },
  suspendedBannerSubtext: {
    color: 'rgba(255,255,255,0.85)',
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.xs,
    marginTop: 2,
  },

  // ==================== Usage limit bar ====================
  limitRow: {
    marginBottom: spacing.sm,
  },
  limitHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  limitLabel: {
    color: colors.text.muted,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.xs,
  },
  limitValues: {
    color: colors.text.light,
    fontFamily: typography.fontFamily.mono,
    fontSize: typography.fontSize.xs,
  },
  limitTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.panelAlt,
    overflow: 'hidden',
  },
  limitFill: {
    height: 6,
    borderRadius: 3,
  },
  limitWarning: {
    marginTop: 2,
    color: colors.warning,
    fontFamily: typography.fontFamily.body,
    fontSize: 10,
  },

  // ==================== Subscription section ====================
  subscriptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  subscriptionTier: {
    color: colors.primary.DEFAULT,
    fontFamily: typography.fontFamily.heading,
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold,
    textTransform: 'capitalize',
  },
  subscriptionBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  subscriptionBadgeText: {
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.bold,
  },

  // ==================== Daily stats row ====================
  dailyStatsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  dailyStat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    backgroundColor: colors.panelAlt,
    borderRadius: borderRadius.xs,
  },
  dailyStatLabel: {
    color: colors.text.light,
    fontFamily: typography.fontFamily.body,
    fontSize: 10,
  },
  dailyStatValue: {
    color: colors.text.DEFAULT,
    fontFamily: typography.fontFamily.mono,
    fontSize: 10,
    fontWeight: typography.fontWeight.bold,
  },
});
