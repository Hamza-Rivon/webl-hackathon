/**
 * Beat Progress Indicator Component
 *
 * Displays progress through script beats during recording.
 * Requirements: 9.5
 */

import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Animated, {
  useAnimatedStyle,
  withSpring,
  FadeIn,
} from 'react-native-reanimated';
import { colors, typography, spacing, borderRadius } from '../../lib/theme';
import { triggerHaptic } from '../../lib/haptics';

export interface BeatInfo {
  index: number;
  type: string;
  duration: number;
  isRecorded: boolean;
}

export interface BeatProgressIndicatorProps {
  /** All beats in the script */
  beats: BeatInfo[];
  /** Currently active beat index */
  currentBeatIndex: number;
  /** Whether recording is in progress */
  isRecording: boolean;
  /** Callback when a beat is tapped (for retake) */
  onBeatPress?: (beatIndex: number) => void;
  /** Whether beats are tappable */
  interactive?: boolean;
}

// Beat type colors
const beatTypeColors: Record<string, string> = {
  hook: colors.pastel.pink,
  problem: colors.pastel.orange,
  solution: colors.pastel.yellow,
  proof: colors.pastel.blue,
  cta: colors.pastel.green,
  intro: colors.pastel.purple,
  outro: colors.pastel.purple,
  content: colors.pastel.blue,
};

export function BeatProgressIndicator({
  beats,
  currentBeatIndex,
  isRecording,
  onBeatPress,
  interactive = true,
}: BeatProgressIndicatorProps) {
  const recordedCount = beats.filter((b) => b.isRecorded).length;
  const totalCount = beats.length;
  const progressPercent = totalCount > 0 ? (recordedCount / totalCount) * 100 : 0;

  return (
    <View style={styles.container}>
      {/* Progress Summary */}
      <View style={styles.summaryRow}>
        <Text style={styles.summaryText}>
          {recordedCount}/{totalCount} beats
        </Text>
        <Text style={styles.progressPercent}>{Math.round(progressPercent)}%</Text>
      </View>

      {/* Progress Bar */}
      <View style={styles.progressTrack}>
        <Animated.View
          style={[
            styles.progressFill,
            { width: `${progressPercent}%` },
          ]}
        />
      </View>

      {/* Beat Indicators */}
      <View style={styles.beatsRow}>
        {beats.map((beat, index) => (
          <BeatDot
            key={index}
            beat={beat}
            isCurrent={index === currentBeatIndex}
            isRecording={isRecording && index === currentBeatIndex}
            onPress={
              interactive && beat.isRecorded && onBeatPress
                ? () => onBeatPress(index)
                : undefined
            }
          />
        ))}
      </View>

      {/* Current Beat Info */}
      {currentBeatIndex < beats.length && (
        <Animated.View entering={FadeIn.duration(200)} style={styles.currentBeatInfo}>
          <Text style={styles.currentBeatLabel}>
            {isRecording ? 'Recording' : 'Next'}: Beat {currentBeatIndex + 1}
          </Text>
          <Text style={styles.currentBeatType}>
            {beats[currentBeatIndex].type.charAt(0).toUpperCase() +
              beats[currentBeatIndex].type.slice(1)}
          </Text>
          <Text style={styles.currentBeatDuration}>
            ~{beats[currentBeatIndex].duration}s
          </Text>
        </Animated.View>
      )}
    </View>
  );
}

/**
 * Individual Beat Dot
 */
interface BeatDotProps {
  beat: BeatInfo;
  isCurrent: boolean;
  isRecording: boolean;
  onPress?: () => void;
}

function BeatDot({ beat, isCurrent, isRecording, onPress }: BeatDotProps) {
  const bgColor = beatTypeColors[beat.type] || colors.pastel.blue;

  const animatedStyle = useAnimatedStyle(() => {
    return {
      transform: [
        { scale: withSpring(isCurrent ? 1.3 : 1, { damping: 15, stiffness: 300 }) },
      ],
    };
  });

  const handlePress = () => {
    if (onPress) {
      triggerHaptic('selection');
      onPress();
    }
  };

  const content = (
    <Animated.View
      style={[
        styles.beatDot,
        { backgroundColor: beat.isRecorded ? colors.success : bgColor },
        isCurrent && styles.beatDotCurrent,
        isRecording && styles.beatDotRecording,
        animatedStyle,
      ]}
    >
      {beat.isRecorded && <Text style={styles.beatDotCheck}>✓</Text>}
    </Animated.View>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={handlePress}
        accessibilityLabel={`Beat ${beat.index + 1}, ${beat.type}${beat.isRecorded ? ', recorded' : ''}`}
        accessibilityRole="button"
        accessibilityHint={beat.isRecorded ? 'Tap to retake' : undefined}
      >
        {content}
      </Pressable>
    );
  }

  return content;
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    borderWidth: 2,
    borderColor: colors.border,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  summaryText: {
    fontSize: typography.fontSize.sm,
    fontWeight: '600',
    color: colors.text.DEFAULT,
  },
  progressPercent: {
    fontSize: typography.fontSize.sm,
    fontWeight: '700',
    color: colors.primary.DEFAULT,
  },
  progressTrack: {
    height: 6,
    backgroundColor: colors.background,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    marginBottom: spacing.md,
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.success,
    borderRadius: borderRadius.full,
  },
  beatsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  beatDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  beatDotCurrent: {
    borderColor: colors.primary.DEFAULT,
    borderWidth: 3,
  },
  beatDotRecording: {
    borderColor: colors.error,
    borderWidth: 3,
  },
  beatDotCheck: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.surface,
  },
  currentBeatInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  currentBeatLabel: {
    fontSize: typography.fontSize.xs,
    color: colors.text.muted,
  },
  currentBeatType: {
    fontSize: typography.fontSize.sm,
    fontWeight: '600',
    color: colors.text.DEFAULT,
  },
  currentBeatDuration: {
    fontSize: typography.fontSize.xs,
    color: colors.text.muted,
  },
});

export default BeatProgressIndicator;
