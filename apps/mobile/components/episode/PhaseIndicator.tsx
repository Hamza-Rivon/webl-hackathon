/**
 * Phase Indicator Component
 *
 * 3D horizontal scrollable pipeline visualization.
 * Shows Phase 1-5 as cinematic gradient cards with depth and glow effects.
 */

import React, { useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { Ionicons } from '@/components/ui/SymbolIcon';
import { useTheme } from '@/contexts/ThemeContext';
import { typography, spacing, borderRadius, phaseGradients } from '@/lib/theme';
import { PipelinePhaseCard } from './PipelinePhaseCard';
import { LinearGradient } from 'expo-linear-gradient';

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

export function PhaseIndicator({
  currentPhase,
  phaseProgress = 0,
  isPhaseComplete = false,
  compact = false,
  onPhasePress,
}: PhaseIndicatorProps) {
  const { colors, isDark } = useTheme();
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
    const gradient = phaseGradients[currentPhase as keyof typeof phaseGradients] || phaseGradients[1];
    return (
      <Animated.View
        entering={FadeIn.duration(300)}
        style={[
          compactStyles.container,
          {
            backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.95)',
            borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
          },
        ]}
      >
        <View style={compactStyles.row}>
          <View style={[compactStyles.iconWrap, { backgroundColor: gradient[0] }]}>
            <Ionicons name={currentConfig?.icon || 'film-outline'} size={16} color="#FFFFFF" />
          </View>
          <View style={compactStyles.info}>
            <Text style={[compactStyles.label, { color: colors.text.DEFAULT }]}>
              Phase {currentPhase}: {currentConfig?.label || 'Processing'}
            </Text>
            <Text style={[compactStyles.progress, { color: gradient[0] }]}>
              {Math.round(overallProgress)}%
            </Text>
          </View>
        </View>
        <View style={[compactStyles.track, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }]}>
          <Animated.View style={[compactStyles.fill, progressStyle]}>
            <LinearGradient
              colors={[...gradient]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={StyleSheet.absoluteFillObject}
            />
          </Animated.View>
        </View>
      </Animated.View>
    );
  }

  return (
    <Animated.View entering={FadeInDown.duration(350)} style={styles.container}>
      {/* 3D Phase Cards Row */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.cardsRow}
      >
        {PHASES.map((phase, index) => {
          const isComplete =
            phase.id < currentPhase ||
            (phase.id === currentPhase && currentPhase === 5 && overallProgress >= 100);
          const isCurrent = phase.id === currentPhase && !isComplete;
          const isUpcoming = phase.id > currentPhase;

          return (
            <React.Fragment key={phase.id}>
              <PipelinePhaseCard
                phase={phase}
                isComplete={isComplete}
                isCurrent={isCurrent}
                isUpcoming={isUpcoming}
                progress={isCurrent ? phaseProgress : isComplete ? 100 : 0}
                onPress={onPhasePress ? () => onPhasePress(phase.id) : undefined}
              />
              {/* Connector line between cards */}
              {index < PHASES.length - 1 ? (
                <View style={styles.connectorWrap}>
                  <View
                    style={[
                      styles.connector,
                      {
                        backgroundColor: isComplete
                          ? phaseGradients[(phase.id as keyof typeof phaseGradients)] ?.[0] || '#4ADE80'
                          : isDark
                            ? 'rgba(255,255,255,0.18)'
                            : 'rgba(0,0,0,0.08)',
                      },
                    ]}
                  />
                  {isComplete ? (
                    <View
                      style={[
                        styles.connectorDot,
                        { backgroundColor: phaseGradients[(phase.id as keyof typeof phaseGradients)]?.[0] || '#4ADE80' },
                      ]}
                    />
                  ) : null}
                </View>
              ) : null}
            </React.Fragment>
          );
        })}
      </ScrollView>

      {/* Overall progress bar */}
      <View style={styles.progressSection}>
        <View
          style={[
            styles.progressTrack,
            { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' },
          ]}
        >
          <Animated.View style={[styles.progressFill, progressStyle]}>
            <LinearGradient
              colors={['#5CF6FF', '#0EA5A8']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={StyleSheet.absoluteFillObject}
            />
          </Animated.View>
        </View>
        <Text style={[styles.progressLabel, { color: colors.text.muted }]}>
          {Math.round(overallProgress)}% complete
        </Text>
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

const styles = StyleSheet.create({
  container: {
    gap: spacing.lg,
  },
  cardsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.sm,
    gap: 0,
  },
  connectorWrap: {
    width: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  connector: {
    height: 2,
    width: '100%',
    borderRadius: 1,
  },
  connectorDot: {
    position: 'absolute',
    width: 6,
    height: 6,
    borderRadius: 3,
    right: -1,
  },
  progressSection: {
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  progressTrack: {
    height: 4,
    borderRadius: borderRadius.full,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: borderRadius.full,
    overflow: 'hidden',
  },
  progressLabel: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily.body,
    fontWeight: typography.fontWeight.semibold as any,
    textAlign: 'center',
  },
});

const compactStyles = StyleSheet.create({
  container: {
    borderRadius: borderRadius.md,
    borderWidth: 1,
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
    fontWeight: typography.fontWeight.semibold as any,
  },
  progress: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily.mono,
    fontWeight: typography.fontWeight.bold as any,
  },
  track: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 2,
    overflow: 'hidden',
  },
});

export default PhaseIndicator;
