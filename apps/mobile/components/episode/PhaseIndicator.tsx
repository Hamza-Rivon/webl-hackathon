/**
 * Phase Indicator Component
 *
 * Visual progress bar showing Phase 1-5 progress across the video processing pipeline.
 */

import React, { useEffect } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { Ionicons } from '@/components/ui/SymbolIcon';
import { colors, typography, spacing, borderRadius, shadows } from '../../lib/theme';

export interface PhaseConfig {
  id: number;
  label: string;
  emoji: string;
  icon: keyof typeof Ionicons.glyphMap;
  description: string;
}

export const PHASES: PhaseConfig[] = [
  { id: 1, label: 'Voiceover', emoji: '🎙️', icon: 'mic-outline', description: 'Processing audio' },
  { id: 2, label: 'Footage', emoji: '🎬', icon: 'videocam-outline', description: 'Analyzing clips' },
  { id: 3, label: 'Matching', emoji: '🎯', icon: 'git-merge-outline', description: 'Matching content' },
  { id: 4, label: 'Edit Plan', emoji: '📋', icon: 'cut-outline', description: 'Creating cuts' },
  { id: 5, label: 'Render', emoji: '🎥', icon: 'film-outline', description: 'Final video' },
];

export interface PhaseIndicatorProps {
  currentPhase: number;
  phaseProgress?: number;
  isPhaseComplete?: boolean;
  compact?: boolean;
  onPhasePress?: (phase: number) => void;
}

function PhaseStep({
  phase,
  isComplete,
  isCurrent,
  isUpcoming,
  onPress,
  isLast,
}: {
  phase: PhaseConfig;
  isComplete: boolean;
  isCurrent: boolean;
  isUpcoming: boolean;
  onPress?: () => void;
  isLast: boolean;
}) {
  const pulseValue = useSharedValue(0);

  useEffect(() => {
    if (isCurrent) {
      pulseValue.value = withRepeat(
        withTiming(1, { duration: 2000, easing: Easing.inOut(Easing.ease) }),
        -1,
        true
      );
    } else {
      pulseValue.value = 0;
    }
  }, [isCurrent, pulseValue]);

  const pulseStyle = useAnimatedStyle(() => ({
    opacity: isCurrent ? 0.5 + pulseValue.value * 0.5 : 1,
  }));

  const stepColor = isComplete
    ? colors.success
    : isCurrent
      ? colors.primary.DEFAULT
      : colors.text.light;

  return (
    <View style={stepStyles.wrapper}>
      <Pressable
        onPress={onPress}
        disabled={!onPress}
        style={({ pressed }) => [
          stepStyles.step,
          pressed && onPress && stepStyles.stepPressed,
        ]}
      >
        <Animated.View
          style={[
            stepStyles.circle,
            isComplete && stepStyles.circleComplete,
            isCurrent && stepStyles.circleCurrent,
            isUpcoming && stepStyles.circleUpcoming,
            isCurrent && pulseStyle,
          ]}
        >
          {isComplete ? (
            <Ionicons name="checkmark" size={16} color="#fff" />
          ) : (
            <Ionicons
              name={phase.icon}
              size={16}
              color={isCurrent ? '#fff' : colors.text.light}
            />
          )}
        </Animated.View>
        <Text
          style={[
            stepStyles.label,
            isComplete && stepStyles.labelComplete,
            isCurrent && stepStyles.labelCurrent,
            isUpcoming && stepStyles.labelUpcoming,
          ]}
          numberOfLines={1}
        >
          {phase.label}
        </Text>
      </Pressable>

      {!isLast ? (
        <View style={stepStyles.connectorWrap}>
          <View
            style={[
              stepStyles.connector,
              isComplete && stepStyles.connectorComplete,
              isCurrent && stepStyles.connectorCurrent,
            ]}
          />
        </View>
      ) : null}
    </View>
  );
}

export function PhaseIndicator({
  currentPhase,
  phaseProgress = 0,
  isPhaseComplete = false,
  compact = false,
  onPhasePress,
}: PhaseIndicatorProps) {
  const overallProgress = Math.min(
    ((currentPhase - 1) * 20) + (phaseProgress / 5),
    100
  );

  const progressAnim = useSharedValue(0);

  useEffect(() => {
    progressAnim.value = withTiming(overallProgress, {
      duration: 600,
      easing: Easing.bezier(0.25, 0.1, 0.25, 1),
    });
  }, [overallProgress, progressAnim]);

  const progressStyle = useAnimatedStyle(() => ({
    width: `${progressAnim.value}%`,
  }));

  if (compact) {
    const currentConfig = PHASES[currentPhase - 1];
    return (
      <Animated.View entering={FadeIn.duration(300)} style={compactStyles.container}>
        <View style={compactStyles.row}>
          <View style={compactStyles.iconWrap}>
            <Ionicons name={currentConfig?.icon || 'film-outline'} size={16} color={colors.primary.DEFAULT} />
          </View>
          <View style={compactStyles.info}>
            <Text style={compactStyles.label}>
              Phase {currentPhase}: {currentConfig?.label || 'Processing'}
            </Text>
            <Text style={compactStyles.progress}>{Math.round(overallProgress)}%</Text>
          </View>
        </View>
        <View style={compactStyles.track}>
          <Animated.View style={[compactStyles.fill, progressStyle]} />
        </View>
      </Animated.View>
    );
  }

  return (
    <Animated.View entering={FadeInDown.duration(350)} style={styles.container}>
      <View style={styles.stepsRow}>
        {PHASES.map((phase, index) => {
          const isComplete = phase.id < currentPhase || (phase.id === currentPhase && currentPhase === 5 && overallProgress >= 100);
          const isCurrent = phase.id === currentPhase && !isComplete;
          const isUpcoming = phase.id > currentPhase;

          return (
            <PhaseStep
              key={phase.id}
              phase={phase}
              isComplete={isComplete}
              isCurrent={isCurrent}
              isUpcoming={isUpcoming}
              isLast={index === PHASES.length - 1}
              onPress={onPhasePress ? () => onPhasePress(phase.id) : undefined}
            />
          );
        })}
      </View>

      <View style={styles.progressSection}>
        <View style={styles.progressTrack}>
          <Animated.View style={[styles.progressFill, progressStyle]} />
        </View>
        <Text style={styles.progressLabel}>{Math.round(overallProgress)}% complete</Text>
      </View>
    </Animated.View>
  );
}

export function getPhaseFromStatus(status: string): number {
  switch (status) {
    case 'voiceover_uploaded':
    case 'voiceover_cleaning':
      return 1;
    case 'voiceover_cleaned':
    case 'collecting_clips':
    case 'needs_more_clips':
    case 'chunking_clips':
    case 'enriching_chunks':
      return 2;
    case 'matching':
      return 3;
    case 'cut_plan_ready':
      return 4;
    case 'rendering':
      return 5;
    case 'ready':
    case 'published':
      return 5;
    default:
      return 1;
  }
}

export function getPhaseFromJobType(jobType: string): number {
  if (jobType.startsWith('voiceover_')) return 1;
  if (jobType.startsWith('broll_')) return 2;
  if (jobType === 'semantic_matching') return 3;
  if (jobType === 'creative_edit_plan') return 4;
  if (jobType.startsWith('cut_plan_')) return 4;
  if (['ffmpeg_render_microcut_v2', 'mux_publish'].includes(jobType)) return 5;
  return 1;
}

const stepStyles = StyleSheet.create({
  wrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  step: {
    alignItems: 'center',
    gap: spacing.xs,
    minWidth: 48,
  },
  stepPressed: {
    opacity: 0.7,
  },
  circle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleComplete: {
    backgroundColor: colors.success,
    borderColor: colors.success,
    ...shadows.sm,
    shadowColor: colors.success,
  },
  circleCurrent: {
    backgroundColor: colors.primary.DEFAULT,
    borderColor: colors.primary.DEFAULT,
    ...shadows.md,
    shadowColor: colors.primary.DEFAULT,
    shadowOpacity: 0.4,
  },
  circleUpcoming: {
    backgroundColor: colors.panelAlt,
    borderColor: colors.border,
    opacity: 0.6,
  },
  label: {
    fontSize: 10,
    fontFamily: typography.fontFamily.body,
    fontWeight: typography.fontWeight.semibold,
    color: colors.text.muted,
    textAlign: 'center',
    maxWidth: 56,
  },
  labelComplete: {
    color: colors.success,
    fontWeight: typography.fontWeight.bold,
  },
  labelCurrent: {
    color: colors.primary.DEFAULT,
    fontWeight: typography.fontWeight.bold,
  },
  labelUpcoming: {
    color: colors.text.light,
    opacity: 0.6,
  },
  connectorWrap: {
    flex: 1,
    paddingTop: 17,
    paddingHorizontal: 2,
  },
  connector: {
    height: 2,
    backgroundColor: colors.border,
    borderRadius: 1,
  },
  connectorComplete: {
    backgroundColor: colors.success,
  },
  connectorCurrent: {
    backgroundColor: colors.primary.light,
  },
});

const styles = StyleSheet.create({
  container: {
    padding: spacing.md,
    gap: spacing.lg,
  },
  stepsRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  progressSection: {
    gap: spacing.xs,
  },
  progressTrack: {
    height: 6,
    backgroundColor: colors.panelAlt,
    borderRadius: borderRadius.full,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.primary.DEFAULT,
    borderRadius: borderRadius.full,
  },
  progressLabel: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily.body,
    fontWeight: typography.fontWeight.semibold,
    color: colors.text.muted,
    textAlign: 'center',
  },
});

const compactStyles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  iconWrap: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: colors.panelAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  label: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily.body,
    fontWeight: typography.fontWeight.semibold,
    color: colors.text.DEFAULT,
  },
  progress: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily.mono,
    fontWeight: typography.fontWeight.bold,
    color: colors.primary.DEFAULT,
  },
  track: {
    height: 4,
    backgroundColor: colors.panelAlt,
    borderRadius: 2,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    backgroundColor: colors.primary.DEFAULT,
    borderRadius: 2,
  },
});

export default PhaseIndicator;
