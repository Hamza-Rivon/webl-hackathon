/**
 * Job Progress List Component
 *
 * Displays a list of active and completed jobs for an episode.
 * Requirements: 10.2 - Highlight failed jobs with error details and retry option
 */

import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Card } from '../ui/Card';
import { Progress } from '../ui/Progress';
import { Button } from '../ui/Button';
import { colors, typography, spacing, borderRadius } from '../../lib/theme';
import { triggerHaptic } from '../../lib/haptics';
import { translateErrorMessage } from '../../lib/errorMessages';

interface Job {
  id: string;
  type: string;
  status: string;
  progress: number;
  stage?: string | null | undefined;
  errorMessage?: string | null;
  updatedAt?: string;
}

interface JobProgressListProps {
  jobs: Job[];
  delay?: number;
  /** Callback when retry button is pressed for a failed job */
  onRetryJob?: (jobId: string) => void;
  /** Whether a retry is in progress */
  isRetrying?: boolean;
}

export function JobProgressList({ 
  jobs, 
  delay = 500,
  onRetryJob,
  isRetrying = false,
}: JobProgressListProps) {
  if (!jobs || jobs.length === 0) return null;

  // Separate failed jobs from other jobs
  const failedJobs = jobs.filter((j) => j.status === 'failed' || j.status === 'error');
  const otherJobs = jobs.filter((j) => j.status !== 'failed' && j.status !== 'error');

  return (
    <Animated.View entering={FadeInDown.duration(400).delay(delay)} style={styles.container}>
      {/* Failed Jobs Section - Requirements: 10.2 */}
      {failedJobs.length > 0 && (
        <>
          <Text style={styles.sectionTitleError}>❌ Failed Jobs</Text>
          <View style={styles.jobsList}>
            {failedJobs.map((job) => (
              <FailedJobCard 
                key={job.id} 
                job={job} 
                onRetry={onRetryJob}
                isRetrying={isRetrying}
              />
            ))}
          </View>
        </>
      )}

      {/* Active/Completed Jobs Section */}
      {otherJobs.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>⚙️ Processing Jobs</Text>
          <View style={styles.jobsList}>
            {otherJobs.map((job) => (
              <JobCard key={job.id} job={job} />
            ))}
          </View>
        </>
      )}
    </Animated.View>
  );
}

/**
 * Failed Job Card Component
 * Requirements: 10.2
 * - Red error indicator
 * - Error message from job.errorMessage
 * - Job type and stage
 * - Individual "Retry Job" button
 */
function FailedJobCard({ 
  job, 
  onRetry,
  isRetrying = false,
}: { 
  job: Job; 
  onRetry?: (jobId: string) => void;
  isRetrying?: boolean;
}) {
  const handleRetry = () => {
    triggerHaptic('medium');
    onRetry?.(job.id);
  };

  const userFriendlyError = translateErrorMessage(job.errorMessage || 'An error occurred');

  return (
    <Card variant="pastelPink" style={styles.failedJobCard} padding="md">
      {/* Error Indicator and Header */}
      <View style={styles.failedJobHeader}>
        <View style={styles.errorIndicator}>
          <Text style={styles.errorIndicatorText}>!</Text>
        </View>
        <View style={styles.failedJobInfo}>
          <Text style={styles.failedJobType}>{formatJobType(job.type)}</Text>
          {job.stage && (
            <Text style={styles.failedJobStage}>Stage: {formatStage(job.stage)}</Text>
          )}
        </View>
        <Text style={styles.failedJobStatus}>✗</Text>
      </View>

      {/* Error Message */}
      <View style={styles.errorMessageContainer}>
        <Text style={styles.errorMessage}>{userFriendlyError}</Text>
      </View>

      {/* Retry Button */}
      {onRetry && (
        <Button
          variant="primary"
          size="sm"
          onPress={handleRetry}
          loading={isRetrying}
          disabled={isRetrying}
          style={styles.retryButton}
        >
          🔄 Retry Job
        </Button>
      )}
    </Card>
  );
}

function JobCard({ job }: { job: Job }) {
  const isActive = job.status === 'active' || job.status === 'processing';
  const isCompleted = job.status === 'completed' || job.status === 'done';
  const isPending = job.status === 'pending';

  return (
    <Card variant="default" style={styles.jobCard} padding="md">
      <View style={styles.jobHeader}>
        <View style={styles.jobInfo}>
          <Text style={styles.jobType}>{formatJobType(job.type)}</Text>
          {job.stage && <Text style={styles.jobStage}>{formatStage(job.stage)}</Text>}
        </View>
        <Text
          style={[
            styles.jobStatus,
            isCompleted && styles.jobStatusCompleted,
            isPending && styles.jobStatusPending,
          ]}
        >
          {isCompleted ? '✓' : isPending ? '⏳' : `${job.progress}%`}
        </Text>
      </View>
      {isActive && (
        <Progress value={job.progress} size="sm" variant="primary" showLabel />
      )}
    </Card>
  );
}

/**
 * Format job type to user-friendly label
 */
function formatJobType(type: string): string {
  const labels: Record<string, string> = {
    // Phase 1: Voiceover
    voiceover_ingest: 'Uploading voiceover',
    voiceover_transcript: 'Transcribing audio',
    voiceover_transcript_correction: 'Correcting transcript',
    voiceover_take_selection: 'Selecting best takes',
    voiceover_silence_detection: 'Detecting silence',
    voiceover_cleaning: 'Cleaning audio',
    voiceover_segmentation: 'Creating segments',
    // Phase 2: B-Roll
    broll_ingest: 'Processing video',
    broll_chunking: 'Chunking video',
    broll_chunk_ingest: 'Processing chunks',
    slot_clip_enrichment: 'Analyzing clips',
    broll_chunk_enrichment: 'AI analysis',
    broll_chunk_embedding: 'Creating embeddings',
    aroll_chunk_transcript: 'Transcribing A-roll',
    chunk_refinement: 'Refining chunks',
    // Phase 3: Matching
    semantic_matching: 'Matching footage',
    // Phase 4: Cut Plan
    creative_edit_plan: 'Creating creative plan',
    cut_plan_generation: 'Generating edit plan',
    cut_plan_validation: 'Validating edit plan',
    // Phase 5: Rendering
    ffmpeg_render_microcut_v2: 'Rendering video',
    mux_publish: 'Publishing',
  };
  return labels[type] || type.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
}

/**
 * Format stage to user-friendly label
 */
function formatStage(stage: string): string {
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

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.lg,
    marginTop: spacing.xl,
  },
  sectionTitle: {
    fontSize: typography.fontSize.xl,
    fontWeight: '700',
    color: colors.text.DEFAULT,
    marginBottom: spacing.md,
  },
  sectionTitleError: {
    fontSize: typography.fontSize.xl,
    fontWeight: '700',
    color: colors.error,
    marginBottom: spacing.md,
  },
  jobsList: {
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  jobCard: {
    backgroundColor: colors.surface,
  },
  jobHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  jobInfo: {
    flex: 1,
  },
  jobType: {
    fontSize: typography.fontSize.sm,
    fontWeight: '600',
    color: colors.text.DEFAULT,
  },
  jobStage: {
    fontSize: typography.fontSize.xs,
    color: colors.text.muted,
    marginTop: spacing.xs,
  },
  jobStatus: {
    fontSize: typography.fontSize.sm,
    fontWeight: '600',
    color: colors.primary.DEFAULT,
  },
  jobStatusCompleted: {
    color: colors.success,
  },
  jobStatusPending: {
    color: colors.text.muted,
  },
  // Failed job styles - Requirements: 10.2
  failedJobCard: {
    borderWidth: 2,
    borderColor: colors.error,
  },
  failedJobHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  errorIndicator: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.error,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  errorIndicatorText: {
    color: colors.surface,
    fontWeight: '700',
    fontSize: typography.fontSize.sm,
  },
  failedJobInfo: {
    flex: 1,
  },
  failedJobType: {
    fontSize: typography.fontSize.sm,
    fontWeight: '700',
    color: colors.text.DEFAULT,
  },
  failedJobStage: {
    fontSize: typography.fontSize.xs,
    color: colors.text.muted,
    marginTop: spacing.xs,
  },
  failedJobStatus: {
    fontSize: typography.fontSize.lg,
    fontWeight: '700',
    color: colors.error,
  },
  errorMessageContainer: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.sm,
    padding: spacing.sm,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.error,
  },
  errorMessage: {
    fontSize: typography.fontSize.sm,
    color: colors.error,
    lineHeight: 18,
  },
  retryButton: {
    alignSelf: 'flex-start',
  },
});

export default JobProgressList;
