/**
 * SegmentedControl
 *
 * Animated segmented control with sliding indicator.
 * Theme-aware, spring physics, glass background.
 */

import React, { useCallback, useEffect } from 'react';
import { LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useTheme } from '@/contexts/ThemeContext';
import { borderRadius, spacing, typography, motion } from '@/lib/theme';
import { triggerHaptic } from '@/lib/haptics';

export interface SegmentedControlOption {
  label: string;
  badge?: string;
}

interface SegmentedControlProps {
  options: SegmentedControlOption[];
  selectedIndex: number;
  onSelect: (index: number) => void;
}

export function SegmentedControl({
  options,
  selectedIndex,
  onSelect,
}: SegmentedControlProps) {
  const { colors, isDark } = useTheme();
  const translateX = useSharedValue(0);
  const segmentWidth = useSharedValue(0);
  const containerWidth = useSharedValue(0);

  const onContainerLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const w = e.nativeEvent.layout.width;
      containerWidth.value = w;
      const sw = w / options.length;
      segmentWidth.value = sw;
      translateX.value = withSpring(selectedIndex * sw, motion.spring.crisp);
    },
    [containerWidth, options.length, segmentWidth, selectedIndex, translateX]
  );

  useEffect(() => {
    if (segmentWidth.value > 0) {
      translateX.value = withSpring(
        selectedIndex * segmentWidth.value,
        motion.spring.crisp
      );
    }
  }, [selectedIndex, segmentWidth, translateX]);

  const indicatorStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
    width: segmentWidth.value,
  }));

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: isDark
            ? 'rgba(255,255,255,0.08)'
            : 'rgba(0,0,0,0.05)',
        },
      ]}
      onLayout={onContainerLayout}
    >
      <Animated.View
        style={[
          styles.indicator,
          {
            backgroundColor: isDark
              ? 'rgba(255,255,255,0.15)'
              : '#FFFFFF',
            shadowColor: isDark ? '#5CF6FF' : '#000',
            shadowOpacity: isDark ? 0.2 : 0.08,
          },
          indicatorStyle,
        ]}
      />
      {options.map((option, index) => (
        <Pressable
          key={option.label}
          style={styles.segment}
          onPress={() => {
            triggerHaptic('light');
            onSelect(index);
          }}
        >
          <Text
            style={[
              styles.label,
              {
                color:
                  selectedIndex === index
                    ? isDark
                      ? '#FFFFFF'
                      : colors.text.DEFAULT
                    : isDark
                      ? 'rgba(255,255,255,0.65)'
                      : colors.text.muted,
                fontWeight:
                  selectedIndex === index
                    ? (typography.fontWeight.bold as any)
                    : (typography.fontWeight.medium as any),
              },
            ]}
          >
            {option.label}
          </Text>
          {option.badge ? (
            <View
              style={[
                styles.badge,
                {
                  backgroundColor: isDark
                    ? 'rgba(92,246,255,0.2)'
                    : 'rgba(14,165,168,0.12)',
                },
              ]}
            >
              <Text
                style={[
                  styles.badgeText,
                  {
                    color: isDark ? '#5CF6FF' : colors.primary.DEFAULT,
                  },
                ]}
              >
                {option.badge}
              </Text>
            </View>
          ) : null}
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    borderRadius: borderRadius.md,
    padding: 3,
    position: 'relative',
  },
  indicator: {
    position: 'absolute',
    top: 3,
    bottom: 3,
    borderRadius: borderRadius.sm,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
    elevation: 3,
  },
  segment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm + 2,
    gap: spacing.xs,
    zIndex: 1,
  },
  label: {
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: borderRadius.full,
  },
  badgeText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 10,
    fontWeight: '700',
  },
});

export default SegmentedControl;
