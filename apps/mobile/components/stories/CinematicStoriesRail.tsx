import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import Animated, { FadeInRight, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { Ionicons } from '@/components/ui/SymbolIcon';
import { getMuxThumbnailUrl } from '@/components/media/muxPlayback';
import { colors, typography, spacing, borderRadius, shadows } from '@/lib/theme';
import { triggerHaptic } from '@/lib/haptics';
import { StoryViewer } from './StoryViewer';
import type { EpisodeWithSeries } from '@/hooks/useEpisodes';

type StoryEpisode = EpisodeWithSeries & {
  muxFinalPlaybackId?: string | null;
  muxPlaybackUrl?: string | null;
  thumbnailUrl?: string | null;
  finalVideoUrl?: string | null;
};

interface CinematicStoriesRailProps {
  episodes: StoryEpisode[];
  onOpenEpisode: (id: string) => void;
  themeMode?: 'dark' | 'light';
}

function StoryBubble({
  episode,
  index,
  onPress,
  themeMode = 'dark',
}: {
  episode: StoryEpisode;
  index: number;
  onPress: () => void;
  themeMode?: 'dark' | 'light';
}) {
  const poster =
    episode.thumbnailUrl ||
    (episode.muxFinalPlaybackId
      ? getMuxThumbnailUrl(episode.muxFinalPlaybackId, { width: 200, fit: 'smartcrop' })
      : null);

  const hasVideo = Boolean(episode.muxFinalPlaybackId || episode.muxPlaybackUrl || episode.finalVideoUrl);
  const isDark = themeMode === 'dark';
  const palette = isDark
    ? {
        label: 'rgba(255,255,255,0.85)',
        ringInner: '#000',
        avatarFallback: '#111820',
      }
    : {
        label: colors.text.muted,
        ringInner: colors.panel,
        avatarFallback: colors.panelAlt,
      };
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View entering={FadeInRight.delay(index * 50).duration(280)} style={animatedStyle}>
      <Pressable
        onPressIn={() => {
          scale.value = withSpring(0.92, { damping: 12 });
        }}
        onPressOut={() => {
          scale.value = withSpring(1, { damping: 12 });
        }}
        onPress={() => {
          triggerHaptic('medium');
          onPress();
        }}
        style={styles.bubble}
      >
        <View style={styles.ringOuter}>
          <View style={[styles.ringMiddle, { backgroundColor: palette.ringInner }]}>
            <View style={[styles.avatarContainer, { backgroundColor: palette.avatarFallback }]}>
              {poster ? (
                <Image source={{ uri: poster }} style={styles.avatarImage} contentFit="cover" />
              ) : (
                <View style={styles.avatarFallback}>
                  <Ionicons name="film" size={20} color="rgba(255,255,255,0.4)" />
                </View>
              )}
              {hasVideo ? (
                <View style={styles.videoIndicator}>
                  <Ionicons name="play" size={8} color="#fff" />
                </View>
              ) : null}
            </View>
          </View>
        </View>
        <Text style={[styles.label, { color: palette.label }]} numberOfLines={1}>
          {episode.title.length > 10 ? `${episode.title.slice(0, 10)}…` : episode.title}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

export function CinematicStoriesRail({
  episodes,
  onOpenEpisode,
  themeMode = 'dark',
}: CinematicStoriesRailProps) {
  const [viewerVisible, setViewerVisible] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);
  const isDark = themeMode !== 'light';
  const palette = isDark
    ? {
        title: '#FFFFFF',
        badgeBg: 'rgba(92,246,255,0.15)',
        badgeText: '#5CF6FF',
        label: 'rgba(255,255,255,0.85)',
        ringInner: '#000',
        avatarFallback: '#111820',
      }
    : {
        title: colors.text.DEFAULT,
        badgeBg: 'rgba(14,165,168,0.14)',
        badgeText: colors.primary.DEFAULT,
        label: colors.text.muted,
        ringInner: colors.panel,
        avatarFallback: colors.panelAlt,
      };

  const storyEpisodes = episodes.filter(
    (ep) => ep.status === 'ready' || ep.status === 'published'
  ).slice(0, 15);

  if (storyEpisodes.length === 0) return null;

  const openStory = (index: number) => {
    setViewerIndex(index);
    setViewerVisible(true);
  };

  return (
    <>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: palette.title }]}>Stories</Text>
          <View style={[styles.countBadge, { backgroundColor: palette.badgeBg }]}>
            <Text style={[styles.countText, { color: palette.badgeText }]}>{storyEpisodes.length}</Text>
          </View>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.rail}
        >
          {storyEpisodes.map((ep, i) => (
            <StoryBubble
              key={ep.id}
              episode={ep}
              index={i}
              onPress={() => openStory(i)}
              themeMode={themeMode}
            />
          ))}
        </ScrollView>
      </View>

      <StoryViewer
        visible={viewerVisible}
        episodes={storyEpisodes}
        initialIndex={viewerIndex}
        onClose={() => setViewerVisible(false)}
        onOpenEpisode={onOpenEpisode}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  title: {
    color: '#FFFFFF',
    fontSize: typography.fontSize.lg,
    fontFamily: typography.fontFamily.heading,
    fontWeight: typography.fontWeight.bold,
  },
  countBadge: {
    backgroundColor: 'rgba(92,246,255,0.15)',
    borderRadius: borderRadius.full,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  countText: {
    color: '#5CF6FF',
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily.mono,
    fontWeight: typography.fontWeight.bold,
  },
  rail: {
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  bubble: {
    alignItems: 'center',
    width: 78,
  },
  ringOuter: {
    width: 72,
    height: 72,
    borderRadius: 36,
    padding: 2,
    backgroundColor: 'transparent',
    borderWidth: 2.5,
    borderColor: '#5CF6FF',
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.md,
    shadowColor: '#5CF6FF',
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  ringMiddle: {
    width: '100%',
    height: '100%',
    borderRadius: 34,
    padding: 2,
    backgroundColor: '#000',
  },
  avatarContainer: {
    flex: 1,
    borderRadius: 30,
    overflow: 'hidden',
    backgroundColor: '#111820',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoIndicator: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    marginTop: spacing.xs,
    color: 'rgba(255,255,255,0.85)',
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily.body,
    fontWeight: typography.fontWeight.semibold,
    textAlign: 'center',
  },
});

export default CinematicStoriesRail;
