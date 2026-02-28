/**
 * Slots Screen Skeleton
 *
 * Loading skeleton for the slot collection screen.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Skeleton } from '../ui/Skeleton';
import { colors, spacing } from '../../lib/theme';

export function SlotsSkeleton() {
  return (
    <View style={styles.container}>
      {/* Header skeleton */}
      <View style={styles.header}>
        <Skeleton width={44} height={44} radius="md" />
        <Skeleton height={24} width="60%" radius="md" />
        <View style={{ width: 44 }} />
      </View>

      {/* Progress skeleton */}
      <View style={styles.section}>
        <Skeleton height={60} radius="lg" />
      </View>

      {/* Slots list skeleton */}
      <View style={styles.section}>
        <Skeleton height={20} width="40%" radius="sm" style={styles.title} />
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} height={80} radius="lg" style={styles.slotCard} />
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
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
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
  slotCard: {
    marginBottom: spacing.sm,
  },
});

export default SlotsSkeleton;
