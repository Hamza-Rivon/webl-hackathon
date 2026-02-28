import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { Ionicons } from '@/components/ui/SymbolIcon';
import { colors, typography, spacing, borderRadius, shadows } from '@/lib/theme';
import { triggerHaptic } from '@/lib/haptics';

interface Stat {
  value: number;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  onPress?: () => void;
}

interface QuickStatsProps {
  stats: Stat[];
  themeMode?: 'dark' | 'light';
}

export function QuickStats({ stats, themeMode = 'dark' }: QuickStatsProps) {
  const isDark = themeMode === 'dark';
  const palette = isDark
    ? {
        cardBg: 'rgba(255,255,255,0.05)',
        cardBorder: 'rgba(255,255,255,0.08)',
        value: '#FFFFFF',
        label: 'rgba(255,255,255,0.5)',
      }
    : {
        cardBg: colors.surface,
        cardBorder: colors.border,
        value: colors.text.DEFAULT,
        label: colors.text.muted,
      };

  return (
    <Animated.View entering={FadeIn.duration(300)} style={styles.container}>
      {stats.map((stat, i) => (
        <Animated.View key={stat.label} entering={FadeInDown.delay(i * 60).duration(250)} style={styles.statWrapper}>
          <Pressable
            onPress={() => {
              if (stat.onPress) {
                triggerHaptic('light');
                stat.onPress();
              }
            }}
            disabled={!stat.onPress}
            style={({ pressed }) => [
              styles.stat,
              { backgroundColor: palette.cardBg, borderColor: palette.cardBorder },
              pressed && styles.statPressed,
            ]}
          >
            <View style={[styles.iconBg, { backgroundColor: stat.color + '18' }]}>
              <Ionicons name={stat.icon} size={18} color={stat.color} />
            </View>
            <Text style={[styles.value, { color: palette.value }]}>{stat.value}</Text>
            <Text style={[styles.label, { color: palette.label }]} numberOfLines={1}>{stat.label}</Text>
          </Pressable>
        </Animated.View>
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
    marginBottom: spacing.xl,
  },
  statWrapper: {
    flex: 1,
  },
  stat: {
    borderRadius: borderRadius.lg,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xs,
    alignItems: 'center',
    gap: 2,
    ...shadows.sm,
    shadowColor: '#000',
    minHeight: 100,
  },
  statPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.97 }],
  },
  iconBg: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  value: {
    color: '#FFFFFF',
    fontSize: typography.fontSize.lg,
    fontFamily: typography.fontFamily.mono,
    fontWeight: typography.fontWeight.bold,
  },
  label: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 9,
    fontFamily: typography.fontFamily.body,
    fontWeight: typography.fontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    textAlign: 'center',
  },
});

export default QuickStats;
