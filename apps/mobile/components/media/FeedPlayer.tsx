import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { useEvent } from 'expo';
import { VideoView, useVideoPlayer } from 'expo-video';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { Ionicons } from '@/components/ui/SymbolIcon';
import { getMuxStreamUrl, getMuxThumbnailUrl } from './muxPlayback';
import { triggerHaptic } from '@/lib/haptics';
import { borderRadius, colors, spacing } from '@/lib/theme';
import { VideoPlayerWaitingBars } from './VideoPlayerWaitingBars';

interface FeedPlayerProps {
  muxPlaybackId?: string | null;
  videoUri?: string | null;
  posterUri?: string | null;
  active: boolean;
  muted: boolean;
  onDoubleTap?: () => void;
  style?: object;
}

export function FeedPlayer({
  muxPlaybackId,
  videoUri,
  posterUri,
  active,
  muted,
  onDoubleTap,
  style,
}: FeedPlayerProps) {
  const videoViewRef = useRef<VideoView>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [manualPaused, setManualPaused] = useState(false);
  const lastTapRef = useRef<number>(0);
  const doubleTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const streamUrl = videoUri || (muxPlaybackId ? getMuxStreamUrl(muxPlaybackId) : '');

  const poster =
    posterUri ||
    (muxPlaybackId
      ? getMuxThumbnailUrl(muxPlaybackId, { width: 720, fit: 'smartcrop' })
      : null);

  const source = { uri: streamUrl };

  const player = useVideoPlayer(source, (instance) => {
    instance.loop = true;
    instance.muted = muted;
    instance.timeUpdateEventInterval = 0.5;
    instance.subtitleTrack = null;
  });

  useEffect(() => {
    player.muted = muted;
  }, [muted, player]);

  useEffect(() => {
    if (active && !manualPaused) {
      player.play();
    } else {
      player.pause();
    }
  }, [active, manualPaused, player]);

  useEffect(() => {
    if (!active) {
      setManualPaused(false);
    }
  }, [active]);

  const statusEvent = useEvent(player, 'statusChange', { status: player.status });

  const playerStatus = statusEvent?.status ?? player.status;

  useEffect(() => {
    if (playerStatus === 'readyToPlay') {
      setIsLoading(false);
    }
    if (playerStatus === 'loading') {
      setIsLoading(true);
    }
    if (playerStatus === 'error') {
      setIsLoading(false);
    }
  }, [playerStatus]);

  const handleTap = useCallback(() => {
    const now = Date.now();
    const timeSinceLastTap = now - lastTapRef.current;
    lastTapRef.current = now;

    if (timeSinceLastTap < 300) {
      if (doubleTapTimerRef.current) {
        clearTimeout(doubleTapTimerRef.current);
        doubleTapTimerRef.current = null;
      }
      onDoubleTap?.();
      return;
    }

    doubleTapTimerRef.current = setTimeout(() => {
      doubleTapTimerRef.current = null;
      setManualPaused((prev) => !prev);
      triggerHaptic('light');
    }, 300);
  }, [onDoubleTap]);

  useEffect(() => {
    return () => {
      if (doubleTapTimerRef.current) {
        clearTimeout(doubleTapTimerRef.current);
      }
    };
  }, []);

  if (!streamUrl) {
    return (
      <View style={[styles.container, style]}>
        {poster ? (
          <Image source={{ uri: poster }} style={styles.fill} contentFit="cover" />
        ) : (
          <View style={styles.placeholder}>
            <Ionicons name="film-outline" size={32} color={colors.text.light} />
          </View>
        )}
      </View>
    );
  }

  return (
    <View style={[styles.container, style]}>
      <Pressable style={styles.fill} onPress={handleTap}>
        <VideoView
          ref={videoViewRef}
          player={player}
          style={styles.video}
          contentFit="fill"
          nativeControls={false}
          allowsPictureInPicture={false}
          onFirstFrameRender={() => setIsLoading(false)}
        />

        {poster && isLoading ? (
          <Image
            source={{ uri: poster }}
            style={styles.posterOverlay}
            contentFit="cover"
          />
        ) : null}
      </Pressable>

      {manualPaused && !isLoading ? (
        <Animated.View
          entering={FadeIn.duration(150)}
          exiting={FadeOut.duration(150)}
          style={styles.pauseIndicator}
          pointerEvents="none"
        >
          <View style={styles.pauseCircle}>
            <Ionicons name="play" size={32} color="#fff" />
          </View>
        </Animated.View>
      ) : null}

      {isLoading ? (
        <View style={styles.loadingIndicator} pointerEvents="none">
          <View style={styles.loadingCard}>
            <VideoPlayerWaitingBars />
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
    overflow: 'hidden',
  },
  fill: {
    flex: 1,
  },
  video: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  posterOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.panel,
  },
  pauseIndicator: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pauseCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(8, 14, 20, 0.68)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingIndicator: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(10, 14, 20, 0.24)',
  },
  loadingCard: {
    minWidth: 94,
    minHeight: 58,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: 'rgba(8, 12, 16, 0.64)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
});

export default FeedPlayer;
