import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { FlashList } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeInDown, FadeInUp } from 'react-native-reanimated';
import { Ionicons } from '@/components/ui/SymbolIcon';
import { EmptyState, Skeleton } from '@/components/ui';
import { FeedPlayer } from '@/components/media/FeedPlayer';
import { getMuxThumbnailUrl } from '@/components/media/muxPlayback';
import { useEpisodes, type EpisodeWithSeries } from '@/hooks/useEpisodes';
import { colors, spacing, typography, borderRadius } from '@/lib/theme';
import { trackPrimaryAction, trackScreenView } from '@/lib/analytics';
import { triggerHaptic } from '@/lib/haptics';

type FeedEpisode = EpisodeWithSeries & {
  muxFinalPlaybackId?: string | null;
  muxPlaybackUrl?: string | null;
  thumbnailUrl?: string | null;
  finalVideoUrl?: string | null;
};

function getEpisodeVideoUrl(episode: FeedEpisode) {
  const playbackId = episode.muxFinalPlaybackId || null;
  const uri = episode.muxPlaybackUrl || episode.finalVideoUrl || null;
  const poster =
    episode.thumbnailUrl ||
    (playbackId ? getMuxThumbnailUrl(playbackId, { width: 720, fit: 'smartcrop' }) : null);
  return { playbackId, uri, poster };
}

function FeedVideoTile({
  episode,
  active,
  height,
  isMuted,
  onToggleMute,
  onOpenPreview,
  onOpenEpisode,
}: {
  episode: FeedEpisode;
  active: boolean;
  height: number;
  isMuted: boolean;
  onToggleMute: () => void;
  onOpenPreview: () => void;
  onOpenEpisode: () => void;
}) {
  const { playbackId, uri, poster } = getEpisodeVideoUrl(episode);

  const updatedLabel = new Date(episode.updatedAt).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });

  return (
    <View style={[styles.slide, { height }]}>
      <View style={styles.videoShell}>
        <FeedPlayer
          muxPlaybackId={playbackId}
          videoUri={uri}
          posterUri={poster}
          active={active}
          muted={isMuted}
          onDoubleTap={onOpenPreview}
        />

        <Animated.View entering={FadeInDown.duration(300)} style={styles.topRow} pointerEvents="box-none">
          <View style={styles.feedBadge}>
            <Ionicons name="sparkles-outline" size={11} color="#5CF6FF" />
            <Text style={styles.feedBadgeText}>AI Generated</Text>
          </View>
          <Text style={styles.updatedText}>{updatedLabel}</Text>
        </Animated.View>

        <View style={styles.sideActions} pointerEvents="box-none">
          <Pressable
            onPress={() => {
              triggerHaptic('light');
              onToggleMute();
            }}
            style={styles.sideBtn}
          >
            <Ionicons
              name={isMuted ? 'volume-mute' : 'volume-high'}
              size={20}
              color="#fff"
            />
            <Text style={styles.sideBtnText}>{isMuted ? 'Muted' : 'Sound'}</Text>
          </Pressable>

          <Pressable
            onPress={() => {
              triggerHaptic('light');
              onOpenEpisode();
            }}
            style={styles.sideBtn}
          >
            <Ionicons name="layers-outline" size={20} color="#fff" />
            <Text style={styles.sideBtnText}>Details</Text>
          </Pressable>

          <Pressable
            onPress={() => {
              triggerHaptic('medium');
              onOpenPreview();
            }}
            style={styles.sideBtn}
          >
            <Ionicons name="expand-outline" size={20} color="#fff" />
            <Text style={styles.sideBtnText}>Full</Text>
          </Pressable>
        </View>

        <Animated.View entering={FadeInUp.delay(100).duration(300)} style={styles.bottomPanel} pointerEvents="box-none">
          <Text style={styles.episodeTitle} numberOfLines={2}>
            {episode.title}
          </Text>
          <Text style={styles.seriesText} numberOfLines={1}>
            {episode.series?.name ? episode.series.name : 'Standalone episode'}
          </Text>

          <Pressable
            onPress={() => {
              triggerHaptic('medium');
              onOpenPreview();
            }}
            style={({ pressed }) => [styles.watchBtn, pressed && styles.watchBtnPressed]}
          >
            <Ionicons name="play" size={16} color="#000" />
            <Text style={styles.watchBtnText}>Watch Full Video</Text>
          </Pressable>
        </Animated.View>
      </View>
    </View>
  );
}

export default function FeedScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { height: viewportHeight } = useWindowDimensions();
  const isFocused = pathname === '/feed';
  const pageHeight = Math.max(420, viewportHeight - insets.top - insets.bottom - 116);

  const [activeIndex, setActiveIndex] = useState(0);
  const [globalMuted, setGlobalMuted] = useState(true);

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: Array<{ index: number | null }> }) => {
      const firstVisible = viewableItems.find((item) => typeof item.index === 'number');
      if (firstVisible?.index != null) {
        setActiveIndex(firstVisible.index);
      }
    }
  );
  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 72,
    minimumViewTime: 120,
  });
  const { data, isLoading, isError } = useEpisodes();

  useEffect(() => {
    trackScreenView('feed');
  }, []);

  const feedEpisodes = useMemo(() => {
    const episodes = (data || []) as FeedEpisode[];
    return episodes
      .filter((episode) => episode.status === 'ready' || episode.status === 'published')
      .filter((episode) => {
        const { playbackId, uri } = getEpisodeVideoUrl(episode);
        return Boolean(playbackId || uri);
      });
  }, [data]);

  if (isLoading) {
    return (
      <View style={styles.screen}>
        <View style={[styles.loadingWrap, { paddingTop: insets.top + spacing['2xl'] }]}>
          <Skeleton height={pageHeight} radius="xl" />
        </View>
      </View>
    );
  }

  if (isError) {
    return (
      <View style={styles.screen}>
        <View style={{ paddingTop: insets.top + spacing['2xl'] }}>
          <EmptyState
            title="Feed unavailable"
            description="Could not load rendered videos right now."
            icon={<Ionicons name="warning-outline" size={44} color={colors.warning} />}
          />
        </View>
      </View>
    );
  }

  if (feedEpisodes.length === 0) {
    return (
      <View style={styles.screen}>
        <View style={{ paddingTop: insets.top + spacing['2xl'] }}>
          <EmptyState
            title="No rendered videos yet"
            description="Rendered episodes will appear here as a vertical feed."
            icon={<Ionicons name="film-outline" size={44} color="#5CF6FF" />}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <FlashList
        data={feedEpisodes}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{
          paddingTop: insets.top + spacing.sm,
          paddingBottom: insets.bottom + 112,
          paddingHorizontal: spacing.sm,
        }}
        showsVerticalScrollIndicator={false}
        snapToInterval={pageHeight + spacing.md}
        decelerationRate="fast"
        disableIntervalMomentum
        viewabilityConfig={viewabilityConfig.current}
        onViewableItemsChanged={onViewableItemsChanged.current}
        onMomentumScrollEnd={(event) => {
          const index = Math.round(
            event.nativeEvent.contentOffset.y / (pageHeight + spacing.md)
          );
          setActiveIndex(Math.max(0, Math.min(feedEpisodes.length - 1, index)));
        }}
        renderItem={({ item, index }) => (
          <FeedVideoTile
            episode={item}
            active={isFocused && index === activeIndex}
            height={pageHeight}
            isMuted={globalMuted}
            onToggleMute={() => setGlobalMuted((m) => !m)}
            onOpenPreview={() => {
              trackPrimaryAction('feed_open_preview', { episodeId: item.id });
              router.push(`/(main)/episode/${item.id}/preview`);
            }}
            onOpenEpisode={() => {
              trackPrimaryAction('feed_open_episode', { episodeId: item.id });
              router.push(`/(main)/episode/${item.id}`);
            }}
          />
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#0A0E14',
  },
  loadingWrap: {
    flex: 1,
    paddingHorizontal: spacing.sm,
  },
  slide: {
    marginBottom: spacing.md,
  },
  videoShell: {
    flex: 1,
    borderRadius: borderRadius.xl,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  topRow: {
    position: 'absolute',
    top: spacing.md,
    left: spacing.md,
    right: spacing.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  feedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: borderRadius.full,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderWidth: 1,
    borderColor: 'rgba(92,246,255,0.2)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
  },
  feedBadgeText: {
    color: '#5CF6FF',
    fontFamily: typography.fontFamily.mono,
    fontSize: 10,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  updatedText: {
    color: 'rgba(255,255,255,0.65)',
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.medium,
  },
  sideActions: {
    position: 'absolute',
    right: spacing.md,
    bottom: 160,
    gap: spacing.lg,
    alignItems: 'center',
  },
  sideBtn: {
    alignItems: 'center',
    gap: 4,
  },
  sideBtnText: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 10,
    fontFamily: typography.fontFamily.body,
    fontWeight: typography.fontWeight.semibold,
  },
  bottomPanel: {
    position: 'absolute',
    left: spacing.md,
    right: 60,
    bottom: spacing.lg,
    gap: spacing.xs,
  },
  episodeTitle: {
    color: '#FFFFFF',
    fontFamily: typography.fontFamily.heading,
    fontSize: typography.fontSize.xl,
    fontWeight: typography.fontWeight.bold,
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  seriesText: {
    color: 'rgba(255,255,255,0.7)',
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
  },
  watchBtn: {
    marginTop: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    backgroundColor: '#FFFFFF',
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  watchBtnPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.97 }],
  },
  watchBtnText: {
    color: '#000',
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.bold,
  },
});
