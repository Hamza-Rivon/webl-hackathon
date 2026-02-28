import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Dimensions,
  FlatList,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
  ViewToken,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  FadeIn,
  FadeInDown,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@/components/ui/SymbolIcon';
import { getMuxThumbnailUrl } from '@/components/media/muxPlayback';
import { colors, typography, spacing, borderRadius, shadows } from '@/lib/theme';
import { triggerHaptic } from '@/lib/haptics';
import type { EpisodeWithSeries } from '@/hooks/useEpisodes';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const HERO_HEIGHT = 420;
const DOT_SIZE = 8;

type HeroEpisode = EpisodeWithSeries & {
  muxFinalPlaybackId?: string | null;
  thumbnailUrl?: string | null;
};

interface HeroCarouselProps {
  episodes: HeroEpisode[];
  onPlay: (id: string) => void;
  onOpen: (id: string) => void;
}

function HeroSlide({
  episode,
  isActive,
  onPlay,
  onOpen,
}: {
  episode: HeroEpisode;
  isActive: boolean;
  onPlay: () => void;
  onOpen: () => void;
}) {
  const poster =
    episode.thumbnailUrl ||
    (episode.muxFinalPlaybackId
      ? getMuxThumbnailUrl(episode.muxFinalPlaybackId, { width: 1080, fit: 'smartcrop' })
      : null);

  const scale = useSharedValue(1);

  useEffect(() => {
    scale.value = withSpring(isActive ? 1 : 0.92, { damping: 18, stiffness: 200 });
  }, [isActive, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View style={[styles.slideContainer, animatedStyle]}>
      <View style={styles.slide}>
        {poster ? (
          <Image source={{ uri: poster }} style={styles.slideImage} contentFit="cover" />
        ) : (
          <View style={styles.slidePlaceholder}>
            <Ionicons name="film-outline" size={48} color="rgba(255,255,255,0.2)" />
          </View>
        )}

        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.3)', 'rgba(0,0,0,0.85)']}
          locations={[0, 0.4, 1]}
          style={styles.gradient}
        />

        <View style={styles.topBadgeRow}>
          {episode.series?.name ? (
            <View style={styles.seriesBadge}>
              <Ionicons name="layers" size={10} color="#5CF6FF" />
              <Text style={styles.seriesBadgeText}>{episode.series.name}</Text>
            </View>
          ) : null}
        </View>

        <Animated.View entering={FadeInDown.delay(100).duration(300)} style={styles.slideContent}>
          <Text style={styles.slideTitle} numberOfLines={2}>
            {episode.title}
          </Text>

          <View style={styles.slideMeta}>
            <View style={styles.statusDot} />
            <Text style={styles.slideStatus}>
              {episode.status === 'published' ? 'Published' : 'Ready'}
            </Text>
            <Text style={styles.slideSep}>·</Text>
            <Text style={styles.slideDate}>
              {new Date(episode.updatedAt).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
              })}
            </Text>
          </View>

          <View style={styles.slideActions}>
            <Pressable
              onPress={() => {
                triggerHaptic('medium');
                onPlay();
              }}
              style={({ pressed }) => [styles.playBtn, pressed && styles.btnPressed]}
            >
              <Ionicons name="play" size={16} color="#000" />
              <Text style={styles.playBtnText}>Play</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                triggerHaptic('light');
                onOpen();
              }}
              style={({ pressed }) => [styles.infoBtn, pressed && styles.btnPressed]}
            >
              <Ionicons name="information-circle-outline" size={16} color="#fff" />
              <Text style={styles.infoBtnText}>Details</Text>
            </Pressable>
          </View>
        </Animated.View>
      </View>
    </Animated.View>
  );
}

export function HeroCarousel({ episodes, onPlay, onOpen }: HeroCarouselProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const flatListRef = useRef<FlatList>(null);
  const autoScrollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    if (viewableItems.length > 0 && viewableItems[0].index != null) {
      setActiveIndex(viewableItems[0].index);
    }
  }, []);

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60 });

  useEffect(() => {
    if (episodes.length <= 1) return;
    autoScrollTimer.current = setInterval(() => {
      const next = ((activeIndex ?? 0) + 1) % episodes.length;
      flatListRef.current?.scrollToIndex({ index: next, animated: true });
    }, 5000);
    return () => {
      if (autoScrollTimer.current != null) {
        clearInterval(autoScrollTimer.current);
        autoScrollTimer.current = null;
      }
    };
  }, [activeIndex, episodes.length]);

  if (episodes.length === 0) return null;

  return (
    <Animated.View entering={FadeIn.duration(400)} style={styles.container}>
      <FlatList
        ref={flatListRef}
        data={episodes}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item) => item.id}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig.current}
        getItemLayout={(_, index) => ({
          length: SCREEN_WIDTH,
          offset: SCREEN_WIDTH * index,
          index,
        })}
        renderItem={({ item, index }) => (
          <HeroSlide
            episode={item}
            isActive={index === activeIndex}
            onPlay={() => onPlay(item.id)}
            onOpen={() => onOpen(item.id)}
          />
        )}
      />

      {episodes.length > 1 ? (
        <View style={styles.pagination}>
          {episodes.map((_, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                i === activeIndex ? styles.dotActive : styles.dotInactive,
              ]}
            />
          ))}
        </View>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.md,
  },
  slideContainer: {
    width: SCREEN_WIDTH,
    height: HERO_HEIGHT,
    paddingHorizontal: spacing.sm,
  },
  slide: {
    flex: 1,
    borderRadius: borderRadius.xl,
    overflow: 'hidden',
    backgroundColor: '#0A0E14',
    ...shadows.xl,
  },
  slideImage: {
    ...StyleSheet.absoluteFillObject,
  },
  slidePlaceholder: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0D1520',
  },
  gradient: {
    ...StyleSheet.absoluteFillObject,
  },
  topBadgeRow: {
    position: 'absolute',
    top: spacing.lg,
    left: spacing.lg,
    right: spacing.lg,
    flexDirection: 'row',
  },
  seriesBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: 'rgba(92,246,255,0.25)',
  },
  seriesBadgeText: {
    color: '#5CF6FF',
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily.body,
    fontWeight: typography.fontWeight.semibold,
  },
  slideContent: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  slideTitle: {
    color: '#FFFFFF',
    fontSize: typography.fontSize['2xl'],
    fontFamily: typography.fontFamily.heading,
    fontWeight: typography.fontWeight.bold,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  slideMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#22C55E',
  },
  slideStatus: {
    color: '#22C55E',
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily.body,
    fontWeight: typography.fontWeight.semibold,
  },
  slideSep: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: typography.fontSize.sm,
  },
  slideDate: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily.body,
  },
  slideActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  playBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FFFFFF',
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  playBtnText: {
    color: '#000',
    fontSize: typography.fontSize.base,
    fontFamily: typography.fontFamily.body,
    fontWeight: typography.fontWeight.bold,
  },
  infoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  infoBtnText: {
    color: '#FFFFFF',
    fontSize: typography.fontSize.base,
    fontFamily: typography.fontFamily.body,
    fontWeight: typography.fontWeight.semibold,
  },
  btnPressed: {
    opacity: 0.8,
    transform: [{ scale: 0.96 }],
  },
  pagination: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.md,
  },
  dot: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
  },
  dotActive: {
    backgroundColor: '#FFFFFF',
    width: DOT_SIZE * 3,
    borderRadius: DOT_SIZE / 2,
  },
  dotInactive: {
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
});

export default HeroCarousel;
