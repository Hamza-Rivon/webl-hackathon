/**
 * VoiceoverCompare
 *
 * Animated tab switcher for comparing Original vs Cleaned voiceover audio.
 * Shows duration reduction badge and transcript comparison.
 */

import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import { useTheme } from '@/contexts/ThemeContext';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { AudioPlayer } from '@/components/media/AudioPlayer';
import type { AudioTranscriptWord } from '@/components/media/AudioPlayer';
import { borderRadius, spacing, typography } from '@/lib/theme';

interface VoiceoverCompareProps {
  /** Mux playback ID for the raw/original voiceover (legacy muxVoiceoverAssetId or raw) */
  originalPlaybackId?: string | null;
  /** Mux playback ID for the cleaned voiceover */
  cleanedPlaybackId?: string | null;
  /** Raw voiceover duration in seconds */
  originalDuration?: number | null;
  /** Cleaned voiceover duration in seconds */
  cleanedDuration?: number | null;
  /** Original word-level transcript */
  originalTranscript?: AudioTranscriptWord[] | null;
  /** Corrected/cleaned word-level transcript */
  cleanedTranscript?: AudioTranscriptWord[] | null;
  /** Script text for display */
  scriptText?: string;
}

export function VoiceoverCompare({
  originalPlaybackId,
  cleanedPlaybackId,
  originalDuration,
  cleanedDuration,
  originalTranscript,
  cleanedTranscript,
  scriptText,
}: VoiceoverCompareProps) {
  const { colors, isDark } = useTheme();
  const [activeTab, setActiveTab] = useState(cleanedPlaybackId ? 1 : 0);

  const hasOriginal = Boolean(originalPlaybackId);
  const hasCleaned = Boolean(cleanedPlaybackId);

  // Calculate duration reduction percentage
  const durationReduction =
    originalDuration && cleanedDuration && originalDuration > 0
      ? Math.round(((originalDuration - cleanedDuration) / originalDuration) * 100)
      : null;

  const options = [
    { label: 'Original' },
    {
      label: 'Cleaned',
      badge: durationReduction && durationReduction > 0 ? `${durationReduction}% shorter` : undefined,
    },
  ];

  // If only one version exists, don't show tabs
  if (!hasOriginal && !hasCleaned) {
    return (
      <View style={[styles.container, { backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)' }]}>
        <Text style={[styles.emptyText, { color: colors.text.muted }]}>
          No voiceover available yet.
        </Text>
      </View>
    );
  }

  if (!hasOriginal && hasCleaned) {
    return (
      <View style={styles.wrapper}>
        <Text style={[styles.sectionTitle, { color: colors.text.DEFAULT }]}>
          Voiceover Preview
        </Text>
        <AudioPlayer
          muxPlaybackId={cleanedPlaybackId!}
          title="Cleaned Voiceover"
          defaultExpanded={false}
          transcriptWords={cleanedTranscript || []}
          scriptText={scriptText}
        />
      </View>
    );
  }

  return (
    <View style={styles.wrapper}>
      <Text style={[styles.sectionTitle, { color: colors.text.DEFAULT }]}>
        Voiceover Preview
      </Text>

      {/* Tab Switcher */}
      <SegmentedControl
        options={options}
        selectedIndex={activeTab}
        onSelect={setActiveTab}
      />

      {/* Audio Player — switches based on tab */}
      <Animated.View
        key={activeTab === 0 ? 'original' : 'cleaned'}
        entering={FadeIn.duration(250)}
        exiting={FadeOut.duration(150)}
        layout={LinearTransition.springify()}
        style={styles.playerWrap}
      >
        {activeTab === 0 && hasOriginal ? (
          <>
            <AudioPlayer
              muxPlaybackId={originalPlaybackId!}
              title="Original Recording"
              defaultExpanded={false}
              transcriptWords={originalTranscript || []}
              scriptText={scriptText}
            />
            {originalDuration ? (
              <View style={[styles.durationBadge, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]}>
                <Text style={[styles.durationText, { color: colors.text.muted }]}>
                  Duration: {formatSeconds(originalDuration)}
                </Text>
              </View>
            ) : null}
          </>
        ) : null}

        {activeTab === 1 && hasCleaned ? (
          <>
            <AudioPlayer
              muxPlaybackId={cleanedPlaybackId!}
              title="Cleaned Voiceover"
              defaultExpanded={false}
              transcriptWords={cleanedTranscript || []}
              scriptText={scriptText}
            />
            {cleanedDuration ? (
              <View style={[styles.durationBadge, { backgroundColor: isDark ? 'rgba(74,222,128,0.1)' : 'rgba(10,159,106,0.08)' }]}>
                <Text style={[styles.durationText, { color: isDark ? '#4ADE80' : '#0A9F6A' }]}>
                  Duration: {formatSeconds(cleanedDuration)}
                  {durationReduction && durationReduction > 0
                    ? ` (${durationReduction}% trimmed)`
                    : ''}
                </Text>
              </View>
            ) : null}
          </>
        ) : null}
      </Animated.View>
    </View>
  );
}

function formatSeconds(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  wrapper: {
    gap: spacing.md,
  },
  container: {
    padding: spacing.xl,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitle: {
    fontFamily: typography.fontFamily.heading,
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold as any,
  },
  playerWrap: {
    gap: spacing.sm,
  },
  emptyText: {
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
  },
  durationBadge: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: borderRadius.sm,
    alignSelf: 'flex-start',
  },
  durationText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold as any,
  },
});

export default VoiceoverCompare;
