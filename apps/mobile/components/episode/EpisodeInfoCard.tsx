/**
 * Episode Info Card Component
 *
 * Displays episode title, status, template, and series information.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Card } from '../ui/Card';
import { colors, typography, spacing, borderRadius } from '../../lib/theme';
import { EpisodeStatus } from '../../hooks/useEpisodes';

// Status configuration
const statusConfig: Record<
  EpisodeStatus,
  { bg: string; text: string; label: string; emoji: string; description: string }
> = {
  draft: {
    bg: colors.pastel.yellow,
    text: colors.text.DEFAULT,
    label: 'Draft',
    emoji: '📝',
    description: 'Generate a script to get started',
  },
  voiceover_uploaded: {
    bg: colors.pastel.orange,
    text: colors.text.DEFAULT,
    label: 'Uploading Voiceover',
    emoji: '⬆️',
    description: 'Preparing your voiceover for processing',
  },
  voiceover_cleaning: {
    bg: colors.pastel.orange,
    text: colors.text.DEFAULT,
    label: 'Cleaning Audio',
    emoji: '✨',
    description: 'Removing silences and filler words',
  },
  voiceover_cleaned: {
    bg: colors.pastel.blue,
    text: colors.text.DEFAULT,
    label: 'Voiceover Ready',
    emoji: '🎙️',
    description: 'Your voiceover is ready! Add video clips now.',
  },
  collecting_clips: {
    bg: colors.pastel.purple,
    text: colors.text.DEFAULT,
    label: 'Collecting Clips',
    emoji: '🎬',
    description: 'Record or upload clips for each slot',
  },
  needs_more_clips: {
    bg: colors.pastel.orange,
    text: colors.text.DEFAULT,
    label: 'Needs More Clips',
    emoji: '⚠️',
    description: 'Add more footage to cover the voiceover',
  },
  chunking_clips: {
    bg: colors.pastel.purple,
    text: colors.text.DEFAULT,
    label: 'Processing Clips',
    emoji: '⚙️',
    description: 'Processing your video clips',
  },
  enriching_chunks: {
    bg: colors.pastel.purple,
    text: colors.text.DEFAULT,
    label: 'Analyzing Footage',
    emoji: '🤖',
    description: 'AI is analyzing your footage',
  },
  matching: {
    bg: colors.pastel.purple,
    text: colors.text.DEFAULT,
    label: 'Matching',
    emoji: '🎯',
    description: 'Matching audio to video',
  },
  cut_plan_ready: {
    bg: colors.pastel.green,
    text: colors.text.DEFAULT,
    label: 'Edit Plan Ready',
    emoji: '📋',
    description: 'Your edit plan is ready. Trigger render to continue.',
  },
  rendering: {
    bg: colors.pastel.orange,
    text: colors.text.DEFAULT,
    label: 'Rendering',
    emoji: '🎞️',
    description: 'Your final video is being rendered',
  },
  ready: {
    bg: colors.pastel.green,
    text: colors.text.DEFAULT,
    label: 'Ready',
    emoji: '✅',
    description: 'Your video is ready!',
  },
  published: {
    bg: colors.success,
    text: colors.surface,
    label: 'Published',
    emoji: '🚀',
    description: 'Video has been published',
  },
  failed: {
    bg: colors.error,
    text: colors.surface,
    label: 'Failed',
    emoji: '❌',
    description: 'Something went wrong',
  },
};

interface EpisodeInfoCardProps {
  title: string;
  status: EpisodeStatus;
  seriesName?: string;
  templateName?: string;
  duration?: number;
  delay?: number;
}

export function EpisodeInfoCard({
  title,
  status,
  seriesName,
  templateName,
  duration,
  delay = 100,
}: EpisodeInfoCardProps) {
  const statusInfo = statusConfig[status] || statusConfig.draft;

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${String(secs).padStart(2, '0')}`;
  };

  return (
    <Animated.View entering={FadeInDown.duration(400).delay(delay)}>
      <Card variant="default" style={[styles.infoCard, { backgroundColor: statusInfo.bg }]}>
        <Text style={styles.episodeEmoji}>{statusInfo.emoji}</Text>
        <Text style={styles.episodeTitle}>{title}</Text>

        {seriesName && <Text style={styles.seriesName}>📚 {seriesName}</Text>}

        {templateName && <Text style={styles.templateName}>📺 {templateName}</Text>}

        <View style={[styles.statusBadge, { backgroundColor: statusInfo.bg }]}>
          <Text style={[styles.statusText, { color: statusInfo.text }]}>
            {statusInfo.label}
          </Text>
        </View>
        <Text style={styles.statusDescription}>{statusInfo.description}</Text>

        {duration && (
          <Text style={styles.duration}>⏱️ {formatDuration(duration)}</Text>
        )}
      </Card>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  infoCard: {
    marginHorizontal: spacing.lg,
    alignItems: 'center',
  },
  episodeEmoji: {
    fontSize: 48,
    marginBottom: spacing.md,
  },
  episodeTitle: {
    fontSize: typography.fontSize['2xl'],
    fontWeight: '800',
    color: colors.text.DEFAULT,
    textAlign: 'center',
  },
  seriesName: {
    fontSize: typography.fontSize.base,
    color: colors.text.muted,
    marginTop: spacing.sm,
  },
  templateName: {
    fontSize: typography.fontSize.sm,
    color: colors.text.muted,
    marginTop: spacing.xs,
  },
  statusBadge: {
    marginTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
    borderWidth: 2,
    borderColor: colors.border,
  },
  statusText: {
    fontSize: typography.fontSize.sm,
    fontWeight: '700',
  },
  statusDescription: {
    fontSize: typography.fontSize.sm,
    color: colors.text.muted,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  duration: {
    fontSize: typography.fontSize.sm,
    color: colors.text.muted,
    marginTop: spacing.md,
  },
});

export default EpisodeInfoCard;
