/**
 * Mux Player Component for React Native
 *
 * A modern video player component using Mux Player via WebView.
 * Provides native-like experience with Mux's advanced streaming features:
 * - Adaptive bitrate streaming
 * - Thumbnail previews on scrub
 * - Advanced analytics via Mux Data
 * - Automatic quality selection
 *
 * @see https://www.mux.com/player
 */

import React, { useRef, useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Pressable,
  Dimensions,
} from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import Animated, {
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { colors, typography, spacing, borderRadius, shadows } from '@/lib/theme';
import { triggerHaptic } from '@/lib/haptics';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ==================== TYPES ====================

export interface MuxPlayerProps {
  /** Mux playback ID (required) */
  playbackId: string;
  /** Poster/thumbnail image (optional - auto-generated from playback ID if not provided) */
  posterUrl?: string;
  /** Title for the video (for Mux Data) */
  title?: string;
  /** Auto-play on mount */
  autoPlay?: boolean;
  /** Loop video playback */
  loop?: boolean;
  /** Muted playback */
  muted?: boolean;
  /** Show controls */
  showControls?: boolean;
  /** Aspect ratio (default: 9:16 for vertical) */
  aspectRatio?: number;
  /** Accent color for player controls */
  accentColor?: string;
  /** Callback when video ends */
  onEnded?: () => void;
  /** Callback when playback starts */
  onPlay?: () => void;
  /** Callback when playback pauses */
  onPause?: () => void;
  /** Callback on error */
  onError?: (error: string) => void;
  /** Callback on time update */
  onTimeUpdate?: (currentTime: number, duration: number) => void;
  /** Custom style */
  style?: object;
}

interface PlayerMessage {
  type: 'play' | 'pause' | 'ended' | 'timeupdate' | 'error' | 'ready' | 'loaded';
  data?: {
    currentTime?: number;
    duration?: number;
    error?: string;
  };
}

// ==================== COMPONENT ====================

export function MuxPlayer({
  playbackId,
  posterUrl,
  title = 'Video',
  autoPlay = false,
  loop = false,
  muted = false,
  showControls = true,
  aspectRatio = 9 / 16,
  accentColor = colors.primary.DEFAULT,
  onEnded,
  onPlay,
  onPause,
  onError,
  onTimeUpdate,
  style,
}: MuxPlayerProps) {
  const webViewRef = useRef<WebView>(null);
  
  const [isLoading, setIsLoading] = useState(true);
  const [isReady, setIsReady] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);

  // Generate poster URL if not provided
  const resolvedPoster = posterUrl || `https://image.mux.com/${playbackId}/thumbnail.jpg?width=640&fit=smartcrop`;

  // Handle messages from WebView
  const handleMessage = useCallback((event: WebViewMessageEvent) => {
    try {
      const message: PlayerMessage = JSON.parse(event.nativeEvent.data);
      
      switch (message.type) {
        case 'ready':
          setIsReady(true);
          setIsLoading(false);
          break;
        case 'loaded':
          setIsLoading(false);
          break;
        case 'play':
          setIsPlaying(true);
          triggerHaptic('light');
          onPlay?.();
          break;
        case 'pause':
          setIsPlaying(false);
          onPause?.();
          break;
        case 'ended':
          setIsPlaying(false);
          triggerHaptic('medium');
          onEnded?.();
          break;
        case 'timeupdate':
          if (message.data?.currentTime !== undefined && message.data?.duration !== undefined) {
            onTimeUpdate?.(message.data.currentTime, message.data.duration);
          }
          break;
        case 'error':
          setHasError(true);
          setIsLoading(false);
          setErrorMessage(message.data?.error || 'Unknown error');
          onError?.(message.data?.error || 'Unknown error');
          break;
      }
    } catch (error) {
      console.error('[MuxPlayer] Failed to parse message:', error);
    }
  }, [onPlay, onPause, onEnded, onTimeUpdate, onError]);

  // Generate the HTML for the Mux Player
  const playerHtml = generatePlayerHtml({
    playbackId,
    posterUrl: resolvedPoster,
    title,
    autoPlay,
    loop,
    muted,
    showControls,
    accentColor,
  });

  // Control methods
  const play = useCallback(() => {
    webViewRef.current?.injectJavaScript('window.muxPlayer?.play(); true;');
  }, []);

  const pause = useCallback(() => {
    webViewRef.current?.injectJavaScript('window.muxPlayer?.pause(); true;');
  }, []);

  const seek = useCallback((time: number) => {
    webViewRef.current?.injectJavaScript(`window.muxPlayer.currentTime = ${time}; true;`);
  }, []);

  const togglePlayPause = useCallback(() => {
    if (isPlaying) {
      pause();
    } else {
      play();
    }
  }, [isPlaying, play, pause]);

  // Error state
  if (hasError) {
    return (
      <View style={[styles.container, styles.errorContainer, { aspectRatio }, style]}>
        <Text style={styles.errorEmoji}>😕</Text>
        <Text style={styles.errorText}>Failed to load video</Text>
        <Text style={styles.errorMessage}>{errorMessage}</Text>
        <Pressable style={styles.retryButton} onPress={() => {
          setHasError(false);
          setIsLoading(true);
        }}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.container, { aspectRatio }, style]}>
      <WebView
        ref={webViewRef}
        source={{ html: playerHtml }}
        style={styles.webView}
        onMessage={handleMessage}
        onError={(syntheticEvent) => {
          const { nativeEvent } = syntheticEvent;
          setHasError(true);
          setErrorMessage(nativeEvent.description || 'WebView error');
        }}
        javaScriptEnabled
        mediaPlaybackRequiresUserAction={!autoPlay}
        allowsInlineMediaPlayback
        scrollEnabled={false}
        bounces={false}
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        originWhitelist={['*']}
      />

      {/* Loading overlay */}
      {isLoading && (
        <Animated.View
          entering={FadeIn.duration(200)}
          exiting={FadeOut.duration(200)}
          style={styles.loadingOverlay}
        >
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color={colors.primary.DEFAULT} />
            <Text style={styles.loadingText}>Loading...</Text>
          </View>
        </Animated.View>
      )}
    </View>
  );
}

// ==================== HTML GENERATION ====================

interface HtmlOptions {
  playbackId: string;
  posterUrl: string;
  title: string;
  autoPlay: boolean;
  loop: boolean;
  muted: boolean;
  showControls: boolean;
  accentColor: string;
}

function generatePlayerHtml(options: HtmlOptions): string {
  const {
    playbackId,
    posterUrl,
    title,
    autoPlay,
    loop,
    muted,
    showControls,
    accentColor,
  } = options;

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { 
      width: 100%; 
      height: 100%; 
      overflow: hidden;
      background: #000;
    }
    mux-player {
      width: 100%;
      height: 100%;
      --controls: ${showControls ? 'on' : 'off'};
      --primary-color: ${accentColor};
      --secondary-color: rgba(255, 255, 255, 0.9);
      --media-font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    mux-player::part(time-range) {
      --media-range-track-border-radius: 8px;
      --media-range-thumb-border-radius: 50%;
    }
    mux-player::part(poster-layer) {
      background-size: cover;
      background-position: center;
    }
  </style>
  <script src="https://cdn.jsdelivr.net/npm/@mux/mux-player@3"></script>
</head>
<body>
  <mux-player
    playback-id="${playbackId}"
    poster="${posterUrl}"
    stream-type="on-demand"
    metadata-video-title="${title}"
    ${autoPlay ? 'autoplay' : ''}
    ${loop ? 'loop' : ''}
    ${muted ? 'muted' : ''}
    preload="auto"
    default-hidden-captions
    disable-cookies
  ></mux-player>
  
  <script>
    const player = document.querySelector('mux-player');
    window.muxPlayer = player;
    
    function sendMessage(type, data = {}) {
      window.ReactNativeWebView?.postMessage(JSON.stringify({ type, data }));
    }
    
    player.addEventListener('loadedmetadata', () => {
      sendMessage('ready');
    });
    
    player.addEventListener('canplay', () => {
      sendMessage('loaded');
    });
    
    player.addEventListener('play', () => {
      sendMessage('play');
    });
    
    player.addEventListener('pause', () => {
      sendMessage('pause');
    });
    
    player.addEventListener('ended', () => {
      sendMessage('ended');
    });
    
    player.addEventListener('timeupdate', () => {
      sendMessage('timeupdate', {
        currentTime: player.currentTime,
        duration: player.duration
      });
    });
    
    player.addEventListener('error', (e) => {
      sendMessage('error', { error: e.message || 'Playback error' });
    });
  </script>
</body>
</html>
`;
}

// ==================== STYLES ====================

const styles = StyleSheet.create({
  container: {
    width: '100%',
    backgroundColor: '#000',
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    ...shadows.md,
  },
  webView: {
    flex: 1,
    backgroundColor: '#000',
  },
  // Loading overlay
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingBox: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    borderWidth: 2,
    borderColor: colors.border,
    padding: spacing.xl,
    alignItems: 'center',
    ...shadows.md,
  },
  loadingText: {
    marginTop: spacing.md,
    fontSize: typography.fontSize.sm,
    fontWeight: '600',
    color: colors.text.DEFAULT,
  },
  // Error state
  errorContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.pastel.pink,
    borderWidth: 2,
    borderColor: colors.border,
  },
  errorEmoji: {
    fontSize: 48,
    marginBottom: spacing.md,
  },
  errorText: {
    fontSize: typography.fontSize.lg,
    fontWeight: '700',
    color: colors.text.DEFAULT,
  },
  errorMessage: {
    fontSize: typography.fontSize.sm,
    color: colors.text.muted,
    marginTop: spacing.sm,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },
  retryButton: {
    marginTop: spacing.lg,
    backgroundColor: colors.primary.DEFAULT,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 2,
    borderColor: colors.border,
  },
  retryButtonText: {
    fontSize: typography.fontSize.sm,
    fontWeight: '700',
    color: colors.surface,
  },
});

export default MuxPlayer;
