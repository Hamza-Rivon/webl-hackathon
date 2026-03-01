/**
 * ARollCompare
 *
 * Modern switcher for comparing Original vs Cleaned A-Roll video.
 * Animated cross-fade transition with 3D depth effect.
 */

import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import { useTheme } from '@/contexts/ThemeContext';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { VideoPlayer } from '@/components/media/VideoPlayer';
import { borderRadius, spacing, typography } from '@/lib/theme';

interface ARollCompareProps {
  /** Mux playback ID for the original A-Roll recording */
  originalPlaybackId?: string | null;
  /** Mux playback ID for the cleaned A-Roll preview */
  cleanedPlaybackId?: string | null;
  /** Original A-Roll duration in seconds */
  originalDuration?: number | null;
  /** Cleaned A-Roll duration in seconds */
  cleanedDuration?: number | null;
}

export function ARollCompare({
  originalPlaybackId,
  cleanedPlaybackId,
  originalDuration,
  cleanedDuration,
}: ARollCompareProps) {
  const { colors, isDark } = useTheme();
  const [activeTab, setActiveTab] = useState(cleanedPlaybackId ? 1 : 0);

  const hasOriginal = Boolean(originalPlaybackId);
  const hasCleaned = Boolean(cleanedPlaybackId);

  if (!hasOriginal && !hasCleaned) {
    return null;
  }

  // Duration comparison badge
  const durationReduction =
    originalDuration && cleanedDuration && originalDuration > 0
      ? Math.round(((originalDuration - cleanedDuration) / originalDuration) * 100)
      : null;

  const options = [
    { label: 'Original' },
    {
      label: 'Cleaned',
      badge: durationReduction && durationReduction > 0 ? `${durationReduction}% trimmed` : undefined,
    },
  ];

  // Only cleaned exists, show without tabs
  if (!hasOriginal && hasCleaned) {
    return (
      <View style={styles.wrapper}>
        <Text style={[styles.sectionTitle, { color: colors.text.DEFAULT }]}>
          Cleaned A-Roll Video
        </Text>
        <View style={[styles.videoWrap, { borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }]}>
          <VideoPlayer
            muxPlaybackId={cleanedPlaybackId!}
            showControls
            enablePlaybackSpeed
            enableFullscreen
            contentFit="contain"
            aspectRatio={9 / 16}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.wrapper}>
      <Text style={[styles.sectionTitle, { color: colors.text.DEFAULT }]}>
        A-Roll Video
      </Text>

      {/* Tab Switcher */}
      <SegmentedControl
        options={options}
        selectedIndex={activeTab}
        onSelect={setActiveTab}
      />

      {/* Video Player — switches based on tab */}
      <Animated.View
        key={activeTab === 0 ? 'original-video' : 'cleaned-video'}
        entering={FadeIn.duration(300)}
        exiting={FadeOut.duration(200)}
        layout={LinearTransition.springify()}
      >
        <View
          style={[
            styles.videoWrap,
            {
              borderColor: isDark
                ? activeTab === 1
                  ? 'rgba(74,222,128,0.2)'
                  : 'rgba(255,255,255,0.08)'
                : activeTab === 1
                  ? 'rgba(10,159,106,0.15)'
                  : 'rgba(0,0,0,0.06)',
              shadowColor: activeTab === 1 ? '#4ADE80' : 'transparent',
              shadowOpacity: activeTab === 1 ? 0.12 : 0,
            },
          ]}
        >
          {activeTab === 0 && hasOriginal ? (
            <VideoPlayer
              muxPlaybackId={originalPlaybackId!}
              showControls
              enablePlaybackSpeed
              enableFullscreen
              contentFit="contain"
              aspectRatio={9 / 16}
            />
          ) : null}

          {activeTab === 1 && hasCleaned ? (
            <VideoPlayer
              muxPlaybackId={cleanedPlaybackId!}
              showControls
              enablePlaybackSpeed
              enableFullscreen
              contentFit="contain"
              aspectRatio={9 / 16}
            />
          ) : null}

          {/* Label overlay */}
          <View
            style={[
              styles.labelOverlay,
              {
                backgroundColor: isDark
                  ? 'rgba(0,0,0,0.6)'
                  : 'rgba(255,255,255,0.85)',
              },
            ]}
          >
            <View
              style={[
                styles.labelDot,
                {
                  backgroundColor:
                    activeTab === 1
                      ? isDark
                        ? '#4ADE80'
                        : '#0A9F6A'
                      : isDark
                        ? '#5CF6FF'
                        : '#0EA5A8',
                },
              ]}
            />
            <Text
              style={[
                styles.labelText,
                {
                  color: isDark ? '#FFFFFF' : colors.text.DEFAULT,
                },
              ]}
            >
              {activeTab === 0 ? 'Original Recording' : 'AI Cleaned'}
            </Text>
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: spacing.md,
  },
  sectionTitle: {
    fontFamily: typography.fontFamily.heading,
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold as any,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  videoWrap: {
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    overflow: 'hidden',
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 12,
    elevation: 4,
  },
  labelOverlay: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs + 1,
    borderRadius: borderRadius.full,
  },
  labelDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  labelText: {
    fontFamily: typography.fontFamily.body,
    fontSize: 10,
    fontWeight: typography.fontWeight.bold as any,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
});

export default ARollCompare;
