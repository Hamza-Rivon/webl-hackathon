/**
 * Voiceover Upload Progress Component
 *
 * Displays upload progress for voiceover recordings and Phase 1 processing stages.
 * Requirements: 3.9, 3.10, 9.7, 9.8
 * 
 * Phase 1 stages displayed:
 * - "Uploading to Mux"
 * - "Transcribing audio"
 * - "Correcting transcript"
 * - "Detecting silence and fillers"
 * - "Removing silence and fillers"
 * - "Creating audio segments"
 */

import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  useSharedValue,
  withSequence,
} from 'react-native-reanimated';
import { Card } from '../ui/Card';
import { Progress } from '../ui/Progress';
import { Button } from '../ui/Button';
import { colors, typography, spacing, borderRadius } from '../../lib/theme';

export interface UploadProgressState {
  progress: number;
  status: 'preparing' | 'uploading' | 'processing' | 'completed' | 'failed';
  message: string;
  /** Current Phase 1 job type (for processing status) */
  currentJobType?: string;
  /** Current step number (1-5) for Phase 1 processing */
  currentStep?: number;
}

export interface VoiceoverUploadProgressProps {
  /** Current upload progress state */
  progressState: UploadProgressState;
  /** Whether upload is in progress */
  isUploading: boolean;
  /** Callback to cancel upload */
  onCancel?: () => void;
  /** Callback to retry failed upload */
  onRetry?: () => void;
  /** Callback when upload completes */
  onComplete?: () => void;
}

/**
 * Phase 1 stage labels for voiceover processing
 * Requirements: 3.9, 3.10
 */
const PHASE_1_STAGES: Record<string, { label: string; emoji: string; step: number }> = {
  voiceover_ingest: { label: 'Uploading your audio', emoji: '📤', step: 1 },
  voiceover_transcript: { label: 'Transcribing audio', emoji: '📝', step: 2 },
  voiceover_transcript_correction: { label: 'Correcting transcript', emoji: '🧠', step: 3 },
  voiceover_take_selection: { label: 'Selecting best takes', emoji: '🎯', step: 4 },
  voiceover_silence_detection: { label: 'Detecting silence and fillers', emoji: '🔇', step: 5 },
  voiceover_cleaning: { label: 'Removing silence and fillers', emoji: '✨', step: 6 },
  voiceover_segmentation: { label: 'Creating audio segments', emoji: '✂️', step: 7 },
};

const TOTAL_PHASE_1_STEPS = 7;

// Status configuration
const statusConfig: Record<
  UploadProgressState['status'],
  { emoji: string; color: string; bgColor: string }
> = {
  preparing: {
    emoji: '📦',
    color: colors.text.DEFAULT,
    bgColor: colors.pastel.blue,
  },
  uploading: {
    emoji: '⬆️',
    color: colors.primary.DEFAULT,
    bgColor: colors.pastel.pink,
  },
  processing: {
    emoji: '⚙️',
    color: colors.secondary.DEFAULT,
    bgColor: colors.pastel.purple,
  },
  completed: {
    emoji: '✅',
    color: colors.success,
    bgColor: colors.pastel.green,
  },
  failed: {
    emoji: '❌',
    color: colors.error,
    bgColor: colors.pastel.pink,
  },
};

export function VoiceoverUploadProgress({
  progressState,
  isUploading,
  onCancel,
  onRetry,
  onComplete,
}: VoiceoverUploadProgressProps) {
  const { progress, status, message, currentJobType, currentStep } = progressState;
  const config = statusConfig[status];

  // Get Phase 1 stage info if processing
  const phase1Stage = currentJobType ? PHASE_1_STAGES[currentJobType] : null;
  const displayEmoji = phase1Stage?.emoji || config.emoji;
  const displayStep = currentStep || phase1Stage?.step;

  // Pulsing animation for processing state
  const pulseAnim = useSharedValue(1);

  React.useEffect(() => {
    if (status === 'processing' || status === 'uploading') {
      pulseAnim.value = withRepeat(
        withSequence(
          withTiming(1.1, { duration: 500 }),
          withTiming(1, { duration: 500 })
        ),
        -1,
        true
      );
    } else {
      pulseAnim.value = 1;
    }
  }, [status]);

  const emojiStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulseAnim.value }],
  }));

  // Determine display text based on status and Phase 1 stage
  const getStatusText = () => {
    if (status === 'completed') return 'Upload Complete!';
    if (status === 'failed') return 'Upload Failed';
    if (status === 'processing' && phase1Stage) {
      return phase1Stage.label;
    }
    return status.charAt(0).toUpperCase() + status.slice(1);
  };

  return (
    <Animated.View entering={FadeIn.duration(300)} exiting={FadeOut.duration(200)}>
      <Card
        variant="default"
        style={[styles.container, { backgroundColor: config.bgColor }]}
      >
        {/* Status Icon */}
        <Animated.View style={[styles.emojiContainer, emojiStyle]}>
          <Text style={styles.emoji}>{displayEmoji}</Text>
        </Animated.View>

        {/* Step Counter for Phase 1 processing - Requirements: 3.9, 3.10 */}
        {status === 'processing' && displayStep && (
          <Text style={styles.stepCounter}>
            Step {displayStep} of {TOTAL_PHASE_1_STEPS}
          </Text>
        )}

        {/* Status Text */}
        <Text style={[styles.statusText, { color: config.color }]}>
          {getStatusText()}
        </Text>

        {/* Message */}
        <Text style={styles.message}>{message}</Text>

        {/* Progress Bar */}
        {(status === 'uploading' || status === 'processing') && (
          <View style={styles.progressContainer}>
            <Progress
              value={progress}
              variant={status === 'processing' ? 'secondary' : 'primary'}
              size="md"
              showLabel
            />
          </View>
        )}

        {/* Actions */}
        <View style={styles.actions}>
          {isUploading && onCancel && (
            <Button
              variant="outline"
              size="sm"
              onPress={onCancel}
              style={styles.actionButton}
            >
              Cancel
            </Button>
          )}

          {status === 'failed' && onRetry && (
            <Button
              variant="primary"
              size="sm"
              onPress={onRetry}
              style={styles.actionButton}
            >
              🔄 Retry
            </Button>
          )}

          {status === 'completed' && onComplete && (
            <Button
              variant="primary"
              size="sm"
              onPress={onComplete}
              style={styles.actionButton}
            >
              Continue →
            </Button>
          )}
        </View>

        {/* Processing Info - Phase 1 stages */}
        {status === 'processing' && (
          <View style={styles.processingInfo}>
            <Text style={styles.processingText}>
              🎧 {phase1Stage 
                ? `${phase1Stage.label}...` 
                : 'Your voiceover is being cleaned up and enhanced'}
            </Text>
          </View>
        )}
      </Card>
    </Animated.View>
  );
}

/**
 * Compact Upload Status Badge
 */
export interface UploadStatusBadgeProps {
  status: UploadProgressState['status'];
  progress: number;
}

export function UploadStatusBadge({ status, progress }: UploadStatusBadgeProps) {
  const config = statusConfig[status];

  return (
    <View style={[styles.badge, { backgroundColor: config.bgColor }]}>
      <Text style={styles.badgeEmoji}>{config.emoji}</Text>
      {(status === 'uploading' || status === 'processing') && (
        <Text style={[styles.badgeProgress, { color: config.color }]}>
          {Math.round(progress)}%
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.xl,
    alignItems: 'center',
  },
  emojiContainer: {
    marginBottom: spacing.md,
  },
  emoji: {
    fontSize: 48,
  },
  stepCounter: {
    fontSize: typography.fontSize.sm,
    fontWeight: '600',
    color: colors.text.muted,
    marginBottom: spacing.xs,
  },
  statusText: {
    fontSize: typography.fontSize.xl,
    fontWeight: '700',
    marginBottom: spacing.xs,
  },
  message: {
    fontSize: typography.fontSize.sm,
    color: colors.text.muted,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  progressContainer: {
    width: '100%',
    marginBottom: spacing.lg,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  actionButton: {
    minWidth: 100,
  },
  processingInfo: {
    marginTop: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    width: '100%',
  },
  processingText: {
    fontSize: typography.fontSize.xs,
    color: colors.text.muted,
    textAlign: 'center',
  },
  // Badge styles
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.xs,
  },
  badgeEmoji: {
    fontSize: 14,
  },
  badgeProgress: {
    fontSize: typography.fontSize.xs,
    fontWeight: '600',
  },
});

export default VoiceoverUploadProgress;
