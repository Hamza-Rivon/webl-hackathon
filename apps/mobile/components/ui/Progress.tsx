/**
 * Neobrutalist Progress Component
 *
 * A progress bar component with bold borders and offset shadows
 * following the neobrutalist soft pop design style.
 */

import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { colors, typography, spacing, borderRadius } from '../../lib/theme';

export type ProgressVariant = 'primary' | 'secondary' | 'success' | 'warning' | 'error';
export type ProgressSize = 'sm' | 'md' | 'lg';

export interface ProgressProps {
  /** Progress value (0-100) */
  value: number;
  /** Maximum value */
  max?: number;
  /** Progress bar variant */
  variant?: ProgressVariant;
  /** Progress bar size */
  size?: ProgressSize;
  /** Show percentage label */
  showLabel?: boolean;
  /** Custom label */
  label?: string;
  /** Animate progress changes */
  animated?: boolean;
  /** Indeterminate state (loading) */
  indeterminate?: boolean;
}

const variantColors: Record<ProgressVariant, string> = {
  primary: colors.primary.DEFAULT,
  secondary: colors.secondary.DEFAULT,
  success: colors.success,
  warning: colors.warning,
  error: colors.error,
};

const sizeStyles: Record<ProgressSize, { height: number; borderWidth: number }> = {
  sm: { height: 8, borderWidth: 1 },
  md: { height: 12, borderWidth: 2 },
  lg: { height: 16, borderWidth: 2 },
};

export function Progress({
  value,
  max = 100,
  variant = 'primary',
  size = 'md',
  showLabel = false,
  label,
  animated = true,
  indeterminate = false,
}: ProgressProps) {
  const progress = useSharedValue(0);
  const indeterminateAnim = useSharedValue(0);

  const percentage = Math.min(Math.max((value / max) * 100, 0), 100);
  const sizeStyle = sizeStyles[size];
  const fillColor = variantColors[variant];

  useEffect(() => {
    if (!indeterminate) {
      if (animated) {
        progress.value = withSpring(percentage, { damping: 15, stiffness: 100 });
      } else {
        progress.value = percentage;
      }
    }
  }, [percentage, animated, indeterminate]);

  useEffect(() => {
    if (indeterminate) {
      const animate = () => {
        indeterminateAnim.value = withTiming(1, { duration: 1000 }, () => {
          indeterminateAnim.value = 0;
          animate();
        });
      };
      animate();
    }
  }, [indeterminate]);

  const fillStyle = useAnimatedStyle(() => {
    if (indeterminate) {
      return {
        width: '30%',
        transform: [
          { translateX: indeterminateAnim.value * 300 - 100 },
        ],
      };
    }
    return {
      width: `${progress.value}%`,
    };
  });

  return (
    <View style={styles.container}>
      {(showLabel || label) && (
        <View style={styles.labelContainer}>
          {label && <Text style={styles.label}>{label}</Text>}
          {showLabel && !indeterminate && (
            <Text style={styles.percentage}>{Math.round(percentage)}%</Text>
          )}
        </View>
      )}
      <View
        style={[
          styles.track,
          {
            height: sizeStyle.height,
            borderWidth: sizeStyle.borderWidth,
          },
        ]}
      >
        <Animated.View
          style={[
            styles.fill,
            { backgroundColor: fillColor },
            fillStyle,
          ]}
        />
      </View>
    </View>
  );
}

/**
 * Circular Progress Component
 */
export interface CircularProgressProps {
  /** Progress value (0-100) */
  value: number;
  /** Circle size */
  size?: number;
  /** Stroke width */
  strokeWidth?: number;
  /** Progress variant */
  variant?: ProgressVariant;
  /** Show percentage in center */
  showLabel?: boolean;
}

export function CircularProgress({
  value,
  size = 64,
  strokeWidth = 4,
  variant = 'primary',
  showLabel = true,
}: CircularProgressProps) {
  const percentage = Math.min(Math.max(value, 0), 100);
  const fillColor = variantColors[variant];
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (percentage / 100) * circumference;

  return (
    <View style={[styles.circularContainer, { width: size, height: size }]}>
      {/* Background circle */}
      <View
        style={[
          styles.circularTrack,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            borderWidth: strokeWidth,
          },
        ]}
      />
      {/* Progress indicator (simplified - using View instead of SVG) */}
      <View
        style={[
          styles.circularFill,
          {
            width: size - strokeWidth * 2,
            height: size - strokeWidth * 2,
            borderRadius: (size - strokeWidth * 2) / 2,
            backgroundColor: fillColor,
            opacity: percentage / 100,
          },
        ]}
      />
      {showLabel && (
        <View style={styles.circularLabel}>
          <Text style={styles.circularLabelText}>{Math.round(percentage)}%</Text>
        </View>
      )}
    </View>
  );
}

/**
 * Step Progress Component
 */
export interface StepProgressProps {
  /** Current step (1-indexed) */
  currentStep: number;
  /** Total number of steps */
  totalSteps: number;
  /** Step labels */
  labels?: string[];
  /** Progress variant */
  variant?: ProgressVariant;
}

export function StepProgress({
  currentStep,
  totalSteps,
  labels,
  variant = 'primary',
}: StepProgressProps) {
  const fillColor = variantColors[variant];

  return (
    <View style={styles.stepContainer}>
      <View style={styles.stepTrack}>
        {Array.from({ length: totalSteps }).map((_, index) => {
          const isCompleted = index < currentStep;
          const isCurrent = index === currentStep - 1;
          return (
            <React.Fragment key={index}>
              {index > 0 && (
                <View
                  style={[
                    styles.stepLine,
                    isCompleted && { backgroundColor: fillColor },
                  ]}
                />
              )}
              <View
                style={[
                  styles.stepDot,
                  isCompleted && { backgroundColor: fillColor, borderColor: fillColor },
                  isCurrent && { borderColor: fillColor },
                ]}
              >
                {isCompleted && <Text style={styles.stepCheck}>✓</Text>}
              </View>
            </React.Fragment>
          );
        })}
      </View>
      {labels && (
        <View style={styles.stepLabels}>
          {labels.map((label, index) => (
            <Text
              key={index}
              style={[
                styles.stepLabel,
                index < currentStep && styles.stepLabelCompleted,
              ]}
              numberOfLines={1}
            >
              {label}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  labelContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  label: {
    fontSize: typography.fontSize.sm,
    fontWeight: '600',
    color: colors.text.DEFAULT,
  },
  percentage: {
    fontSize: typography.fontSize.sm,
    fontWeight: '600',
    color: colors.text.muted,
  },
  track: {
    width: '100%',
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: borderRadius.full,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: borderRadius.full,
  },
  // Circular progress styles
  circularContainer: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  circularTrack: {
    position: 'absolute',
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  circularFill: {
    position: 'absolute',
  },
  circularLabel: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  circularLabelText: {
    fontSize: typography.fontSize.sm,
    fontWeight: '700',
    color: colors.text.DEFAULT,
  },
  // Step progress styles
  stepContainer: {
    width: '100%',
  },
  stepTrack: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stepLine: {
    flex: 1,
    height: 2,
    backgroundColor: colors.border,
    marginHorizontal: spacing.xs,
  },
  stepDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepCheck: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.surface,
  },
  stepLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  stepLabel: {
    fontSize: typography.fontSize.xs,
    color: colors.text.muted,
    textAlign: 'center',
    flex: 1,
  },
  stepLabelCompleted: {
    color: colors.text.DEFAULT,
    fontWeight: '600',
  },
});

export default Progress;
