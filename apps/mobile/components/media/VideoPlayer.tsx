/* eslint-disable max-lines */
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  LayoutChangeEvent,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useEvent, useEventListener } from 'expo';
import { Image } from 'expo-image';
import { VideoView, useVideoPlayer } from 'expo-video';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Ionicons } from '@/components/ui/SymbolIcon';
import { colors } from '@/lib/theme';
import { triggerActionHaptic } from '@/lib/haptics';
import {
  applyMuxQuality,
  formatPlaybackTime,
  getMuxGifUrl,
  getMuxStreamUrl,
  getMuxThumbnailUrl,
  PLAYBACK_SPEEDS,
  QUALITY_OPTIONS,
  type QualityValue,
} from './muxPlayback';
import { styles } from './VideoPlayer.styles';
import { VideoPlayerWaitingBars } from './VideoPlayerWaitingBars';
import type {
  VideoPlaybackStatusSnapshot,
  VideoPlayerProps,
  VideoPlayerRef,
} from './VideoPlayer.types';

export { getMuxStreamUrl, getMuxThumbnailUrl, getMuxGifUrl } from './muxPlayback';
export type { VideoPlayerProps, VideoPlayerRef } from './VideoPlayer.types';

export const VideoPlayer = forwardRef<VideoPlayerRef, VideoPlayerProps>(function VideoPlayer(
  {
    uri,
    muxPlaybackId,
    posterUri,
    duration: initialDuration = 0,
    autoPlay = false,
    loop = false,
    showControls = true,
    muted = false,
    aspectRatio = 9 / 16,
    contentFit = 'contain',
    enableQualitySelector = true,
    enablePlaybackSpeed = true,
    enableFullscreen = true,
    chapters = [],
    onEnd,
    onPlaybackStatusUpdate,
    onLoad,
    onError,
    style,
  },
  ref
) {
  const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const videoViewRef = useRef<VideoView>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [isMuted, setIsMuted] = useState(muted);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [duration, setDuration] = useState(initialDuration);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [quality, setQuality] = useState<QualityValue>('auto');
  const [controlsVisible, setControlsVisible] = useState(true);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const [hasEnded, setHasEnded] = useState(false);
  const [progressWidth, setProgressWidth] = useState(1);
  const [scrubTime, setScrubTime] = useState<number | null>(null);

  const controlsOpacity = useSharedValue(1);
  const controlsOpacityStyle = useAnimatedStyle(() => ({
    opacity: controlsOpacity.value,
  }));

  const playbackId = useMemo(
    () =>
      muxPlaybackId ||
      (uri &&
      !uri.startsWith('http://') &&
      !uri.startsWith('https://') &&
      !uri.startsWith('file://')
        ? uri
        : null),
    [muxPlaybackId, uri]
  );

  const baseStreamUrl = useMemo(() => {
    if (muxPlaybackId) return getMuxStreamUrl(muxPlaybackId);
    if (!uri) return '';
    if (uri.startsWith('http://') || uri.startsWith('https://') || uri.startsWith('file://')) return uri;
    return getMuxStreamUrl(uri);
  }, [muxPlaybackId, uri]);

  const streamUrl = useMemo(() => applyMuxQuality(baseStreamUrl, quality), [baseStreamUrl, quality]);
  const source = useMemo(() => ({ uri: streamUrl }), [streamUrl]);

  const resolvedPosterUri = useMemo(() => {
    if (posterUri) return posterUri;
    if (playbackId) return getMuxThumbnailUrl(playbackId, { width: 720, fit: 'smartcrop' });
    return undefined;
  }, [posterUri, playbackId]);

  const player = useVideoPlayer(source, (instance) => {
    instance.loop = loop;
    instance.muted = muted;
    instance.playbackRate = playbackRate;
    instance.timeUpdateEventInterval = 0.2;
    // Keep subtitle tracks disabled by default to avoid platform subtitle overlays.
    instance.subtitleTrack = null;
    if (autoPlay) {
      instance.play();
    }
  });

  useEffect(() => {
    player.loop = loop;
  }, [loop, player]);

  useEffect(() => {
    player.muted = isMuted;
  }, [isMuted, player]);

  useEffect(() => {
    player.playbackRate = playbackRate;
  }, [playbackRate, player]);

  useEffect(() => {
    if (player.availableSubtitleTracks.length > 0) {
      player.subtitleTrack = null;
    }
  }, [player, streamUrl]);

  const statusEvent = useEvent(player, 'statusChange', { status: player.status });
  const timeEvent = useEvent(player, 'timeUpdate', {
    currentTime: player.currentTime,
    currentLiveTimestamp: null,
    currentOffsetFromLive: null,
    bufferedPosition: player.bufferedPosition,
  });
  const playingEvent = useEvent(player, 'playingChange', { isPlaying: player.playing });
  const sourceLoadEvent = useEvent(player, 'sourceLoad', null);

  const playerStatus = statusEvent?.status ?? player.status;
  const currentTime = timeEvent?.currentTime ?? player.currentTime;
  const isPlaying = playingEvent?.isPlaying ?? player.playing;
  const isBuffering = playerStatus === 'loading';
  const hasError = playerStatus === 'error';

  useEffect(() => {
    if (playerStatus === 'loading') {
      setIsLoading(true);
    }
    if (playerStatus === 'readyToPlay') {
      setIsLoading(false);
      setErrorMessage('');
    }
    if (playerStatus === 'error') {
      setIsLoading(false);
      const message = statusEvent?.error?.message || 'Playback failed';
      setErrorMessage(message);
      onError?.(message);
    }
  }, [onError, playerStatus, statusEvent?.error?.message]);

  useEffect(() => {
    if (sourceLoadEvent?.duration) {
      setDuration(sourceLoadEvent.duration);
      onLoad?.(sourceLoadEvent.duration);
    }
  }, [onLoad, sourceLoadEvent?.duration]);

  useEventListener(player, 'playToEnd', () => {
    setHasEnded(true);
    setIsLoading(false);
    onEnd?.();
    showControlsOverlay(false);
  });

  useEffect(() => {
    if (isPlaying && hasEnded) {
      setHasEnded(false);
    }
  }, [hasEnded, isPlaying]);

  const effectiveTime = scrubTime ?? currentTime;
  const progressPercent = duration > 0 ? Math.min(100, Math.max(0, (effectiveTime / duration) * 100)) : 0;

  const clearHideControlsTimer = useCallback(() => {
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
      controlsTimeoutRef.current = null;
    }
  }, []);

  const showControlsOverlay = useCallback(
    (withAutoHide = true) => {
      clearHideControlsTimer();
      setControlsVisible(true);
      controlsOpacity.value = withTiming(1, { duration: 180 });

      if (withAutoHide && isPlaying && showControls) {
        controlsTimeoutRef.current = setTimeout(() => {
          controlsOpacity.value = withTiming(0, { duration: 200 });
          setControlsVisible(false);
        }, 2800);
      }
    },
    [clearHideControlsTimer, controlsOpacity, isPlaying, showControls]
  );

  useEffect(() => {
    showControlsOverlay();
    return clearHideControlsTimer;
  }, [showControlsOverlay, clearHideControlsTimer]);

  useEffect(() => {
    const snapshot: VideoPlaybackStatusSnapshot = {
      status: playerStatus,
      isPlaying,
      isBuffering,
      currentTime,
      duration,
      error: errorMessage || undefined,
    };
    onPlaybackStatusUpdate?.(snapshot);
  }, [
    currentTime,
    duration,
    errorMessage,
    isBuffering,
    isPlaying,
    onPlaybackStatusUpdate,
    playerStatus,
  ]);

  useImperativeHandle(
    ref,
    () => ({
      play: async () => {
        player.play();
      },
      pause: async () => {
        player.pause();
      },
      seekTo: async (position: number) => {
        player.currentTime = Math.max(0, position);
      },
      replay: async () => {
        player.replay();
      },
    }),
    [player]
  );

  const togglePlayPause = useCallback(async () => {
    await triggerActionHaptic('selection');
    if (isPlaying) {
      player.pause();
      return;
    }
    const isAtEnd = duration > 0 && currentTime >= Math.max(0, duration - 0.25);
    if (hasEnded || isAtEnd) {
      setHasEnded(false);
      setIsLoading(false);
      player.replay();
      showControlsOverlay();
      return;
    }
    player.play();
    showControlsOverlay();
  }, [currentTime, duration, hasEnded, isPlaying, player, showControlsOverlay]);

  const seekTo = useCallback(
    async (targetSeconds: number) => {
      if (duration <= 0) return;
      const safeSeconds = Math.max(0, Math.min(duration, targetSeconds));
      if (hasEnded && safeSeconds < duration) {
        setHasEnded(false);
      }
      player.currentTime = safeSeconds;
    },
    [duration, hasEnded, player]
  );

  const updateScrubTime = useCallback(
    (x: number) => {
      if (progressWidth <= 0 || duration <= 0) return;
      const ratio = Math.max(0, Math.min(1, x / progressWidth));
      setScrubTime(duration * ratio);
    },
    [duration, progressWidth]
  );

  const commitScrub = useCallback(async () => {
    if (scrubTime == null) return;
    await seekTo(scrubTime);
    setScrubTime(null);
    void triggerActionHaptic('selection');
  }, [scrubTime, seekTo]);

  const progressPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (event) => {
          updateScrubTime(event.nativeEvent.locationX);
        },
        onPanResponderMove: (event) => {
          updateScrubTime(event.nativeEvent.locationX);
        },
        onPanResponderRelease: () => {
          void commitScrub();
        },
        onPanResponderTerminate: () => {
          void commitScrub();
        },
      }),
    [commitScrub, updateScrubTime]
  );

  const skip = useCallback(
    async (seconds: number) => {
      await seekTo(currentTime + seconds);
    },
    [currentTime, seekTo]
  );

  const changePlaybackRate = useCallback(async (value: number) => {
    await triggerActionHaptic('selection');
    setPlaybackRate(value);
    setShowSpeedMenu(false);
  }, []);

  const changeQuality = useCallback(async (nextQuality: QualityValue) => {
    await triggerActionHaptic('selection');
    setQuality(nextQuality);
    setShowQualityMenu(false);
    setIsLoading(true);
  }, []);

  const toggleMute = useCallback(async () => {
    await triggerActionHaptic('selection');
    setIsMuted((current) => !current);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    await triggerActionHaptic('navigation');
    if (!videoViewRef.current) return;
    if (isFullscreen) {
      await videoViewRef.current.exitFullscreen();
      return;
    }
    await videoViewRef.current.enterFullscreen();
  }, [isFullscreen]);

  const onProgressLayout = useCallback((event: LayoutChangeEvent) => {
    setProgressWidth(Math.max(event.nativeEvent.layout.width, 1));
  }, []);

  if (!streamUrl) {
    return (
      <View style={[styles.container, { aspectRatio }, style]}>
        <View style={styles.centeredState}>
          <Ionicons name="videocam-off-outline" size={26} color={colors.text.light} />
          <Text style={styles.errorTitle}>No video source</Text>
          <Text style={styles.errorBody}>Playback URL is missing.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { aspectRatio }, style]}>
      <Pressable
        style={styles.videoLayer}
        onPress={() => {
          if (!showControls) return;
          if (controlsVisible) {
            clearHideControlsTimer();
            controlsOpacity.value = withTiming(0, { duration: 150 });
            setControlsVisible(false);
            return;
          }
          showControlsOverlay();
        }}
      >
        <VideoView
          ref={videoViewRef}
          player={player}
          style={styles.video}
          contentFit={contentFit}
          nativeControls={isFullscreen}
          fullscreenOptions={{
            enable: enableFullscreen,
            autoExitOnRotate: true,
          }}
          allowsPictureInPicture={false}
          onFullscreenEnter={() => setIsFullscreen(true)}
          onFullscreenExit={() => setIsFullscreen(false)}
          onFirstFrameRender={() => setIsLoading(false)}
        />

        {resolvedPosterUri && !isPlaying && currentTime === 0 ? (
          <Image source={resolvedPosterUri} style={styles.posterOverlay} contentFit="cover" />
        ) : null}

        {(isLoading || isBuffering) && !hasError && !hasEnded ? (
          <View style={styles.loadingOverlay}>
            <View style={styles.loadingCard}>
              <VideoPlayerWaitingBars />
              <Text style={styles.loadingLabel}>{isLoading ? 'Loading stream...' : 'Buffering playback...'}</Text>
              <ActivityIndicator size="small" color={colors.primary.DEFAULT} />
            </View>
          </View>
        ) : null}

        {hasError ? (
          <View style={styles.loadingOverlay}>
            <View style={styles.errorCard}>
              <Ionicons name="alert-circle-outline" size={22} color={colors.error} />
              <Text style={styles.errorTitle}>Playback failed</Text>
              <Text numberOfLines={3} style={styles.errorBody}>
                {errorMessage || 'Unable to play this video.'}
              </Text>
              <Pressable
                style={styles.retryButton}
                onPress={() => {
                  setErrorMessage('');
                  setIsLoading(true);
                  player.replay();
                }}
              >
                <Text style={styles.retryLabel}>Retry</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {showControls ? (
          <Animated.View pointerEvents={controlsVisible ? 'auto' : 'none'} style={[styles.controlsOverlay, controlsOpacityStyle]}>
            <View style={styles.centerControls}>
              {isPlaying ? (
                <Pressable style={styles.seekButton} onPress={() => void skip(-10)}>
                  <Ionicons name="play-back" size={18} color={colors.text.inverse} />
                </Pressable>
              ) : null}
              <Pressable
                style={[styles.playButton, !isPlaying && styles.playButtonPaused]}
                onPress={() => void togglePlayPause()}
              >
                <Ionicons name={isPlaying ? 'pause' : 'play'} size={24} color={colors.text.inverse} />
              </Pressable>
              {isPlaying ? (
                <Pressable style={styles.seekButton} onPress={() => void skip(10)}>
                  <Ionicons name="play-forward" size={18} color={colors.text.inverse} />
                </Pressable>
              ) : null}
            </View>

            <View style={styles.bottomControls}>
              <Text style={styles.timeLabel}>{formatPlaybackTime(effectiveTime)}</Text>
              <View
                style={styles.progressTrack}
                onLayout={onProgressLayout}
                {...progressPanResponder.panHandlers}
              >
                <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
                <View
                  style={[
                    styles.progressThumb,
                    { left: `${progressPercent}%` },
                  ]}
                />
                {chapters.map((chapter) => {
                  const marker = duration > 0 ? Math.max(0, Math.min(100, (chapter.time / duration) * 100)) : 0;
                  return (
                    <View
                      key={`${chapter.time}-${chapter.title}`}
                      style={[styles.chapterMarker, { left: `${marker}%` }]}
                    />
                  );
                })}
              </View>
              <Text style={styles.timeLabel}>{formatPlaybackTime(duration)}</Text>
            </View>

            <View style={styles.utilityRow}>
              <Pressable style={styles.utilityButton} onPress={() => void toggleMute()}>
                <Ionicons
                  name={isMuted ? 'volume-mute-outline' : 'volume-high-outline'}
                  size={16}
                  color={colors.text.inverse}
                />
              </Pressable>

              {enablePlaybackSpeed ? (
                <Pressable
                  style={styles.utilityButton}
                  onPress={() => {
                    setShowSpeedMenu((value) => !value);
                    setShowQualityMenu(false);
                    void triggerActionHaptic('selection');
                  }}
                >
                  <Text style={styles.utilityLabel}>{playbackRate.toFixed(2)}x</Text>
                </Pressable>
              ) : null}

              {enableQualitySelector ? (
                <Pressable
                  style={styles.utilityButton}
                  onPress={() => {
                    setShowQualityMenu((value) => !value);
                    setShowSpeedMenu(false);
                    void triggerActionHaptic('selection');
                  }}
                >
                  <Text style={styles.utilityLabel}>{quality === 'auto' ? 'Auto' : quality}</Text>
                </Pressable>
              ) : null}

              {enableFullscreen ? (
                <Pressable style={styles.utilityButton} onPress={() => void toggleFullscreen()}>
                  <Ionicons
                    name={isFullscreen ? 'contract-outline' : 'expand-outline'}
                    size={16}
                    color={colors.text.inverse}
                  />
                </Pressable>
              ) : null}
            </View>

            {showSpeedMenu ? (
              <View style={styles.menuWrap}>
                {PLAYBACK_SPEEDS.map((speed) => (
                  <Pressable
                    key={speed}
                    style={[styles.menuChip, playbackRate === speed && styles.menuChipActive]}
                    onPress={() => void changePlaybackRate(speed)}
                  >
                    <Text style={[styles.menuChipLabel, playbackRate === speed && styles.menuChipLabelActive]}>
                      {speed.toFixed(2)}x
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}

            {showQualityMenu ? (
              <View style={styles.menuWrap}>
                {QUALITY_OPTIONS.map((option) => (
                  <Pressable
                    key={option}
                    style={[styles.menuChip, quality === option && styles.menuChipActive]}
                    onPress={() => void changeQuality(option)}
                  >
                    <Text style={[styles.menuChipLabel, quality === option && styles.menuChipLabelActive]}>
                      {option === 'auto' ? 'Auto' : option}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </Animated.View>
        ) : null}
      </Pressable>
    </View>
  );
});

export default VideoPlayer;
