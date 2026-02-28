/**
 * Status Transition Animation Component
 *
 * Provides consistent animations for status transitions across the app.
 * Shows success animations (checkmark, confetti) for 1-2 seconds before transitioning.
 * Same animation timing and visual style for recorded and ElevenLabs voiceover.
 *
 * Requirements: 9.1-9.7, 9.10, 9.11
 */

import React, { useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, Modal } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  withSequence,
  withDelay,
  withSpring,
  runOnJS,
  Easing,
  FadeIn,
  FadeOut,
  ZoomIn,
  ZoomOut,
} from 'react-native-reanimated';
import { colors, typography, spacing, borderRadius, shadows } from '../../lib/theme';
import { triggerHaptic, HapticType } from '../../lib/haptics';

/**
 * Animation types for different status transitions
 */
export type TransitionAnimationType =
  | 'success'           // Green checkmark with confetti
  | 'processing'        // Spinning gear
  | 'error'             // Red X with shake
  | 'voiceover_ready'   // Microphone with sparkles
  | 'clips_ready'       // Film reel with sparkles
  | 'video_complete';   // Trophy with confetti

/**
 * Animation configuration for each transition type
 */
interface AnimationConfig {
  emoji: string;
  title: string;
  subtitle: string;
  backgroundColor: string;
  duration: number;
  hapticType: HapticType;
}

const ANIMATION_CONFIGS: Record<TransitionAnimationType, AnimationConfig> = {
  success: {
    emoji: '✅',
    title: 'Success!',
    subtitle: 'Moving to next step...',
    backgroundColor: colors.pastel.green,
    duration: 1500,
    hapticType: 'success',
  },
  processing: {
    emoji: '⚙️',
    title: 'Processing...',
    subtitle: 'Please wait',
    backgroundColor: colors.pastel.blue,
    duration: 0, // Indefinite
    hapticType: 'light',
  },
  error: {
    emoji: '❌',
    title: 'Something went wrong',
    subtitle: 'Please try again',
    backgroundColor: colors.pastel.pink,
    duration: 2000,
    hapticType: 'error',
  },
  voiceover_ready: {
    emoji: '🎙️',
    title: 'Voiceover Ready!',
    subtitle: 'You can now add video clips',
    backgroundColor: colors.pastel.green,
    duration: 1500,
    hapticType: 'success',
  },
  clips_ready: {
    emoji: '🎬',
    title: 'Clips Uploaded!',
    subtitle: 'Ready to start processing',
    backgroundColor: colors.pastel.blue,
    duration: 1500,
    hapticType: 'success',
  },
  video_complete: {
    emoji: '🏆',
    title: 'Video Complete!',
    subtitle: 'Your video is ready to view',
    backgroundColor: colors.pastel.yellow,
    duration: 2000,
    hapticType: 'success',
  },
};

export interface StatusTransitionAnimationProps {
  /** Whether the animation is visible */
  visible: boolean;
  /** Type of animation to show */
  type: TransitionAnimationType;
  /** Custom title (overrides default) */
  title?: string;
  /** Custom subtitle (overrides default) */
  subtitle?: string;
  /** Callback when animation completes */
  onComplete?: () => void;
  /** Whether to auto-dismiss after duration */
  autoDismiss?: boolean;
}

/**
 * Confetti particle component for success animations
 */
function ConfettiParticle({ delay, color }: { delay: number; color: string }) {
  const translateY = useSharedValue(-50);
  const translateX = useSharedValue(0);
  const opacity = useSharedValue(1);
  const rotation = useSharedValue(0);

  useEffect(() => {
    const randomX = (Math.random() - 0.5) * 200;
    const randomRotation = Math.random() * 720 - 360;

    translateY.value = withDelay(
      delay,
      withTiming(300, { duration: 1500, easing: Easing.out(Easing.quad) })
    );
    translateX.value = withDelay(
      delay,
      withTiming(randomX, { duration: 1500, easing: Easing.out(Easing.quad) })
    );
    rotation.value = withDelay(
      delay,
      withTiming(randomRotation, { duration: 1500 })
    );
    opacity.value = withDelay(
      delay + 1000,
      withTiming(0, { duration: 500 })
    );
  }, [delay, translateY, translateX, rotation, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: translateY.value },
      { translateX: translateX.value },
      { rotate: `${rotation.value}deg` },
    ],
    opacity: opacity.value,
  }));

  return (
    <Animated.View style={[styles.confettiParticle, { backgroundColor: color }, animatedStyle]} />
  );
}

/**
 * Confetti burst component
 */
function ConfettiBurst() {
  const confettiColors = [
    colors.primary.DEFAULT,
    colors.secondary.DEFAULT,
    colors.accent.DEFAULT,
    colors.success,
    colors.pastel.pink,
    colors.pastel.purple,
  ];

  const particles = Array.from({ length: 20 }, (_, i) => ({
    id: i,
    delay: Math.random() * 200,
    color: confettiColors[i % confettiColors.length],
  }));

  return (
    <View style={styles.confettiContainer}>
      {particles.map((particle) => (
        <ConfettiParticle
          key={particle.id}
          delay={particle.delay}
          color={particle.color}
        />
      ))}
    </View>
  );
}

/**
 * Status Transition Animation Component
 *
 * Requirements: 9.1-9.7, 9.10, 9.11
 * - Immediate animation on status transitions (no delay)
 * - Success animations for 1-2 seconds before transitioning
 * - Same animation timing and visual style for recorded and ElevenLabs voiceover
 */
export function StatusTransitionAnimation({
  visible,
  type,
  title,
  subtitle,
  onComplete,
  autoDismiss = true,
}: StatusTransitionAnimationProps) {
  const config = ANIMATION_CONFIGS[type];
  const scale = useSharedValue(0);
  const emojiScale = useSharedValue(0);

  // Trigger haptic feedback immediately when animation becomes visible
  // Requirements: 9.9 - Haptic feedback on state transitions
  useEffect(() => {
    if (visible) {
      triggerHaptic(config.hapticType);
      
      // Animate in
      scale.value = withSpring(1, { damping: 12, stiffness: 100 });
      emojiScale.value = withDelay(
        200,
        withSpring(1, { damping: 10, stiffness: 150 })
      );

      // Auto-dismiss after duration
      if (autoDismiss && config.duration > 0 && onComplete) {
        const timer = setTimeout(() => {
          onComplete();
        }, config.duration);
        return () => clearTimeout(timer);
      }
    } else {
      scale.value = 0;
      emojiScale.value = 0;
    }
  }, [visible, config, autoDismiss, onComplete, scale, emojiScale]);

  const containerStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: scale.value,
  }));

  const emojiStyle = useAnimatedStyle(() => ({
    transform: [{ scale: emojiScale.value }],
  }));

  if (!visible) return null;

  const showConfetti = ['success', 'voiceover_ready', 'video_complete'].includes(type);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        {showConfetti && <ConfettiBurst />}
        
        <Animated.View style={[styles.container, containerStyle]}>
          <View style={[styles.card, { backgroundColor: config.backgroundColor }]}>
            {/* Animated Emoji */}
            <Animated.View style={[styles.emojiContainer, emojiStyle]}>
              <Text style={styles.emoji}>{config.emoji}</Text>
            </Animated.View>

            {/* Title */}
            <Text style={styles.title}>{title || config.title}</Text>

            {/* Subtitle */}
            <Text style={styles.subtitle}>{subtitle || config.subtitle}</Text>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

/**
 * Sparkle animation for subtle success indicators
 */
export function SparkleAnimation({ visible }: { visible: boolean }) {
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.5);

  useEffect(() => {
    if (visible) {
      opacity.value = withSequence(
        withTiming(1, { duration: 200 }),
        withDelay(800, withTiming(0, { duration: 200 }))
      );
      scale.value = withSequence(
        withSpring(1.2, { damping: 8 }),
        withDelay(600, withTiming(0.5, { duration: 200 }))
      );
    }
  }, [visible, opacity, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  if (!visible) return null;

  return (
    <Animated.View style={[styles.sparkleContainer, animatedStyle]}>
      <Text style={styles.sparkle}>✨</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  container: {
    width: '85%',
    maxWidth: 320,
  },
  card: {
    borderRadius: borderRadius.xl,
    borderWidth: 3,
    borderColor: colors.border,
    padding: spacing['2xl'],
    alignItems: 'center',
    ...shadows.xl,
  },
  emojiContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.surface,
    borderWidth: 3,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
    ...shadows.md,
  },
  emoji: {
    fontSize: 40,
  },
  title: {
    fontSize: typography.fontSize['2xl'],
    fontWeight: '800',
    color: colors.text.DEFAULT,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  subtitle: {
    fontSize: typography.fontSize.base,
    color: colors.text.muted,
    textAlign: 'center',
  },
  confettiContainer: {
    position: 'absolute',
    top: '40%',
    left: '50%',
    width: 0,
    height: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confettiParticle: {
    position: 'absolute',
    width: 10,
    height: 10,
    borderRadius: 2,
  },
  sparkleContainer: {
    position: 'absolute',
    top: -10,
    right: -10,
  },
  sparkle: {
    fontSize: 24,
  },
});

export default StatusTransitionAnimation;
