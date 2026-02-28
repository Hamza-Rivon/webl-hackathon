/**
 * Script Breakdown Component
 *
 * Displays the script beats in a visual list.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, { FadeInDown, FadeInRight } from 'react-native-reanimated';
import { Card } from '../ui/Card';
import { colors, typography, spacing, borderRadius } from '../../lib/theme';
import { ScriptBeat } from '../../hooks/useEpisodes';

// Beat type configuration
const beatTypeConfig: Record<string, { emoji: string; color: string }> = {
  hook: { emoji: '🎣', color: colors.pastel.pink },
  problem: { emoji: '❓', color: colors.pastel.orange },
  solution: { emoji: '💡', color: colors.pastel.yellow },
  proof: { emoji: '📊', color: colors.pastel.blue },
  cta: { emoji: '👆', color: colors.pastel.green },
  intro: { emoji: '👋', color: colors.pastel.purple },
  outro: { emoji: '👋', color: colors.pastel.purple },
  content: { emoji: '📝', color: colors.pastel.blue },
};

interface ScriptBreakdownProps {
  beats: ScriptBeat[];
  delay?: number;
}

export function ScriptBreakdown({ beats, delay = 300 }: ScriptBreakdownProps) {
  if (!beats || beats.length === 0) return null;

  return (
    <Animated.View entering={FadeInDown.duration(400).delay(delay)} style={styles.container}>
      <Text style={styles.sectionTitle}>📜 Script Breakdown</Text>
      <View style={styles.beatsList}>
        {beats.map((beat, index) => (
          <BeatCard key={index} beat={beat} index={index} />
        ))}
      </View>
    </Animated.View>
  );
}

interface BeatCardProps {
  beat: ScriptBeat;
  index: number;
}

function BeatCard({ beat, index }: BeatCardProps) {
  const beatType = (beat as any).beatType || (beat as any).type || 'content';
  const beatConfig = beatTypeConfig[beatType] || beatTypeConfig.content;

  return (
    <Animated.View entering={FadeInRight.duration(300).delay(index * 50)}>
      <Card
        variant="default"
        style={[styles.beatCard, { backgroundColor: beatConfig.color }]}
        padding="md"
      >
        <View style={styles.beatHeader}>
          <View style={styles.beatType}>
            <Text style={styles.beatEmoji}>{beatConfig.emoji}</Text>
            <Text style={styles.beatTypeName}>
              {beatType.charAt(0).toUpperCase() + beatType.slice(1)}
            </Text>
          </View>
          <Text style={styles.beatDuration}>{beat.duration || 0}s</Text>
        </View>
        <Text style={styles.beatText}>{beat.text || ''}</Text>
      </Card>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.lg,
    marginTop: spacing.xl,
  },
  sectionTitle: {
    fontSize: typography.fontSize.xl,
    fontWeight: '700',
    color: colors.text.DEFAULT,
    marginBottom: spacing.md,
  },
  beatsList: {
    gap: spacing.sm,
  },
  beatCard: {
    overflow: 'hidden',
  },
  beatHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  beatType: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  beatEmoji: {
    fontSize: 16,
  },
  beatTypeName: {
    fontSize: typography.fontSize.sm,
    fontWeight: '700',
    color: colors.text.DEFAULT,
  },
  beatDuration: {
    fontSize: typography.fontSize.xs,
    fontWeight: '600',
    color: colors.text.muted,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.border,
  },
  beatText: {
    fontSize: typography.fontSize.base,
    color: colors.text.DEFAULT,
    lineHeight: 22,
  },
});

export default ScriptBreakdown;
