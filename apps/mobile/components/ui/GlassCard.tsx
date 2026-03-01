/**
 * GlassCard
 *
 * 3D glass card wrapper with perspective transforms and depth effects.
 * Used for pipeline phase cards and elevated sections.
 */

import React, { useEffect } from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '@/contexts/ThemeContext';
import { borderRadius, spacing, motion } from '@/lib/theme';

interface GlassCardProps {
  children: React.ReactNode;
  depth?: 'subtle' | 'medium' | 'deep';
  glowColor?: string;
  active?: boolean;
  gradient?: readonly [string, string];
  style?: StyleProp<ViewStyle>;
  enterDelay?: number;
}

const DEPTH_CONFIG = {
  subtle: {
    perspective: 1200,
    rotateY: '0deg',
    scale: 1,
    shadowRadius: 8,
    shadowOpacity: 0.1,
  },
  medium: {
    perspective: 800,
    rotateY: '2deg',
    scale: 1,
    shadowRadius: 16,
    shadowOpacity: 0.15,
  },
  deep: {
    perspective: 600,
    rotateY: '4deg',
    scale: 1,
    shadowRadius: 24,
    shadowOpacity: 0.2,
  },
} as const;

export function GlassCard({
  children,
  depth = 'subtle',
  glowColor,
  active = false,
  gradient,
  style,
  enterDelay = 0,
}: GlassCardProps) {
  const { isDark } = useTheme();
  const config = DEPTH_CONFIG[depth];
  const scale = useSharedValue(active ? 1.02 : 1);

  useEffect(() => {
    scale.value = withSpring(active ? 1.02 : 1, motion.spring.soft);
  }, [active, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { perspective: config.perspective },
      { scale: scale.value },
    ],
  }));

  const shadowColor = glowColor || (isDark ? '#5CF6FF' : '#000');

  return (
    <Animated.View
      entering={FadeInDown.delay(enterDelay).duration(400).springify()}
      style={[
        styles.container,
        {
          backgroundColor: isDark
            ? 'rgba(255,255,255,0.05)'
            : 'rgba(255,255,255,0.9)',
          borderColor: isDark
            ? 'rgba(255,255,255,0.08)'
            : 'rgba(0,0,0,0.06)',
          shadowColor,
          shadowOpacity: active ? config.shadowOpacity * 1.5 : config.shadowOpacity,
          shadowRadius: active ? config.shadowRadius * 1.2 : config.shadowRadius,
        },
        animatedStyle,
        style,
      ]}
    >
      {gradient ? (
        <LinearGradient
          colors={[...gradient]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[StyleSheet.absoluteFillObject, { borderRadius: borderRadius.lg, opacity: isDark ? 0.2 : 0.08 }]}
        />
      ) : null}
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    padding: spacing.lg,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
    overflow: 'hidden',
  },
});

export default GlassCard;
