/**
 * Neobrutalist Skeleton Component
 *
 * A skeleton loading component with bold borders
 * following the neobrutalist soft pop design style.
 */

import React, { useEffect } from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  interpolate,
} from 'react-native-reanimated';
import { colors, borderRadius, spacing } from '../../lib/theme';

export interface SkeletonProps {
  /** Width of the skeleton */
  width?: number | string;
  /** Height of the skeleton */
  height?: number;
  /** Border radius */
  radius?: keyof typeof borderRadius | number;
  /** Show border */
  bordered?: boolean;
  /** Custom style */
  style?: ViewStyle;
}

export function Skeleton({
  width = '100%',
  height = 20,
  radius = 'md',
  bordered = true,
  style,
}: SkeletonProps) {
  const shimmer = useSharedValue(0);

  useEffect(() => {
    shimmer.value = withRepeat(
      withTiming(1, { duration: 1500 }),
      -1,
      false
    );
  }, []);

  const animatedStyle = useAnimatedStyle(() => {
    const opacity = interpolate(shimmer.value, [0, 0.5, 1], [0.3, 0.6, 0.3]);
    return { opacity };
  });

  const radiusValue = typeof radius === 'number' ? radius : borderRadius[radius];

  return (
    <Animated.View
      style={[
        styles.skeleton,
        {
          width: width as any,
          height,
          borderRadius: radiusValue,
          borderWidth: bordered ? 2 : 0,
        },
        animatedStyle,
        style,
      ]}
    />
  );
}

/**
 * Skeleton Text - Multiple lines of skeleton text
 */
export interface SkeletonTextProps {
  /** Number of lines */
  lines?: number;
  /** Line height */
  lineHeight?: number;
  /** Gap between lines */
  gap?: number;
  /** Last line width percentage */
  lastLineWidth?: number;
}

export function SkeletonText({
  lines = 3,
  lineHeight = 16,
  gap = spacing.sm,
  lastLineWidth = 60,
}: SkeletonTextProps) {
  return (
    <View style={[styles.textContainer, { gap }]}>
      {Array.from({ length: lines }).map((_, index) => (
        <Skeleton
          key={index}
          height={lineHeight}
          width={index === lines - 1 ? `${lastLineWidth}%` : '100%'}
          radius="sm"
        />
      ))}
    </View>
  );
}

/**
 * Skeleton Avatar - Circular skeleton for avatars
 */
export interface SkeletonAvatarProps {
  /** Avatar size */
  size?: number;
}

export function SkeletonAvatar({ size = 48 }: SkeletonAvatarProps) {
  return (
    <Skeleton
      width={size}
      height={size}
      radius={size / 2}
    />
  );
}

/**
 * Skeleton Card - Card-shaped skeleton
 */
export interface SkeletonCardProps {
  /** Card height */
  height?: number;
  /** Show header */
  showHeader?: boolean;
  /** Show avatar in header */
  showAvatar?: boolean;
  /** Number of content lines */
  contentLines?: number;
}

export function SkeletonCard({
  height,
  showHeader = true,
  showAvatar = true,
  contentLines = 3,
}: SkeletonCardProps) {
  return (
    <View style={[styles.card, height ? { height } : undefined]}>
      {showHeader && (
        <View style={styles.cardHeader}>
          {showAvatar && <SkeletonAvatar size={40} />}
          <View style={styles.cardHeaderText}>
            <Skeleton height={14} width="60%" radius="sm" />
            <Skeleton height={12} width="40%" radius="sm" />
          </View>
        </View>
      )}
      <View style={styles.cardContent}>
        <SkeletonText lines={contentLines} />
      </View>
    </View>
  );
}

/**
 * Skeleton List Item - List item skeleton
 */
export interface SkeletonListItemProps {
  /** Show avatar */
  showAvatar?: boolean;
  /** Avatar size */
  avatarSize?: number;
  /** Number of text lines */
  lines?: number;
}

export function SkeletonListItem({
  showAvatar = true,
  avatarSize = 48,
  lines = 2,
}: SkeletonListItemProps) {
  return (
    <View style={styles.listItem}>
      {showAvatar && <SkeletonAvatar size={avatarSize} />}
      <View style={styles.listItemContent}>
        <SkeletonText lines={lines} lineHeight={14} gap={spacing.xs} />
      </View>
    </View>
  );
}

/**
 * Skeleton Image - Image placeholder skeleton
 */
export interface SkeletonImageProps {
  /** Image width */
  width?: number | string;
  /** Image height */
  height?: number;
  /** Aspect ratio (overrides height) */
  aspectRatio?: number;
}

export function SkeletonImage({
  width = '100%',
  height = 200,
  aspectRatio,
}: SkeletonImageProps) {
  return (
    <Skeleton
      width={width}
      height={aspectRatio ? undefined : height}
      radius="lg"
      style={aspectRatio ? { aspectRatio } : undefined}
    />
  );
}

const styles = StyleSheet.create({
  skeleton: {
    backgroundColor: colors.background,
    borderColor: colors.border,
  },
  textContainer: {
    width: '100%',
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    shadowColor: '#000000',
    shadowOffset: { width: 4, height: 4 },
    shadowOpacity: 1,
    shadowRadius: 0,
    elevation: 4,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  cardHeaderText: {
    flex: 1,
    gap: spacing.xs,
  },
  cardContent: {
    flex: 1,
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  listItemContent: {
    flex: 1,
  },
});

export default Skeleton;
