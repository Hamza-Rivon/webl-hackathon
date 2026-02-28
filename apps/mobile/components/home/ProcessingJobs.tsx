/**
 * Processing Jobs Component
 *
 * Displays active job progress on the home screen.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Card } from '../ui/Card';
import { Progress } from '../ui/Progress';
import { colors, typography, spacing } from '../../lib/theme';

interface Job {
  id: string;
  type: string;
  status: string;
  progress: number;
  stage?: string | null;
}

interface ProcessingJobsProps {
  jobs: Job[];
  delay?: number;
}

const formatJobType = (type: string): string => {
  const labels: Record<string, string> = {
    voiceover_ingest: 'Uploading voiceover',
    voiceover_transcript: 'Transcribing voiceover',
    voiceover_transcript_correction: 'Correcting transcript',
    voiceover_take_selection: 'Selecting best takes',
    voiceover_silence_detection: 'Detecting silence',
    voiceover_cleaning: 'Cleaning audio',
    voiceover_segmentation: 'Segmenting voiceover',
    broll_ingest: 'Processing media',
    broll_chunking: 'Chunking clips',
    broll_chunk_ingest: 'Uploading chunks',
    slot_clip_enrichment: 'Analyzing clips',
    broll_chunk_enrichment: 'Enriching chunks',
    broll_chunk_embedding: 'Embedding chunks',
    semantic_matching: 'Matching clips',
    creative_edit_plan: 'Building creative plan',
    cut_plan_generation: 'Generating cut plan',
    cut_plan_validation: 'Validating cut plan',
    ffmpeg_render_microcut_v2: 'Rendering video',
    mux_publish: 'Publishing',
  };
  return labels[type] || type;
};

export function ProcessingJobs({ jobs, delay = 150 }: ProcessingJobsProps) {
  if (jobs.length === 0) return null;

  return (
    <Animated.View entering={FadeInDown.duration(400).delay(delay)} style={styles.container}>
      <Text style={styles.sectionTitle}>🔄 Processing</Text>
      {jobs.map((job) => (
        <Card key={job.id} variant="pastelBlue" style={styles.jobCard}>
          <View style={styles.jobHeader}>
            <Text style={styles.jobType}>{formatJobType(job.type)}</Text>
            <Text style={styles.jobProgress}>{job.progress}%</Text>
          </View>
          {job.stage && <Text style={styles.jobStage}>{job.stage}</Text>}
          <Progress value={job.progress} variant="primary" size="sm" animated />
        </Card>
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.xl,
  },
  sectionTitle: {
    fontSize: typography.fontSize.xl,
    fontWeight: '700',
    color: colors.text.DEFAULT,
    marginBottom: spacing.md,
  },
  jobCard: {
    marginBottom: spacing.sm,
  },
  jobHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  jobType: {
    fontSize: typography.fontSize.sm,
    fontWeight: '600',
    color: colors.text.DEFAULT,
  },
  jobProgress: {
    fontSize: typography.fontSize.sm,
    fontWeight: '700',
    color: colors.primary.DEFAULT,
  },
  jobStage: {
    fontSize: typography.fontSize.xs,
    color: colors.text.muted,
    marginBottom: spacing.sm,
  },
});

export default ProcessingJobs;
