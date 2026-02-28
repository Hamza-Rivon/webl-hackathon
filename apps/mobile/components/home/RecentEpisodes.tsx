/**
 * Recent Episodes Component
 *
 * Displays a list of recent episodes on the home screen.
 */

import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Animated, { FadeInDown, FadeInRight } from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Skeleton } from '../ui/Skeleton';
import { colors, typography, spacing, borderRadius } from '../../lib/theme';
import { EpisodeWithSeries, EpisodeStatus } from '../../hooks/useEpisodes';

// Status badge colors
const statusColors: Record<EpisodeStatus, { bg: string; text: string }> = {
  draft: { bg: colors.pastel.yellow, text: colors.text.DEFAULT },
  voiceover_uploaded: { bg: colors.pastel.orange, text: colors.text.DEFAULT },
  voiceover_cleaning: { bg: colors.pastel.orange, text: colors.text.DEFAULT },
  voiceover_cleaned: { bg: colors.pastel.blue, text: colors.text.DEFAULT },
  collecting_clips: { bg: colors.pastel.purple, text: colors.text.DEFAULT },
  needs_more_clips: { bg: colors.pastel.orange, text: colors.text.DEFAULT },
  chunking_clips: { bg: colors.pastel.purple, text: colors.text.DEFAULT },
  enriching_chunks: { bg: colors.pastel.purple, text: colors.text.DEFAULT },
  matching: { bg: colors.pastel.purple, text: colors.text.DEFAULT },
  cut_plan_ready: { bg: colors.pastel.green, text: colors.text.DEFAULT },
  rendering: { bg: colors.pastel.orange, text: colors.text.DEFAULT },
  ready: { bg: colors.pastel.green, text: colors.text.DEFAULT },
  published: { bg: colors.success, text: colors.surface },
  failed: { bg: colors.error, text: colors.surface },
};

const formatStatus = (status: EpisodeStatus): string => {
  const labels: Record<EpisodeStatus, string> = {
    draft: 'Draft',
    voiceover_uploaded: 'Uploading Voiceover',
    voiceover_cleaning: 'Cleaning Audio',
    voiceover_cleaned: 'Voiceover Ready',
    collecting_clips: 'Collecting Clips',
    needs_more_clips: 'Needs More Clips',
    chunking_clips: 'Processing Clips',
    enriching_chunks: 'Analyzing Footage',
    matching: 'Matching',
    cut_plan_ready: 'Edit Plan Ready',
    rendering: 'Rendering',
    ready: 'Ready',
    published: 'Published',
    failed: 'Failed',
  };
  return labels[status] || status;
};

interface RecentEpisodesProps {
  episodes: EpisodeWithSeries[];
  isLoading: boolean;
  delay?: number;
}

export function RecentEpisodes({ episodes, isLoading, delay = 300 }: RecentEpisodesProps) {
  const router = useRouter();

  return (
    <Animated.View entering={FadeInDown.duration(400).delay(delay)} style={styles.container}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>🎥 Recent Episodes</Text>
        {episodes.length > 0 && (
          <Pressable onPress={() => router.push('/(main)/(tabs)/series')}>
            <Text style={styles.seeAll}>See all →</Text>
          </Pressable>
        )}
      </View>

      {isLoading ? (
        <EpisodesSkeleton />
      ) : episodes.length > 0 ? (
        <View style={styles.episodesList}>
          {episodes.map((episode, index) => (
            <Animated.View
              key={episode.id}
              entering={FadeInRight.duration(300).delay(index * 50)}
            >
              <EpisodeCard episode={episode} />
            </Animated.View>
          ))}
        </View>
      ) : (
        <Card variant="default" style={styles.emptyState}>
          <Text style={styles.emptyEmoji}>🎥</Text>
          <Text style={styles.emptyText}>No episodes yet</Text>
          <Text style={styles.emptyHint}>Create your first episode to get started!</Text>
          <Button
            variant="primary"
            size="sm"
            onPress={() => router.push('/(main)/episode/new')}
            style={styles.emptyButton}
          >
            Create Episode
          </Button>
        </Card>
      )}
    </Animated.View>
  );
}

function EpisodeCard({ episode }: { episode: EpisodeWithSeries }) {
  const router = useRouter();
  const statusStyle = statusColors[episode.status] || statusColors.draft;

  return (
    <Card
      variant="default"
      pressable
      onPress={() => router.push(`/(main)/episode/${episode.id}`)}
      style={styles.episodeCard}
    >
      <View style={styles.episodeContent}>
        <View style={styles.episodeInfo}>
          <Text style={styles.episodeTitle} numberOfLines={1}>
            {episode.title}
          </Text>
          {episode.series && (
            <Text style={styles.episodeSeries} numberOfLines={1}>
              {episode.series.name}
            </Text>
          )}
        </View>
        <View style={[styles.statusBadge, { backgroundColor: statusStyle.bg }]}>
          <Text style={[styles.statusText, { color: statusStyle.text }]}>
            {formatStatus(episode.status)}
          </Text>
        </View>
      </View>
    </Card>
  );
}

function EpisodesSkeleton() {
  return (
    <View style={styles.episodesList}>
      {[1, 2, 3].map((i) => (
        <Skeleton key={i} height={72} radius="lg" style={styles.skeletonItem} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.xl,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  sectionTitle: {
    fontSize: typography.fontSize.xl,
    fontWeight: '700',
    color: colors.text.DEFAULT,
  },
  seeAll: {
    fontSize: typography.fontSize.sm,
    fontWeight: '600',
    color: colors.primary.DEFAULT,
  },
  episodesList: {
    gap: spacing.sm,
  },
  episodeCard: {
    padding: spacing.md,
  },
  episodeContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  episodeInfo: {
    flex: 1,
    marginRight: spacing.md,
  },
  episodeTitle: {
    fontSize: typography.fontSize.base,
    fontWeight: '600',
    color: colors.text.DEFAULT,
  },
  episodeSeries: {
    fontSize: typography.fontSize.sm,
    color: colors.text.muted,
    marginTop: 2,
  },
  statusBadge: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
    borderWidth: 2,
    borderColor: colors.border,
  },
  statusText: {
    fontSize: typography.fontSize.xs,
    fontWeight: '700',
  },
  emptyState: {
    alignItems: 'center',
    padding: spacing['2xl'],
  },
  emptyEmoji: {
    fontSize: 48,
    marginBottom: spacing.md,
  },
  emptyText: {
    fontSize: typography.fontSize.base,
    fontWeight: '600',
    color: colors.text.DEFAULT,
  },
  emptyHint: {
    fontSize: typography.fontSize.sm,
    color: colors.text.muted,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  emptyButton: {
    marginTop: spacing.lg,
  },
  skeletonItem: {
    marginBottom: spacing.sm,
  },
});

export default RecentEpisodes;
