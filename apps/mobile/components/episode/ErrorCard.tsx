/**
 * Error Card Component
 *
 * Displays error information for failed episodes with retry and go back options.
 * Requirements: 10.1
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { colors, typography, spacing, borderRadius } from '../../lib/theme';
import { triggerHaptic } from '../../lib/haptics';
import { translateErrorMessage, ErrorCategory, categorizeError } from '../../lib/errorMessages.js';

export interface FailedJobInfo {
  id: string;
  type: string;
  stage?: string | null;
  errorMessage?: string | null;
  updatedAt: string | Date;
}

export interface ErrorCardProps {
  /** Failed job information */
  failedJob: FailedJobInfo;
  /** Callback when retry button is pressed */
  onRetry: (jobId: string) => void;
  /** Callback when go back button is pressed */
  onGoBack: () => void;
  /** Whether retry is in progress */
  isRetrying?: boolean;
  /** Animation delay for staggered entrance */
  delay?: number;
}

/**
 * Format job type to user-friendly label
 */
function formatJobType(type: string): string {
  const labels: Record<string, string> = {
    // Phase 1: Voiceover
    voiceover_ingest: 'Voiceover Upload',
    voiceover_transcript: 'Audio Transcription',
    voiceover_transcript_correction: 'Transcript Correction',
    voiceover_take_selection: 'Take Selection',
    voiceover_silence_detection: 'Silence Detection',
    voiceover_cleaning: 'Audio Cleaning',
    voiceover_segmentation: 'Audio Segmentation',
    // Phase 2: B-Roll
    broll_ingest: 'Video Upload',
    broll_chunking: 'Video Chunking',
    broll_chunk_ingest: 'Chunk Processing',
    slot_clip_enrichment: 'Clip Enrichment',
    broll_chunk_enrichment: 'AI Analysis',
    broll_chunk_embedding: 'Embedding Creation',
    aroll_chunk_transcript: 'A-Roll Transcription',
    chunk_refinement: 'Chunk Refinement',
    // Phase 3: Matching
    semantic_matching: 'Audio-Video Matching',
    // Phase 4: Cut Plan
    creative_edit_plan: 'Creative Edit Plan',
    cut_plan_generation: 'Edit Plan Generation',
    cut_plan_validation: 'Edit Plan Validation',
    // Phase 5: Rendering
    ffmpeg_render_microcut_v2: 'Video Rendering',
    mux_publish: 'Video Publishing',
  };
  return labels[type] || type.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
}

/**
 * Format stage to user-friendly label
 */
function formatStage(stage: string | null | undefined): string {
  if (!stage) return '';
  const labels: Record<string, string> = {
    starting: 'Starting',
    downloading: 'Downloading',
    uploading: 'Uploading',
    processing: 'Processing',
    analyzing: 'Analyzing',
    building: 'Building',
    rendering: 'Rendering',
    publishing: 'Publishing',
    done: 'Complete',
  };
  return labels[stage] || stage;
}

/**
 * Format timestamp to readable string
 */
function formatTimestamp(timestamp: string | Date): string {
  const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Get emoji for error category
 */
function getErrorEmoji(category: ErrorCategory): string {
  const emojis: Record<ErrorCategory, string> = {
    network: '📡',
    validation: '⚠️',
    timeout: '⏱️',
    server: '🔧',
    unknown: '❌',
  };
  return emojis[category];
}

/**
 * Error Card Component
 * 
 * Requirements: 10.1
 * - Display failure reason from failed job's errorMessage
 * - Display failed job type and stage
 * - Display timestamp of failure
 * - Add "Retry" button to retry the failed job
 * - Add "Go Back" button to return to previous step
 */
export function ErrorCard({
  failedJob,
  onRetry,
  onGoBack,
  isRetrying = false,
  delay = 0,
}: ErrorCardProps) {
  const handleRetry = () => {
    triggerHaptic('medium');
    onRetry(failedJob.id);
  };

  const handleGoBack = () => {
    triggerHaptic('light');
    onGoBack();
  };

  // Get user-friendly error message
  const errorCategory = categorizeError(failedJob.errorMessage || '');
  const userFriendlyMessage = translateErrorMessage(
    failedJob.errorMessage || 'An unexpected error occurred'
  );
  const errorEmoji = getErrorEmoji(errorCategory);

  return (
    <Animated.View entering={FadeInDown.duration(400).delay(delay)}>
      <Card variant="pastelPink" style={styles.card}>
        {/* Error Header */}
        <View style={styles.header}>
          <View style={styles.emojiContainer}>
            <Text style={styles.emoji}>{errorEmoji}</Text>
          </View>
          <View style={styles.headerText}>
            <Text style={styles.title}>Processing Failed</Text>
            <Text style={styles.timestamp}>
              {formatTimestamp(failedJob.updatedAt)}
            </Text>
          </View>
        </View>

        {/* Error Details */}
        <View style={styles.details}>
          {/* Job Type */}
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Job Type</Text>
            <Text style={styles.detailValue}>
              {formatJobType(failedJob.type)}
            </Text>
          </View>

          {/* Stage (if available) */}
          {failedJob.stage && (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Stage</Text>
              <Text style={styles.detailValue}>
                {formatStage(failedJob.stage)}
              </Text>
            </View>
          )}
        </View>

        {/* Error Message */}
        <View style={styles.errorMessageContainer}>
          <Text style={styles.errorLabel}>Error</Text>
          <Text style={styles.errorMessage}>{userFriendlyMessage}</Text>
        </View>

        {/* Action Buttons */}
        <View style={styles.actions}>
          <Button
            variant="primary"
            size="md"
            onPress={handleRetry}
            loading={isRetrying}
            disabled={isRetrying}
            style={styles.retryButton}
          >
            🔄 Retry
          </Button>
          <Button
            variant="outline"
            size="md"
            onPress={handleGoBack}
            disabled={isRetrying}
            style={styles.goBackButton}
          >
            ← Go Back
          </Button>
        </View>
      </Card>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.lg,
    marginVertical: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  emojiContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.error,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
    borderWidth: 2,
    borderColor: colors.border,
  },
  emoji: {
    fontSize: 24,
  },
  headerText: {
    flex: 1,
  },
  title: {
    fontSize: typography.fontSize.lg,
    fontWeight: '700',
    color: colors.text.DEFAULT,
  },
  timestamp: {
    fontSize: typography.fontSize.xs,
    color: colors.text.muted,
    marginTop: spacing.xs,
  },
  details: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 2,
    borderColor: colors.border,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  detailLabel: {
    fontSize: typography.fontSize.sm,
    color: colors.text.muted,
    fontWeight: '500',
  },
  detailValue: {
    fontSize: typography.fontSize.sm,
    color: colors.text.DEFAULT,
    fontWeight: '600',
  },
  errorMessageContainer: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
    borderWidth: 2,
    borderColor: colors.error,
  },
  errorLabel: {
    fontSize: typography.fontSize.xs,
    fontWeight: '600',
    color: colors.error,
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
  },
  errorMessage: {
    fontSize: typography.fontSize.sm,
    color: colors.text.DEFAULT,
    lineHeight: 20,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  retryButton: {
    flex: 1,
  },
  goBackButton: {
    flex: 1,
  },
});

export default ErrorCard;
