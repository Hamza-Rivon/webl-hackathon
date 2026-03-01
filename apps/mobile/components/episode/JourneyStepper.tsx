/**
 * Journey Stepper Component
 *
 * Visual step indicator for the episode creation flow.
 * Shows progress through template, script, voiceover, clips, processing, and final.
 */

import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { colors, typography, spacing, borderRadius } from '../../lib/theme';
import { useTheme } from '../../contexts/ThemeContext';
import {
  JOURNEY_STEPS,
  JourneyStep,
  JourneyStepConfig,
  getStepIndex,
} from '../../stores/episodeJourney';
import { triggerHaptic } from '../../lib/haptics';

interface JourneyStepWithState {
  id: JourneyStep;
  label: string;
  emoji: string;
  isComplete: boolean;
  isCurrent: boolean;
  isUpcoming: boolean;
  isClickable: boolean;
}

interface JourneyStepperProps {
  currentStep: JourneyStep;
  completedSteps: JourneyStep[];
  onStepPress?: (step: JourneyStep) => void;
  compact?: boolean;
}

export function JourneyStepper({
  currentStep,
  completedSteps,
  onStepPress,
  compact = false,
}: JourneyStepperProps) {
  const currentIndex = getStepIndex(currentStep);

  // Build steps with state
  const stepsWithState: JourneyStepWithState[] = JOURNEY_STEPS.map((step) => {
    const stepIndex = getStepIndex(step.id);
    const isComplete = completedSteps.includes(step.id) || stepIndex < currentIndex;
    const isCurrent = step.id === currentStep;
    const isUpcoming = stepIndex > currentIndex;
    const isClickable = isComplete || isCurrent;

    return {
      ...step,
      isComplete,
      isCurrent,
      isUpcoming,
      isClickable,
    };
  });

  // For compact mode, show only current and adjacent steps
  const visibleSteps = compact
    ? stepsWithState.slice(
        Math.max(0, currentIndex - 1),
        Math.min(stepsWithState.length, currentIndex + 3)
      )
    : stepsWithState;

  return (
    <View style={styles.container}>
      <View style={[styles.stepsContainer, compact && styles.stepsContainerCompact]}>
        {visibleSteps.map((step, index) => (
          <React.Fragment key={step.id}>
            <StepItem
              step={step}
              onPress={onStepPress}
              compact={compact}
            />
            {index < visibleSteps.length - 1 && (
              <StepConnector isComplete={step.isComplete} />
            )}
          </React.Fragment>
        ))}
      </View>

      {/* Progress indicator */}
      {!compact && (
        <View style={styles.progressContainer}>
          <View style={styles.progressTrack}>
            <Animated.View
              style={[
                styles.progressFill,
                { width: `${(currentIndex / (JOURNEY_STEPS.length - 1)) * 100}%` },
              ]}
            />
          </View>
          <Text style={styles.progressText}>
            Step {currentIndex + 1} of {JOURNEY_STEPS.length}
          </Text>
        </View>
      )}
    </View>
  );
}

interface StepItemProps {
  step: JourneyStepWithState;
  onPress?: (step: JourneyStep) => void;
  compact: boolean;
}

function StepItem({ step, onPress, compact }: StepItemProps) {
  const handlePress = () => {
    if (step.isClickable && onPress) {
      triggerHaptic('light');
      onPress(step.id);
    }
  };

  return (
    <Pressable
      onPress={handlePress}
      disabled={!step.isClickable}
      style={[
        styles.stepItem,
        compact && styles.stepItemCompact,
      ]}
    >
      <View
        style={[
          styles.stepCircle,
          step.isComplete && styles.stepCircleComplete,
          step.isCurrent && styles.stepCircleCurrent,
          step.isUpcoming && styles.stepCircleUpcoming,
        ]}
      >
        {step.isComplete ? (
          <Text style={styles.stepCheckmark}>✓</Text>
        ) : (
          <Text style={styles.stepEmoji}>{step.emoji}</Text>
        )}
      </View>
      {!compact && (
        <Text
          style={[
            styles.stepLabel,
            step.isCurrent && styles.stepLabelCurrent,
            step.isUpcoming && styles.stepLabelUpcoming,
          ]}
          numberOfLines={1}
        >
          {step.label}
        </Text>
      )}
    </Pressable>
  );
}

interface StepConnectorProps {
  isComplete: boolean;
}

function StepConnector({ isComplete }: StepConnectorProps) {
  return (
    <View style={styles.connectorContainer}>
      <View
        style={[
          styles.connector,
          isComplete && styles.connectorComplete,
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  stepsContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  stepsContainerCompact: {
    justifyContent: 'flex-start',
  },
  stepItem: {
    alignItems: 'center',
    minWidth: 60,
    maxWidth: 80,
  },
  stepItemCompact: {
    minWidth: 40,
    maxWidth: 50,
  },
  stepCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surface,
    borderWidth: 3,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepCircleComplete: {
    backgroundColor: colors.success,
    borderColor: colors.success,
  },
  stepCircleCurrent: {
    backgroundColor: colors.primary.DEFAULT,
    borderColor: colors.primary.DEFAULT,
  },
  stepCircleUpcoming: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    opacity: 0.5,
  },
  stepEmoji: {
    fontSize: 18,
  },
  stepCheckmark: {
    fontSize: 18,
    color: colors.surface,
    fontWeight: '700',
  },
  stepLabel: {
    fontSize: typography.fontSize.xs,
    fontWeight: '600',
    color: colors.text.DEFAULT,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  stepLabelCurrent: {
    color: colors.primary.DEFAULT,
    fontWeight: '700',
  },
  stepLabelUpcoming: {
    color: colors.text.muted,
    opacity: 0.5,
  },
  connectorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
    paddingTop: 20, // Align with center of step circle
  },
  connector: {
    height: 3,
    width: '100%',
    backgroundColor: colors.border,
    borderRadius: 1.5,
  },
  connectorComplete: {
    backgroundColor: colors.success,
  },
  progressContainer: {
    marginTop: spacing.lg,
    alignItems: 'center',
  },
  progressTrack: {
    width: '100%',
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.primary.DEFAULT,
    borderRadius: 2,
  },
  progressText: {
    fontSize: typography.fontSize.sm,
    color: colors.text.muted,
    fontWeight: '600',
    marginTop: spacing.sm,
  },
});

/**
 * Compact horizontal stepper for inline use
 */
export function JourneyStepperCompact({
  currentStep,
  completedSteps,
}: {
  currentStep: JourneyStep;
  completedSteps: JourneyStep[];
}) {
  const currentIndex = getStepIndex(currentStep);
  const progress = (currentIndex / (JOURNEY_STEPS.length - 1)) * 100;
  const currentConfig = JOURNEY_STEPS.find((s) => s.id === currentStep);

  return (
    <Animated.View entering={FadeInDown.duration(300)} style={compactStyles.container}>
      <View style={compactStyles.header}>
        <Text style={compactStyles.emoji}>{currentConfig?.emoji}</Text>
        <Text style={compactStyles.label}>{currentConfig?.label}</Text>
        <Text style={compactStyles.progress}>{currentIndex + 1}/{JOURNEY_STEPS.length}</Text>
      </View>
      <View style={compactStyles.progressTrack}>
        <View style={[compactStyles.progressFill, { width: `${progress}%` }]} />
      </View>
    </Animated.View>
  );
}

const compactStyles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    borderWidth: 2,
    borderColor: colors.border,
    padding: spacing.md,
    marginHorizontal: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  emoji: {
    fontSize: 18,
    marginRight: spacing.sm,
  },
  label: {
    flex: 1,
    fontSize: typography.fontSize.sm,
    fontWeight: '700',
    color: colors.text.DEFAULT,
  },
  progress: {
    fontSize: typography.fontSize.xs,
    fontWeight: '600',
    color: colors.text.muted,
  },
  progressTrack: {
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.primary.DEFAULT,
    borderRadius: 2,
  },
});

export default JourneyStepper;
