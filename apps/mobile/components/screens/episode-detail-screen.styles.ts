import { StyleSheet } from 'react-native';
import { borderRadius, colors, spacing, typography } from '@/lib/theme';

export const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
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
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statusPill: {
    color: colors.primary.DEFAULT,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.bold,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  sectionTitle: {
    marginBottom: spacing.sm,
    color: colors.text.DEFAULT,
    fontFamily: typography.fontFamily.heading,
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold,
  },
  stack: {
    gap: spacing.sm,
  },
  arollVideoPreviewWrap: {
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  subSectionTitle: {
    color: colors.text.DEFAULT,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.bold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionDivider: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginVertical: spacing.xs,
  },
  warningText: {
    color: colors.warning,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
  },
  rejectionTitle: {
    color: colors.text.DEFAULT,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.bold,
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  rejectionText: {
    color: colors.text.muted,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
    lineHeight: 20,
  },
  metaText: {
    color: colors.text.light,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
  },
  separator: {
    height: spacing.sm,
  },
  historyToggleWrap: {
    marginTop: spacing.md,
    marginBottom: spacing.md,
    alignItems: 'flex-start',
  },
  jobRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  jobLeft: {
    flex: 1,
  },
  jobType: {
    color: colors.text.DEFAULT,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
    textTransform: 'capitalize',
  },
  jobProgress: {
    color: colors.primary.DEFAULT,
    fontFamily: typography.fontFamily.mono,
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.bold,
  },
  errorText: {
    marginTop: spacing.xs,
    color: colors.error,
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
    borderWidth: 2,
    borderColor: colors.primary.DEFAULT,
    backgroundColor: 'rgba(14, 165, 168, 0.08)',
  },
  glassStatusLeft: {
    flex: 1,
    gap: spacing.xs,
  },
  glassStatusLabel: {
    color: colors.primary.DEFAULT,
    fontFamily: typography.fontFamily.heading,
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  glassStatusStep: {
    color: colors.text.muted,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
  },
  // Section containers
  sectionContainer: {
    gap: spacing.sm,
  },
  // Blocking state overlay
  blockingCard: {
    gap: spacing.sm,
    alignItems: 'center',
    paddingVertical: spacing.xl,
  },
  blockingText: {
    color: colors.text.DEFAULT,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
    textAlign: 'center',
  },
  blockingSubtext: {
    color: colors.text.muted,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
    textAlign: 'center',
  },
  // Next step guidance card
  guidanceCard: {
    gap: spacing.xs,
  },
  guidanceTitle: {
    color: colors.text.DEFAULT,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.bold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  guidanceText: {
    color: colors.text.muted,
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
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surface,
  },
  captionsTextWrap: {
    flex: 1,
    marginRight: spacing.md,
  },
  captionsLabel: {
    color: colors.text.DEFAULT,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
  },
  captionsHint: {
    marginTop: 2,
    color: colors.text.muted,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.xs,
  },
  scriptGenerateWrap: {
    marginTop: spacing.lg,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.sm,
  },
  scriptGenerateHint: {
    color: colors.text.muted,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.xs,
  },
  // Phase summary rows (Pipeline Status section)
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
    backgroundColor: colors.surface,
  },
  phaseDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  phaseLabel: {
    flex: 1,
    color: colors.text.DEFAULT,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
  },
  phaseStatusText: {
    color: colors.text.muted,
    fontFamily: typography.fontFamily.mono,
    fontSize: typography.fontSize.xs,
  },
  phaseStatusDone: {
    color: '#0A9F6A',
  },
  phaseStatusError: {
    color: colors.error,
    fontWeight: typography.fontWeight.bold,
  },
  phaseStatusActive: {
    color: colors.primary.DEFAULT,
    fontWeight: typography.fontWeight.semibold,
  },
  // ElevenLabs blocking overlay
  elevenLabsBlockingCard: {
    gap: spacing.sm,
    alignItems: 'center',
    paddingVertical: spacing.lg,
  },
  elevenLabsProgressWrap: {
    width: '100%',
    paddingHorizontal: spacing.md,
  },
});
