/**
 * Episode Detail Skeleton
 *
 * Loading skeleton for the episode detail screen.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Skeleton, SkeletonText, SkeletonCard } from '../ui/Skeleton';
import { colors, spacing } from '../../lib/theme';

export function EpisodeDetailSkeleton() {
  return (
    <View style={styles.container}>
      {/* Header skeleton */}
      <View style={styles.header}>
        <Skeleton width={44} height={44} radius="md" />
        <View style={styles.headerSpacer} />
        <Skeleton width={44} height={44} radius="md" />
      </View>

      {/* Info card skeleton */}
      <View style={styles.section}>
        <SkeletonCard height={200} showAvatar={false} contentLines={2} />
      </View>

      {/* Action button skeleton */}
      <View style={styles.section}>
        <Skeleton height={48} radius="lg" />
      </View>

      {/* Script section skeleton */}
      <View style={styles.section}>
        <Skeleton height={24} width="40%" radius="sm" style={styles.title} />
        <SkeletonCard height={100} showHeader={false} contentLines={2} />
        <View style={{ height: spacing.sm }} />
        <SkeletonCard height={100} showHeader={false} contentLines={2} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.lg,
    paddingTop: 60,
  },
  headerSpacer: {
    flex: 1,
  },
  section: {
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.xl,
  },
  title: {
    marginBottom: spacing.md,
  },
});

export default EpisodeDetailSkeleton;
