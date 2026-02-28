/**
 * Episode Card Component
 *
 * Displays an episode with title, status, and thumbnail
 * in neobrutalist soft pop design style.
 * Requirements: 7.5
 */

import React from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';
import { useRouter } from 'expo-router';
import Animated, { FadeIn } from 'react-native-reanimated';
import { Card } from '../ui/Card';
import { Progress } from '../ui/Progress';
import { colors, typography, spacing, borderRadius } from '../../lib/theme';
import { EpisodeStatus, EpisodeWithSeries } from '../../hooks/useEpisodes';

// Status configuration with colors and labels
const statusConfig: Record<
  EpisodeStatus,
  { bg: string; text: string; label: string; emoji: string }
> = {
  draft: {
    bg: colors.pastel.yellow,
    text: colors.text.DEFAULT,
    label: 'Draft',
    emoji: '📝',
  },
  voiceover_uploaded: {
    bg: colors.pastel.orange,
    text: colors.text.DEFAULT,
    label: 'Uploading Voiceover',
    emoji: '⬆️',
  },
  voiceover_cleaning: {
    bg: colors.pastel.orange,
    text: colors.text.DEFAULT,
    label: 'Cleaning Audio',
    emoji: '✨',
  },
  voiceover_cleaned: {
    bg: colors.pastel.blue,
    text: colors.text.DEFAULT,
    label: 'Voiceover Ready',
    emoji: '🎙️',
  },
  collecting_clips: {
    bg: colors.pastel.purple,
    text: colors.text.DEFAULT,
    label: 'Collecting Clips',
    emoji: '🎬',
  },
  needs_more_clips: {
    bg: colors.pastel.orange,
    text: colors.text.DEFAULT,
    label: 'Needs More Clips',
    emoji: '⚠️',
  },
  chunking_clips: {
    bg: colors.pastel.purple,
    text: colors.text.DEFAULT,
    label: 'Processing Clips',
    emoji: '⚙️',
  },
  enriching_chunks: {
    bg: colors.pastel.purple,
    text: colors.text.DEFAULT,
    label: 'Analyzing Footage',
    emoji: '🤖',
  },
  matching: {
    bg: colors.pastel.purple,
    text: colors.text.DEFAULT,
    label: 'Matching',
    emoji: '🎯',
  },
  cut_plan_ready: {
    bg: colors.pastel.green,
    text: colors.text.DEFAULT,
    label: 'Edit Plan Ready',
    emoji: '📋',
  },
  rendering: {
    bg: colors.pastel.orange,
    text: colors.text.DEFAULT,
    label: 'Rendering',
    emoji: '🎞️',
  },
  ready: {
    bg: colors.pastel.green,
    text: colors.text.DEFAULT,
    label: 'Ready',
    emoji: '✅',
  },
  published: {
    bg: colors.success,
    text: colors.surface,
    label: 'Published',
    emoji: '🚀',
  },
  failed: {
    bg: colors.error,
    text: colors.surface,
    label: 'Failed',
    emoji: '❌',
  },
};

// Pastel colors for episode cards based on status
const pastelColors: Record<EpisodeStatus, string> = {
  draft: colors.pastel.yellow,
  voiceover_uploaded: colors.pastel.orange,
  voiceover_cleaning: colors.pastel.orange,
  voiceover_cleaned: colors.pastel.blue,
  collecting_clips: colors.pastel.purple,
  needs_more_clips: colors.pastel.orange,
  chunking_clips: colors.pastel.purple,
  enriching_chunks: colors.pastel.purple,
  matching: colors.pastel.purple,
  cut_plan_ready: colors.pastel.green,
  rendering: colors.pastel.orange,
  ready: colors.pastel.green,
  published: colors.pastel.green,
  failed: colors.pastel.pink,
};

export interface EpisodeCardProps {
  /** Episode data */
  episode: EpisodeWithSeries;
  /** Card size variant */
  size?: 'sm' | 'md' | 'lg';
  /** Animation delay for staggered entrance */
  animationDelay?: number;
  /** Show series name */
  showSeries?: boolean;
  /** Processing progress (0-100) */
  progress?: number;
}

export function EpisodeCard({
  episode,
  size = 'md',
  animationDelay = 0,
  showSeries = true,
  progress,
}: EpisodeCardProps) {
  const router = useRouter();
  const status = episode.status as EpisodeStatus;
  const statusInfo = statusConfig[status] || statusConfig.draft;
  const backgroundColor = pastelColors[status] || colors.pastel.yellow;

  const handlePress = () => {
    router.push(`/(main)/episode/${episode.id}`);
  };

  const sizeStyles = {
    sm: styles.cardSm,
    md: styles.cardMd,
    lg: styles.cardLg,
  };

  const formattedDate = new Date(episode.createdAt).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });

  const isProcessing =
    status === 'chunking_clips' ||
    status === 'enriching_chunks' ||
    status === 'matching' ||
    status === 'rendering';

  return (
    <Animated.View entering={FadeIn.duration(300).delay(animationDelay)}>
      <Card
        variant="default"
        pressable
        onPress={handlePress}
        style={[styles.card, sizeStyles[size], { backgroundColor }]}
        padding="md"
      >
        {/* Thumbnail or Emoji */}
        <View style={styles.thumbnailContainer}>
          {episode.thumbnailPath ? (
            <Image
              source={{ uri: episode.thumbnailPath }}
              style={styles.thumbnail}
              resizeMode="cover"
            />
          ) : (
            <View style={styles.thumbnailPlaceholder}>
              <Text style={styles.thumbnailEmoji}>{statusInfo.emoji}</Text>
            </View>
          )}
        </View>

        {/* Episode Info */}
        <View style={styles.info}>
          <Text style={styles.title} numberOfLines={2}>
            {episode.title}
          </Text>

          {showSeries && episode.series && (
            <Text style={styles.seriesName} numberOfLines={1}>
              📚 {episode.series.name}
            </Text>
          )}

          <View style={styles.meta}>
            <Text style={styles.date}>{formattedDate}</Text>
            <View style={[styles.statusBadge, { backgroundColor: statusInfo.bg }]}>
              <Text style={[styles.statusText, { color: statusInfo.text }]}>
                {statusInfo.label}
              </Text>
            </View>
          </View>

          {/* Progress bar for processing states */}
          {isProcessing && progress !== undefined && (
            <View style={styles.progressContainer}>
                <Progress
                  value={progress}
                  size="sm"
                  variant={status === 'rendering' ? 'secondary' : 'primary'}
                />
              </View>
          )}
        </View>
      </Card>
    </Animated.View>
  );
}

/**
 * Compact Episode Card for list layouts
 */
export function EpisodeCardCompact({
  episode,
  animationDelay = 0,
  progress,
}: {
  episode: EpisodeWithSeries;
  animationDelay?: number;
  progress?: number;
}) {
  const router = useRouter();
  const status = episode.status as EpisodeStatus;
  const statusInfo = statusConfig[status] || statusConfig.draft;

  const handlePress = () => {
    router.push(`/(main)/episode/${episode.id}`);
  };

  const formattedDate = new Date(episode.createdAt).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });

  const isProcessing =
    status === 'chunking_clips' ||
    status === 'enriching_chunks' ||
    status === 'matching' ||
    status === 'rendering';

  return (
    <Animated.View entering={FadeIn.duration(300).delay(animationDelay)}>
      <Card
        variant="default"
        pressable
        onPress={handlePress}
        style={styles.compactCard}
        padding="md"
      >
        <View style={styles.compactContent}>
          {/* Left: Emoji and Info */}
          <View style={styles.compactLeft}>
            <View style={styles.compactEmoji}>
              <Text style={styles.compactEmojiText}>{statusInfo.emoji}</Text>
            </View>
            <View style={styles.compactInfo}>
              <Text style={styles.compactTitle} numberOfLines={1}>
                {episode.title}
              </Text>
              {episode.series && (
                <Text style={styles.compactSeries} numberOfLines={1}>
                  📚 {episode.series.name}
                </Text>
              )}
              <Text style={styles.compactDate}>{formattedDate}</Text>
            </View>
          </View>

          {/* Right: Status Badge */}
          <View style={[styles.statusBadge, { backgroundColor: statusInfo.bg }]}>
            <Text style={[styles.statusText, { color: statusInfo.text }]}>
              {statusInfo.label}
            </Text>
          </View>
        </View>

        {/* Progress bar for processing states */}
        {isProcessing && progress !== undefined && (
          <View style={styles.compactProgress}>
            <Progress
              value={progress}
              size="sm"
              variant={status === 'rendering' ? 'secondary' : 'primary'}
            />
          </View>
        )}
      </Card>
    </Animated.View>
  );
}

/**
 * Episode Card Skeleton for loading states
 */
export function EpisodeCardSkeleton({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const sizeStyles = {
    sm: styles.cardSm,
    md: styles.cardMd,
    lg: styles.cardLg,
  };

  return (
    <View style={[styles.card, sizeStyles[size], styles.skeletonCard]}>
      <View style={styles.skeletonThumbnail} />
      <View style={styles.skeletonInfo}>
        <View style={styles.skeletonTitle} />
        <View style={styles.skeletonMeta} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    overflow: 'hidden',
  },
  cardSm: {
    minHeight: 100,
  },
  cardMd: {
    minHeight: 140,
  },
  cardLg: {
    minHeight: 180,
  },
  thumbnailContainer: {
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  thumbnail: {
    width: 64,
    height: 64,
    borderRadius: borderRadius.md,
    borderWidth: 2,
    borderColor: colors.border,
  },
  thumbnailPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbnailEmoji: {
    fontSize: 24,
  },
  info: {
    flex: 1,
  },
  title: {
    fontSize: typography.fontSize.base,
    fontWeight: '700',
    color: colors.text.DEFAULT,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  seriesName: {
    fontSize: typography.fontSize.xs,
    color: colors.text.muted,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  date: {
    fontSize: typography.fontSize.xs,
    color: colors.text.muted,
    fontWeight: '500',
  },
  statusBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
    borderWidth: 2,
    borderColor: colors.border,
  },
  statusText: {
    fontSize: typography.fontSize.xs,
    fontWeight: '700',
  },
  progressContainer: {
    marginTop: spacing.sm,
  },
  // Compact card styles
  compactCard: {
    minHeight: 72,
  },
  compactContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  compactLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: spacing.md,
  },
  compactEmoji: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.md,
    backgroundColor: colors.background,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  compactEmojiText: {
    fontSize: 18,
  },
  compactInfo: {
    flex: 1,
  },
  compactTitle: {
    fontSize: typography.fontSize.base,
    fontWeight: '600',
    color: colors.text.DEFAULT,
  },
  compactSeries: {
    fontSize: typography.fontSize.xs,
    color: colors.text.muted,
    marginTop: 2,
  },
  compactDate: {
    fontSize: typography.fontSize.xs,
    color: colors.text.light,
    marginTop: 2,
  },
  compactProgress: {
    marginTop: spacing.sm,
  },
  // Skeleton styles
  skeletonCard: {
    backgroundColor: colors.background,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
  },
  skeletonThumbnail: {
    width: 48,
    height: 48,
    borderRadius: borderRadius.md,
    backgroundColor: colors.pastel.purple,
    alignSelf: 'center',
    marginBottom: spacing.sm,
  },
  skeletonInfo: {
    alignItems: 'center',
  },
  skeletonTitle: {
    width: '80%',
    height: 16,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.pastel.blue,
    marginBottom: spacing.sm,
  },
  skeletonMeta: {
    width: '50%',
    height: 12,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.pastel.green,
  },
});

export default EpisodeCard;
