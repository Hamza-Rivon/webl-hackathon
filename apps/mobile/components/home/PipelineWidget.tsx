import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { Ionicons } from '@/components/ui/SymbolIcon';
import { colors, typography, spacing, borderRadius, shadows } from '@/lib/theme';
import { STAGE_LABELS } from '@/lib/pipeline';

interface PipelineJob {
  id: string;
  type: string;
  stage?: string | null;
  progress: number;
}

interface PipelineWidgetProps {
  jobs: PipelineJob[];
  onPress?: () => void;
  themeMode?: 'dark' | 'light';
}

function JobPill({
  job,
  index,
  themeMode = 'dark',
}: {
  job: PipelineJob;
  index: number;
  themeMode?: 'dark' | 'light';
}) {
  const progressColor =
    job.progress > 80 ? '#22C55E' : job.progress > 40 ? '#F59E0B' : '#5CF6FF';
  const isDark = themeMode === 'dark';
  const palette = isDark
    ? {
        type: '#FFFFFF',
        stage: 'rgba(255,255,255,0.5)',
        ringBg: 'rgba(0,0,0,0.3)',
        trackBg: 'rgba(255,255,255,0.1)',
      }
    : {
        type: colors.text.DEFAULT,
        stage: colors.text.muted,
        ringBg: 'rgba(16,35,61,0.08)',
        trackBg: 'rgba(16,35,61,0.16)',
      };

  return (
    <Animated.View entering={FadeInDown.delay(index * 80).duration(250)}>
      <View style={styles.jobPill}>
        <View style={styles.jobPillLeft}>
          <View style={[styles.progressRing, { borderColor: progressColor, backgroundColor: palette.ringBg }]}>
            <Text style={[styles.progressText, { color: progressColor }]}>
              {job.progress}
            </Text>
          </View>
          <View style={styles.jobInfo}>
            <Text style={[styles.jobType, { color: palette.type }]} numberOfLines={1}>
              {job.type.replaceAll('_', ' ')}
            </Text>
            <Text style={[styles.jobStage, { color: palette.stage }]} numberOfLines={1}>
              {job.stage
                ? STAGE_LABELS[job.stage as keyof typeof STAGE_LABELS] || job.stage
                : 'Processing'}
            </Text>
          </View>
        </View>

        <View style={[styles.progressBarOuter, { backgroundColor: palette.trackBg }]}>
          <View
            style={[
              styles.progressBarFill,
              { width: `${job.progress}%`, backgroundColor: progressColor },
            ]}
          />
        </View>
      </View>
    </Animated.View>
  );
}

export function PipelineWidget({ jobs, onPress, themeMode = 'dark' }: PipelineWidgetProps) {
  const isDark = themeMode === 'dark';
  const palette = isDark
    ? {
        containerBg: 'rgba(255,255,255,0.05)',
        containerBorder: 'rgba(255,255,255,0.08)',
        title: '#FFFFFF',
        empty: 'rgba(255,255,255,0.35)',
      }
    : {
        containerBg: colors.surface,
        containerBorder: colors.border,
        title: colors.text.DEFAULT,
        empty: colors.text.muted,
      };

  return (
    <Animated.View entering={FadeIn.duration(300)}>
      <Pressable
        onPress={onPress}
        disabled={!onPress}
        style={({ pressed }) => [
          styles.container,
          { backgroundColor: palette.containerBg, borderColor: palette.containerBorder },
          pressed && styles.pressed,
        ]}
      >
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <View style={styles.iconWrap}>
              <Ionicons name="pulse" size={16} color="#5CF6FF" />
            </View>
            <Text style={[styles.title, { color: palette.title }]}>Active Pipeline</Text>
          </View>
          {jobs.length > 0 ? (
            <View style={styles.liveBadge}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>{jobs.length} active</Text>
            </View>
          ) : null}
        </View>

        {jobs.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="checkmark-circle-outline" size={24} color={isDark ? 'rgba(255,255,255,0.2)' : colors.text.light} />
            <Text style={[styles.emptyText, { color: palette.empty }]}>No active jobs</Text>
          </View>
        ) : (
          <View style={styles.jobList}>
            {jobs.map((job, i) => (
              <JobPill key={job.id} job={job} index={i} themeMode={themeMode} />
            ))}
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: spacing.lg,
    borderRadius: borderRadius.lg,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: spacing.lg,
    marginBottom: spacing.xl,
    ...shadows.md,
    shadowColor: '#000',
  },
  pressed: {
    opacity: 0.9,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  iconWrap: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: 'rgba(92,246,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: '#FFFFFF',
    fontSize: typography.fontSize.base,
    fontFamily: typography.fontFamily.heading,
    fontWeight: typography.fontWeight.bold,
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(34,197,94,0.15)',
    borderRadius: borderRadius.full,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#22C55E',
  },
  liveText: {
    color: '#22C55E',
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily.mono,
    fontWeight: typography.fontWeight.bold,
  },
  emptyState: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    justifyContent: 'center',
  },
  emptyText: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily.body,
  },
  jobList: {
    gap: spacing.sm,
  },
  jobPill: {
    gap: spacing.sm,
  },
  jobPillLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  progressRing: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  progressText: {
    fontSize: 10,
    fontFamily: typography.fontFamily.mono,
    fontWeight: typography.fontWeight.bold,
  },
  jobInfo: {
    flex: 1,
  },
  jobType: {
    color: '#FFFFFF',
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily.body,
    fontWeight: typography.fontWeight.semibold,
    textTransform: 'capitalize',
  },
  jobStage: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily.body,
  },
  progressBarOuter: {
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.1)',
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 2,
  },
});

export default PipelineWidget;
