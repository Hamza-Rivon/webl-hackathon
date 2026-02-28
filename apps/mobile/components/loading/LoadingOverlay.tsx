/**
 * Loading Overlay Component
 *
 * Full-screen loading overlay with animated spinner.
 */

import React, { useEffect } from 'react';
import { View, Text, StyleSheet, Modal } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  Easing,
  FadeIn,
  FadeOut,
} from 'react-native-reanimated';
import { colors, typography, spacing, borderRadius } from '../../lib/theme';

interface LoadingOverlayProps {
  visible: boolean;
  message?: string;
  transparent?: boolean;
}

export function LoadingOverlay({
  visible,
  message = 'Loading...',
  transparent = false,
}: LoadingOverlayProps) {
  const rotation = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      rotation.value = withRepeat(
        withTiming(360, { duration: 1000, easing: Easing.linear }),
        -1,
        false
      );
    } else {
      rotation.value = 0;
    }
  }, [visible]);

  const spinStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  if (!visible) return null;

  return (
    <Modal transparent visible={visible} animationType="fade">
      <View style={[styles.overlay, transparent && styles.overlayTransparent]}>
        <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(200)}>
          <View style={styles.content}>
            <Animated.View style={[styles.spinner, spinStyle]}>
              <Text style={styles.spinnerEmoji}>⚡</Text>
            </Animated.View>
            <Text style={styles.message}>{message}</Text>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlayTransparent: {
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
  },
  content: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xl,
    borderWidth: 3,
    borderColor: colors.border,
    padding: spacing['2xl'],
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 4, height: 4 },
    shadowOpacity: 1,
    shadowRadius: 0,
    elevation: 10,
  },
  spinner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.primary.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  spinnerEmoji: {
    fontSize: 28,
  },
  message: {
    fontSize: typography.fontSize.base,
    fontWeight: '600',
    color: colors.text.DEFAULT,
    textAlign: 'center',
  },
});

/**
 * Inline loading spinner for buttons and small areas
 * Only spins when explicitly enabled
 */
export function InlineSpinner({ 
  size = 20, 
  color = colors.primary.DEFAULT,
  enabled = true 
}: { 
  size?: number; 
  color?: string;
  enabled?: boolean;
}) {
  const rotation = useSharedValue(0);

  useEffect(() => {
    if (enabled) {
      rotation.value = withRepeat(
        withTiming(360, { duration: 1000, easing: Easing.linear }),
        -1,
        false
      );
    } else {
      rotation.value = 0;
    }
  }, [enabled]);

  const spinStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  if (!enabled) return null;

  return (
    <Animated.View
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 2,
          borderColor: color,
          borderTopColor: 'transparent',
        },
        spinStyle,
      ]}
    />
  );
}

export default LoadingOverlay;
