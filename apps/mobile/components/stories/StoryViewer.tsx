import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Dimensions,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeOut,
  SlideInRight,
  SlideOutLeft,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@/components/ui/SymbolIcon';
import { VideoPlayer, getMuxThumbnailUrl, type VideoPlayerRef } from '@/components/media/VideoPlayer';
import { typography, spacing, borderRadius } from '@/lib/theme';
import { triggerHaptic } from '@/lib/haptics';
import type { EpisodeWithSeries } from '@/hooks/useEpisodes';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const PROGRESS_BAR_GAP = 3;

type StoryEpisode = EpisodeWithSeries & {
  muxFinalPlaybackId?: string | null;
  muxPlaybackUrl?: string | null;
  thumbnailUrl?: string | null;
  finalVideoUrl?: string | null;
};

interface StoryViewerProps {
  visible: boolean;
  episodes: StoryEpisode[];
  initialIndex: number;
  onClose: () => void;
  onOpenEpisode: (id: string) => void;
}

function ProgressBar({
  index,
  activeIndex,
  progress,
  total,
}: {
  index: number;
  activeIndex: number;
  progress: number;
  total: number;
}) {
  const barWidth = (SCREEN_WIDTH - spacing.lg * 2 - PROGRESS_BAR_GAP * (total - 1)) / total;

  const fillWidth =
    index < activeIndex ? '100%' : index === activeIndex ? `${progress * 100}%` : '0%';

  return (
    <View style={[styles.progressBarBg, { width: barWidth }]}>
      <View style={[styles.progressBarFill, { width: fillWidth as ViewStyle['width'] }]} />
    </View>
  );
}

export function StoryViewer({
  visible,
  episodes,
  initialIndex,
  onClose,
  onOpenEpisode,
}: StoryViewerProps) {
  const insets = useSafeAreaInsets();
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [progress, setProgress] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const playerRef = useRef<VideoPlayerRef>(null);
  const progressTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const episode = episodes[currentIndex] ?? null;
  const playbackId = episode?.muxFinalPlaybackId || null;
  const videoUri = episode?.muxPlaybackUrl || episode?.finalVideoUrl || null;
  const poster =
    episode?.thumbnailUrl ||
    (playbackId ? getMuxThumbnailUrl(playbackId, { width: 720, fit: 'smartcrop' }) : null);
  const hasVideo = Boolean(playbackId || videoUri);

  useEffect(() => {
    setCurrentIndex(initialIndex);
    setProgress(0);
  }, [initialIndex, visible]);

  useEffect(() => {
    if (!visible || isPaused || hasVideo) return;

    progressTimer.current = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 1) {
          return 0;
        }
        return prev + 0.02;
      });
    }, 100);

    return () => {
      if (progressTimer.current) clearInterval(progressTimer.current);
    };
  }, [visible, currentIndex, isPaused, hasVideo]);

  const goNext = useCallback(() => {
    if (currentIndex < episodes.length - 1) {
      setCurrentIndex((i) => i + 1);
      setProgress(0);
      triggerHaptic('light');
    } else {
      onClose();
    }
  }, [currentIndex, episodes.length, onClose]);

  useEffect(() => {
    if (progress >= 1 && !hasVideo) {
      goNext();
    }
  }, [progress, hasVideo, goNext]);

  const goPrev = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex((i) => i - 1);
      setProgress(0);
      triggerHaptic('light');
    }
  }, [currentIndex]);

  const handleTap = useCallback(
    (x: number) => {
      if (x < SCREEN_WIDTH * 0.3) {
        goPrev();
      } else if (x > SCREEN_WIDTH * 0.7) {
        goNext();
      } else {
        setIsPaused((p) => !p);
      }
    },
    [goNext, goPrev]
  );

  if (!visible || !episode) return null;

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent={false}
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        <Pressable
          style={styles.touchArea}
          onPress={(e) => handleTap(e.nativeEvent.locationX)}
        >
          {hasVideo ? (
            <View style={styles.videoContainer}>
              <VideoPlayer
                ref={playerRef}
                muxPlaybackId={playbackId || undefined}
                uri={!playbackId ? videoUri || undefined : undefined}
                posterUri={poster || undefined}
                showControls={false}
                autoPlay
                loop={false}
                muted={isMuted}
                contentFit="contain"
                aspectRatio={9 / 16}
                onPlaybackStatusUpdate={(status) => {
                  if (status.duration > 0) {
                    setProgress(status.currentTime / status.duration);
                  }
                }}
                onEnd={goNext}
                style={styles.videoFill}
              />
            </View>
          ) : poster ? (
            <Image source={{ uri: poster }} style={styles.storyImage} contentFit="cover" />
          ) : (
            <View style={styles.storyPlaceholder}>
              <Ionicons name="film-outline" size={48} color="rgba(255,255,255,0.2)" />
            </View>
          )}
        </Pressable>

        {/* Top UI */}
        <Animated.View
          entering={FadeInDown.duration(250)}
          style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]}
        >
          <View style={styles.progressRow}>
            {episodes.map((_, i) => (
              <ProgressBar
                key={i}
                index={i}
                activeIndex={currentIndex}
                progress={progress}
                total={episodes.length}
              />
            ))}
          </View>

          <View style={styles.headerRow}>
            <View style={styles.headerInfo}>
              <View style={styles.storyAvatar}>
                {poster ? (
                  <Image source={{ uri: poster }} style={styles.storyAvatarImg} contentFit="cover" />
                ) : (
                  <Ionicons name="film" size={14} color="#fff" />
                )}
              </View>
              <View>
                <Text style={styles.storyTitle} numberOfLines={1}>
                  {episode.title}
                </Text>
                <Text style={styles.storySubtitle} numberOfLines={1}>
                  {episode.series?.name || 'Standalone'} · Updated{' '}
                  {new Date(episode.updatedAt).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                  })}
                </Text>
              </View>
            </View>

            <View style={styles.headerActions}>
              {hasVideo ? (
                <Pressable
                  onPress={() => setIsMuted((m) => !m)}
                  style={styles.iconBtn}
                >
                  <Ionicons
                    name={isMuted ? 'volume-mute' : 'volume-high'}
                    size={18}
                    color="#fff"
                  />
                </Pressable>
              ) : null}
              <Pressable onPress={onClose} style={styles.iconBtn}>
                <Ionicons name="close" size={20} color="#fff" />
              </Pressable>
            </View>
          </View>
        </Animated.View>

        {/* Bottom CTA */}
        <Animated.View
          entering={FadeIn.delay(200).duration(300)}
          style={[styles.bottomBar, { paddingBottom: insets.bottom + spacing.md }]}
        >
          <Pressable
            onPress={() => {
              triggerHaptic('medium');
              onClose();
              setTimeout(() => onOpenEpisode(episode.id), 300);
            }}
            style={({ pressed }) => [styles.ctaBtn, pressed && styles.ctaPressed]}
          >
            <Ionicons name="arrow-up" size={16} color="#000" />
            <Text style={styles.ctaText}>View Episode</Text>
          </Pressable>

          {isPaused ? (
            <View style={styles.pausedBadge}>
              <Ionicons name="pause" size={12} color="#fff" />
              <Text style={styles.pausedText}>Paused</Text>
            </View>
          ) : null}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  touchArea: {
    flex: 1,
  },
  videoContainer: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoFill: {
    width: '100%',
    maxHeight: '100%',
    borderRadius: 0,
    borderWidth: 0,
    shadowOpacity: 0,
    elevation: 0,
  },
  storyImage: {
    flex: 1,
  },
  storyPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0A0E14',
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
    zIndex: 10,
  },
  progressRow: {
    flexDirection: 'row',
    gap: PROGRESS_BAR_GAP,
  },
  progressBarBg: {
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.25)',
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 2,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  storyAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#5CF6FF',
  },
  storyAvatarImg: {
    width: '100%',
    height: '100%',
  },
  storyTitle: {
    color: '#FFFFFF',
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily.heading,
    fontWeight: typography.fontWeight.bold,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  storySubtitle: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily.body,
  },
  headerActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  ctaBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FFFFFF',
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  ctaPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.97 }],
  },
  ctaText: {
    color: '#000',
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily.body,
    fontWeight: typography.fontWeight.bold,
  },
  pausedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  pausedText: {
    color: '#FFFFFF',
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily.body,
  },
});

export default StoryViewer;
