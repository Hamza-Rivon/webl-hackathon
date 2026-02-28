/**
 * Series Card Component
 *
 * Displays a series with name, episode count, and thumbnail
 * in neobrutalist soft pop design style.
 * Requirements: 6.1
 */

import React from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';
import { useRouter } from 'expo-router';
import Animated, { FadeIn } from 'react-native-reanimated';
import { Card } from '../ui/Card';
import { colors, typography, spacing, borderRadius } from '../../lib/theme';
import { SeriesWithEpisodeCount } from '../../hooks/useSeries';

// Pastel colors for series cards
const pastelColors = [
  colors.pastel.pink,
  colors.pastel.blue,
  colors.pastel.green,
  colors.pastel.yellow,
  colors.pastel.purple,
  colors.pastel.orange,
];

// Get consistent color based on series id
function getSeriesColor(id: string): string {
  const hash = id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return pastelColors[hash % pastelColors.length];
}

// Series emoji based on cadence
const cadenceEmojis: Record<string, string> = {
  daily: '📅',
  weekly: '📆',
  biweekly: '🗓️',
  monthly: '📊',
};

export interface SeriesCardProps {
  /** Series data */
  series: SeriesWithEpisodeCount;
  /** Card size variant */
  size?: 'sm' | 'md' | 'lg';
  /** Animation delay for staggered entrance */
  animationDelay?: number;
}

export function SeriesCard({
  series,
  size = 'md',
  animationDelay = 0,
}: SeriesCardProps) {
  const router = useRouter();
  const episodeCount = series._count.episodes;
  const backgroundColor = getSeriesColor(series.id);
  const cadenceEmoji = cadenceEmojis[series.cadence] || '📚';

  const handlePress = () => {
    router.push(`/(main)/series/${series.id}`);
  };

  const sizeStyles = {
    sm: styles.cardSm,
    md: styles.cardMd,
    lg: styles.cardLg,
  };

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
          {series.templateId ? (
            <View style={styles.thumbnailPlaceholder}>
              <Text style={styles.thumbnailEmoji}>📺</Text>
            </View>
          ) : (
            <View style={styles.thumbnailPlaceholder}>
              <Text style={styles.thumbnailEmoji}>📚</Text>
            </View>
          )}
        </View>

        {/* Series Info */}
        <View style={styles.info}>
          <Text style={styles.name} numberOfLines={2}>
            {series.name}
          </Text>
          
          <View style={styles.meta}>
            <View style={styles.episodeCount}>
              <Text style={styles.countNumber}>{episodeCount}</Text>
              <Text style={styles.countLabel}>
                episode{episodeCount !== 1 ? 's' : ''}
              </Text>
            </View>
            
            <View style={styles.cadenceBadge}>
              <Text style={styles.cadenceEmoji}>{cadenceEmoji}</Text>
            </View>
          </View>
        </View>
      </Card>
    </Animated.View>
  );
}

/**
 * Compact Series Card for grid layouts
 */
export function SeriesCardCompact({
  series,
  animationDelay = 0,
}: {
  series: SeriesWithEpisodeCount;
  animationDelay?: number;
}) {
  const router = useRouter();
  const episodeCount = series._count.episodes;
  const backgroundColor = getSeriesColor(series.id);

  const handlePress = () => {
    router.push(`/(main)/series/${series.id}`);
  };

  return (
    <Animated.View entering={FadeIn.duration(300).delay(animationDelay)}>
      <Card
        variant="default"
        pressable
        onPress={handlePress}
        style={[styles.compactCard, { backgroundColor }]}
        padding="md"
      >
        <Text style={styles.compactEmoji}>📺</Text>
        <Text style={styles.compactName} numberOfLines={1}>
          {series.name}
        </Text>
        <Text style={styles.compactCount}>
          {episodeCount} episode{episodeCount !== 1 ? 's' : ''}
        </Text>
      </Card>
    </Animated.View>
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
  name: {
    fontSize: typography.fontSize.base,
    fontWeight: '700',
    color: colors.text.DEFAULT,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  episodeCount: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  countNumber: {
    fontSize: typography.fontSize.lg,
    fontWeight: '800',
    color: colors.text.DEFAULT,
  },
  countLabel: {
    fontSize: typography.fontSize.xs,
    color: colors.text.muted,
    fontWeight: '500',
  },
  cadenceBadge: {
    width: 28,
    height: 28,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cadenceEmoji: {
    fontSize: 14,
  },
  // Compact card styles
  compactCard: {
    alignItems: 'center',
    minHeight: 120,
  },
  compactEmoji: {
    fontSize: 36,
    marginBottom: spacing.sm,
  },
  compactName: {
    fontSize: typography.fontSize.sm,
    fontWeight: '700',
    color: colors.text.DEFAULT,
    textAlign: 'center',
  },
  compactCount: {
    fontSize: typography.fontSize.xs,
    color: colors.text.muted,
    marginTop: spacing.xs,
  },
});

export default SeriesCard;
