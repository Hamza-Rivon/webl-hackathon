/**
 * PipelinePhaseCard
 *
 * Individual 3D card for a single pipeline phase.
 * Features gradient backgrounds, glow effects, pulse animation, and depth.
 */

import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@/components/ui/SymbolIcon';
import { useTheme } from '@/contexts/ThemeContext';
import { borderRadius, motion, spacing, typography, phaseGradients } from '@/lib/theme';
import { triggerHaptic } from '@/lib/haptics';

interface PipelinePhaseCardProps {
  phase: {
    id: number;
    label: string;
    icon: keyof typeof Ionicons.glyphMap;
    description: string;
  };
  isComplete: boolean;
  isCurrent: boolean;
  isUpcoming: boolean;
  progress?: number;
  onPress?: () => void;
}

export function PipelinePhaseCard({
  phase,
  isComplete,
  isCurrent,
  isUpcoming,
  progress = 0,
  onPress,
}: PipelinePhaseCardProps) {
  const { isDark } = useTheme();
  const scale = useSharedValue(1);
  const glowOpacity = useSharedValue(0);
  const ringRotation = useSharedValue(0);

  // Pulse animation for active phase
  useEffect(() => {
    if (isCurrent) {
      scale.value = withRepeat(
        withSequence(
          withTiming(1.04, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
          withTiming(1.0, { duration: 1200, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        true
      );
      glowOpacity.value = withRepeat(
        withSequence(
          withTiming(0.6, { duration: 1200 }),
          withTiming(0.25, { duration: 1200 })
        ),
        -1,
        true
      );
      ringRotation.value = withRepeat(
        withTiming(360, { duration: 3000, easing: Easing.linear }),
        -1
      );
    } else {
      scale.value = withSpring(1, motion.spring.soft);
      glowOpacity.value = withTiming(0, { duration: 300 });
      ringRotation.value = 0;
    }
  }, [isCurrent, glowOpacity, ringRotation, scale]);

  const containerStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const glowStyle = useAnimatedStyle(() => ({
    opacity: glowOpacity.value,
  }));

  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${ringRotation.value}deg` }],
  }));

  const gradient = phaseGradients[phase.id as keyof typeof phaseGradients] || phaseGradients[1];

  const handlePress = () => {
    if (onPress) {
      triggerHaptic('light');
      onPress();
    }
  };

  return (
    <Pressable onPress={handlePress} disabled={!onPress}>
      <Animated.View
        style={[
          styles.card,
          isUpcoming && styles.cardUpcoming,
          {
            backgroundColor: isDark
              ? 'rgba(255,255,255,0.05)'
              : 'rgba(255,255,255,0.95)',
            borderColor: isDark
              ? isCurrent
                ? gradient[0]
                : 'rgba(255,255,255,0.08)'
              : isCurrent
                ? gradient[0]
                : 'rgba(0,0,0,0.06)',
            borderWidth: isCurrent ? 1.5 : 1,
          },
          containerStyle,
        ]}
      >
        {/* Gradient overlay */}
        <LinearGradient
          colors={[...gradient]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[
            StyleSheet.absoluteFillObject,
            {
              borderRadius: borderRadius.lg,
              opacity: isComplete ? (isDark ? 0.25 : 0.1) : isCurrent ? (isDark ? 0.2 : 0.08) : 0.03,
            },
          ]}
        />

        {/* Glow ring for active */}
        {isCurrent ? (
          <Animated.View
            style={[
              styles.glowRing,
              { borderColor: gradient[0] },
              glowStyle,
              ringStyle,
            ]}
          />
        ) : null}

        {/* Icon container */}
        <View
          style={[
            styles.iconContainer,
            {
              backgroundColor: isComplete
                ? gradient[0]
                : isCurrent
                  ? gradient[0]
                  : isDark
                    ? 'rgba(255,255,255,0.08)'
                    : 'rgba(0,0,0,0.05)',
            },
          ]}
        >
          {isComplete ? (
            <Ionicons name="checkmark" size={18} color="#FFFFFF" />
          ) : (
            <Ionicons
              name={phase.icon}
              size={18}
              color={isCurrent ? '#FFFFFF' : isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.4)'}
            />
          )}
        </View>

        {/* Label */}
        <Text
          style={[
            styles.label,
            {
              color: isComplete
                ? gradient[0]
                : isCurrent
                  ? isDark
                    ? '#FFFFFF'
                    : gradient[0]
                  : isDark
                    ? 'rgba(255,255,255,0.55)'
                    : 'rgba(0,0,0,0.35)',
            },
          ]}
          numberOfLines={1}
        >
          {phase.label}
        </Text>

        {/* Status */}
        <Text
          style={[
            styles.status,
            {
              color: isComplete
                ? gradient[0]
                : isCurrent
                  ? isDark
                    ? 'rgba(255,255,255,0.7)'
                    : gradient[1]
                  : isDark
                    ? 'rgba(255,255,255,0.4)'
                    : 'rgba(0,0,0,0.2)',
            },
          ]}
        >
          {isComplete ? 'Done' : isCurrent ? `${progress}%` : '—'}
        </Text>

        {/* Progress bar for current */}
        {isCurrent && progress > 0 ? (
          <View style={styles.progressTrack}>
            <LinearGradient
              colors={[...gradient]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={[styles.progressFill, { width: `${Math.min(progress, 100)}%` }]}
            />
          </View>
        ) : null}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 88,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    alignItems: 'center',
    gap: spacing.xs + 2,
    overflow: 'hidden',
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 12,
    shadowOpacity: 0.1,
    elevation: 4,
  },
  cardUpcoming: {
    opacity: 0.55,
  },
  glowRing: {
    position: 'absolute',
    top: -2,
    left: -2,
    right: -2,
    bottom: -2,
    borderRadius: borderRadius.lg + 2,
    borderWidth: 2,
    borderStyle: 'dashed',
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontFamily: typography.fontFamily.heading,
    fontSize: 11,
    fontWeight: typography.fontWeight.bold as any,
    textAlign: 'center',
  },
  status: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 10,
    fontWeight: typography.fontWeight.semibold as any,
  },
  progressTrack: {
    width: '100%',
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(0,0,0,0.08)',
    overflow: 'hidden',
    marginTop: 2,
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
  },
});

export default PipelinePhaseCard;
