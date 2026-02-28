/**
 * Active Series Component
 *
 * Displays a grid of active series on the home screen.
 */

import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Animated, { FadeInDown, FadeInRight } from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Skeleton } from '../ui/Skeleton';
import { colors, typography, spacing } from '../../lib/theme';
import { SeriesWithEpisodeCount } from '../../hooks/useSeries';

interface ActiveSeriesProps {
  series: SeriesWithEpisodeCount[];
  isLoading: boolean;
  delay?: number;
}

export function ActiveSeries({ series, isLoading, delay = 400 }: ActiveSeriesProps) {
  const router = useRouter();

  return (
    <Animated.View entering={FadeInDown.duration(400).delay(delay)} style={styles.container}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>📚 Active Series</Text>
        {series.length > 0 && (
          <Pressable onPress={() => router.push('/(main)/(tabs)/series')}>
            <Text style={styles.seeAll}>See all →</Text>
          </Pressable>
        )}
      </View>

      {isLoading ? (
        <SeriesSkeleton />
      ) : series.length > 0 ? (
        <View style={styles.seriesGrid}>
          {series.map((s, index) => (
            <Animated.View
              key={s.id}
              entering={FadeInRight.duration(300).delay(index * 50)}
              style={styles.seriesCardWrapper}
            >
              <SeriesCard series={s} />
            </Animated.View>
          ))}
        </View>
      ) : (
        <Card variant="default" style={styles.emptyState}>
          <Text style={styles.emptyEmoji}>📚</Text>
          <Text style={styles.emptyText}>No series yet</Text>
          <Text style={styles.emptyHint}>Create a series to organize your content!</Text>
          <Button
            variant="secondary"
            size="sm"
            onPress={() => router.push('/(main)/series/new')}
            style={styles.emptyButton}
          >
            Create Series
          </Button>
        </Card>
      )}
    </Animated.View>
  );
}

function SeriesCard({ series }: { series: SeriesWithEpisodeCount }) {
  const router = useRouter();
  const episodeCount = series._count.episodes;

  return (
    <Card
      variant="pastelYellow"
      pressable
      onPress={() => router.push(`/(main)/series/${series.id}`)}
      style={styles.seriesCard}
    >
      <Text style={styles.seriesEmoji}>📺</Text>
      <Text style={styles.seriesName} numberOfLines={1}>
        {series.name}
      </Text>
      <Text style={styles.seriesCount}>
        {episodeCount} episode{episodeCount !== 1 ? 's' : ''}
      </Text>
    </Card>
  );
}

function SeriesSkeleton() {
  return (
    <View style={styles.seriesGrid}>
      {[1, 2].map((i) => (
        <View key={i} style={styles.seriesCardWrapper}>
          <Skeleton height={120} radius="lg" />
        </View>
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
  seriesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  seriesCardWrapper: {
    width: '48%',
  },
  seriesCard: {
    alignItems: 'center',
    padding: spacing.lg,
  },
  seriesEmoji: {
    fontSize: 36,
    marginBottom: spacing.sm,
  },
  seriesName: {
    fontSize: typography.fontSize.base,
    fontWeight: '700',
    color: colors.text.DEFAULT,
    textAlign: 'center',
  },
  seriesCount: {
    fontSize: typography.fontSize.sm,
    color: colors.text.muted,
    marginTop: spacing.xs,
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
});

export default ActiveSeries;
