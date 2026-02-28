/**
 * Quick Actions Component
 *
 * Displays quick action cards for creating episodes and series.
 */

import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { colors, typography, spacing, borderRadius, shadows } from '../../lib/theme';
import { triggerHaptic } from '../../lib/haptics';

interface QuickActionsProps {
  delay?: number;
}

export function QuickActions({ delay = 200 }: QuickActionsProps) {
  const router = useRouter();

  return (
    <Animated.View entering={FadeInDown.duration(400).delay(delay)} style={styles.container}>
      <Text style={styles.sectionTitle}>⚡ Quick Actions</Text>
      <View style={styles.quickActions}>
        <Pressable
          style={[styles.actionCard, { backgroundColor: colors.pastel.pink }]}
          onPress={() => {
            triggerHaptic('light');
            router.push('/(main)/episode/new');
          }}
          accessibilityLabel="Create new episode"
          accessibilityRole="button"
        >
          <Text style={styles.actionEmoji}>🎬</Text>
          <Text style={styles.actionTitle}>New Episode</Text>
          <Text style={styles.actionDesc}>Create a new video</Text>
        </Pressable>

        <Pressable
          style={[styles.actionCard, { backgroundColor: colors.pastel.blue }]}
          onPress={() => {
            triggerHaptic('light');
            router.push('/(main)/series/new');
          }}
          accessibilityLabel="Create new series"
          accessibilityRole="button"
        >
          <Text style={styles.actionEmoji}>📚</Text>
          <Text style={styles.actionTitle}>New Series</Text>
          <Text style={styles.actionDesc}>Start a content series</Text>
        </Pressable>
      </View>

      <Pressable
        style={[styles.actionCardWide, { backgroundColor: colors.pastel.green }]}
        onPress={() => {
          triggerHaptic('light');
          router.push('/(main)/(tabs)/templates');
        }}
        accessibilityLabel="Browse templates"
        accessibilityRole="button"
      >
        <Text style={styles.actionEmoji}>🎨</Text>
        <View style={styles.actionTextWide}>
          <Text style={styles.actionTitle}>Browse Templates</Text>
          <Text style={styles.actionDesc}>Find viral video templates</Text>
        </View>
        <Text style={styles.actionArrow}>→</Text>
      </Pressable>
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
  quickActions: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  actionCard: {
    flex: 1,
    borderRadius: borderRadius.lg,
    borderWidth: 2,
    borderColor: colors.border,
    padding: spacing.lg,
    ...shadows.md,
  },
  actionCardWide: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: borderRadius.lg,
    borderWidth: 2,
    borderColor: colors.border,
    padding: spacing.lg,
    ...shadows.md,
  },
  actionEmoji: {
    fontSize: 32,
    marginBottom: spacing.sm,
  },
  actionTextWide: {
    flex: 1,
    marginLeft: spacing.md,
  },
  actionTitle: {
    fontSize: typography.fontSize.lg,
    fontWeight: '700',
    color: colors.text.DEFAULT,
  },
  actionDesc: {
    fontSize: typography.fontSize.sm,
    color: colors.text.muted,
    marginTop: spacing.xs,
  },
  actionArrow: {
    fontSize: typography.fontSize['2xl'],
    color: colors.text.DEFAULT,
    fontWeight: '700',
  },
});

export default QuickActions;
