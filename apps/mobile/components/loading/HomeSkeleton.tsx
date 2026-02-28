/**
 * Home Screen Skeleton
 *
 * Loading skeleton for the home screen.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Skeleton, SkeletonListItem } from '../ui/Skeleton';
import { colors, spacing } from '../../lib/theme';

export function HomeSkeleton() {
  return (
    <View style={styles.container}>
      {/* Header skeleton */}
      <View style={styles.header}>
        <Skeleton height={32} width="70%" radius="md" />
        <View style={{ height: spacing.sm }} />
        <Skeleton height={18} width="50%" radius="sm" />
      </View>

      {/* Quick actions skeleton */}
      <View style={styles.section}>
        <Skeleton height={20} width="40%" radius="sm" style={styles.title} />
        <View style={styles.quickActions}>
          <Skeleton height={100} width="48%" radius="lg" />
          <Skeleton height={100} width="48%" radius="lg" />
        </View>
      </View>

      {/* Episodes section skeleton */}
      <View style={styles.section}>
        <Skeleton height={20} width="40%" radius="sm" style={styles.title} />
        {[1, 2, 3].map((i) => (
          <View key={i} style={styles.listItemWrapper}>
            <SkeletonListItem showAvatar={false} lines={2} />
          </View>
        ))}
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
    padding: spacing.lg,
    paddingTop: 60,
  },
  section: {
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.xl,
  },
  title: {
    marginBottom: spacing.md,
  },
  quickActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  listItemWrapper: {
    marginBottom: spacing.sm,
  },
});

export default HomeSkeleton;
