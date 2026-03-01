/**
 * ScriptViewer
 *
 * Rich script viewer with beat-by-beat visualization.
 * Shows script beats with type labels, timing, and emotional tone.
 */

import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useTheme } from '@/contexts/ThemeContext';
import { borderRadius, spacing, typography } from '@/lib/theme';
import type { ScriptBeat } from '@/hooks/useEpisodes';

interface ScriptViewerProps {
  scriptContent: string;
  beats?: ScriptBeat[] | null;
  compact?: boolean;
}

const BEAT_TYPE_CONFIG: Record<string, { label: string; color: string; darkColor: string }> = {
  hook: { label: 'Hook', color: '#E11D48', darkColor: '#FB7185' },
  intro: { label: 'Intro', color: '#7C3AED', darkColor: '#A78BFA' },
  problem: { label: 'Problem', color: '#DC2626', darkColor: '#F87171' },
  solution: { label: 'Solution', color: '#059669', darkColor: '#34D399' },
  proof: { label: 'Proof', color: '#0284C7', darkColor: '#38BDF8' },
  benefit: { label: 'Benefit', color: '#16A34A', darkColor: '#4ADE80' },
  story: { label: 'Story', color: '#9333EA', darkColor: '#C084FC' },
  transition: { label: 'Transition', color: '#6B7280', darkColor: '#9CA3AF' },
  cta: { label: 'CTA', color: '#EA580C', darkColor: '#FB923C' },
  outro: { label: 'Outro', color: '#0891B2', darkColor: '#22D3EE' },
  body: { label: 'Body', color: '#0EA5A8', darkColor: '#5CF6FF' },
};

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

function BeatCard({
  beat,
  index,
  isDark,
}: {
  beat: ScriptBeat;
  index: number;
  isDark: boolean;
}) {
  const config = BEAT_TYPE_CONFIG[beat.beatType] || BEAT_TYPE_CONFIG.body;
  const tagColor = isDark ? config.darkColor : config.color;

  return (
    <Animated.View
      entering={FadeInDown.delay(index * 40).duration(300)}
      style={[
        styles.beatCard,
        {
          backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : '#F8FAFC',
          borderLeftColor: tagColor,
          borderColor: isDark ? 'rgba(255,255,255,0.06)' : '#E2E8F0',
        },
      ]}
    >
      <View style={styles.beatHeader}>
        <View style={[styles.beatTag, { backgroundColor: tagColor + (isDark ? '22' : '18') }]}>
          <Text style={[styles.beatTagText, { color: tagColor }]}>
            {config.label}
          </Text>
        </View>
        <Text style={[styles.beatTiming, { color: isDark ? 'rgba(255,255,255,0.45)' : '#94A3B8' }]}>
          {formatDuration(beat.startTime)} - {formatDuration(beat.endTime)}
        </Text>
      </View>
      <Text
        style={[
          styles.beatText,
          { color: isDark ? '#F1F5F9' : '#1E293B' },
        ]}
      >
        {beat.text}
      </Text>
      {beat.duration > 0 && (
        <Text style={[styles.beatDuration, { color: isDark ? 'rgba(255,255,255,0.35)' : '#CBD5E1' }]}>
          {formatDuration(beat.duration)}
        </Text>
      )}
    </Animated.View>
  );
}

export function ScriptViewer({ scriptContent, beats, compact = false }: ScriptViewerProps) {
  const { isDark } = useTheme();

  const hasBeats = beats && beats.length > 0;
  const totalDuration = useMemo(() => {
    if (!beats?.length) return 0;
    return beats.reduce((sum, b) => sum + (b.duration || 0), 0);
  }, [beats]);

  if (!scriptContent?.trim()) return null;

  // If no beats, show plain script with nice typography
  if (!hasBeats || compact) {
    return (
      <View style={styles.container}>
        <Text
          style={[
            styles.plainScript,
            { color: isDark ? '#E2E8F0' : '#334155' },
          ]}
        >
          {scriptContent}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Summary bar */}
      <View
        style={[
          styles.summaryBar,
          {
            backgroundColor: isDark ? 'rgba(92,246,255,0.08)' : 'rgba(14,165,168,0.06)',
            borderColor: isDark ? 'rgba(92,246,255,0.15)' : 'rgba(14,165,168,0.15)',
          },
        ]}
      >
        <Text style={[styles.summaryText, { color: isDark ? '#5CF6FF' : '#0EA5A8' }]}>
          {beats.length} beats
        </Text>
        <View style={styles.summaryDot} />
        <Text style={[styles.summaryText, { color: isDark ? 'rgba(255,255,255,0.6)' : '#64748B' }]}>
          ~{formatDuration(totalDuration)} total
        </Text>
      </View>

      {/* Beat cards */}
      {beats.map((beat, i) => (
        <BeatCard key={`${beat.beatType}-${i}`} beat={beat} index={i} isDark={isDark} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
  },
  plainScript: {
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.base,
    lineHeight: 24,
  },
  summaryBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
  },
  summaryText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.medium as any,
    letterSpacing: 0.3,
  },
  summaryDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: '#94A3B8',
    marginHorizontal: spacing.sm,
  },
  beatCard: {
    padding: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderLeftWidth: 3,
    gap: spacing.xs + 2,
  },
  beatHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  beatTag: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.xs,
  },
  beatTagText: {
    fontFamily: typography.fontFamily.heading,
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.bold as any,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  beatTiming: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 10,
  },
  beatText: {
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm + 1,
    lineHeight: 20,
  },
  beatDuration: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 10,
    textAlign: 'right',
  },
});
