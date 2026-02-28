import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  LayoutChangeEvent,
  Pressable,
  ScrollView,
  StyleProp,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import {
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
} from 'expo-audio';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@/components/ui/SymbolIcon';
import { triggerActionHaptic } from '@/lib/haptics';
import { formatPlaybackTime, getMuxStreamUrl } from './muxPlayback';
import { styles } from './AudioPlayer.styles';

export interface AudioTranscriptWord {
  word: string;
  startMs: number;
  endMs: number;
  confidence?: number;
}

export interface AudioPlayerProps {
  muxPlaybackId: string;
  duration?: number;
  title?: string;
  autoPlay?: boolean;
  showWaveform?: boolean;
  defaultExpanded?: boolean;
  style?: StyleProp<ViewStyle>;
  transcriptWords?: AudioTranscriptWord[];
  scriptText?: string;
}

type TranscriptWordView = AudioTranscriptWord & { index: number; isDiverged: boolean };

const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5, 2] as const;
const TRANSCRIPT_HIGHLIGHT_LEAD_MS = 190;

function normalizeToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9'-]/g, '');
}

function tokenizeScript(scriptText: string): string[] {
  return scriptText
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function annotateTranscript(
  words: AudioTranscriptWord[],
  scriptText?: string,
  fallbackDurationMs?: number
): TranscriptWordView[] {
  const rawPrepared = words
    .filter((word) => Number.isFinite(word.startMs) && Number.isFinite(word.endMs) && word.endMs > word.startMs)
    .map((word, index) => ({ ...word, index, isDiverged: false }));

  const prepared = (() => {
    if (!fallbackDurationMs || rawPrepared.length === 0) return rawPrepared;
    const lastEndMs = rawPrepared.at(-1)?.endMs || 0;
    if (lastEndMs <= 0) return rawPrepared;

    const ratio = fallbackDurationMs / lastEndMs;
    if (ratio > 0.92 && ratio < 1.08) return rawPrepared;

    return rawPrepared.map((word) => ({
      ...word,
      startMs: Math.max(0, Math.round(word.startMs * ratio)),
      endMs: Math.max(1, Math.round(word.endMs * ratio)),
    }));
  })();

  if (!scriptText?.trim()) return prepared;

  const scriptTokens = tokenizeScript(scriptText);
  if (scriptTokens.length === 0) return prepared;

  if (prepared.length === 0) {
    const durationMs = Math.max(fallbackDurationMs || 0, scriptTokens.length * 480);
    const step = durationMs / Math.max(scriptTokens.length, 1);
    return scriptTokens.map((word, index) => ({
      word,
      startMs: Math.round(index * step),
      endMs: Math.round((index + 1) * step),
      index,
      isDiverged: false,
    }));
  }

  let pointer = 0;
  const annotated = prepared.map((word) => {
    const token = normalizeToken(word.word);
    if (!token) return word;

    let matchIndex = -1;
    for (let i = 0; i <= 4; i += 1) {
      const idx = pointer + i;
      if (idx >= scriptTokens.length) break;
      if (normalizeToken(scriptTokens[idx]) === token) {
        matchIndex = idx;
        break;
      }
    }

    if (matchIndex >= 0) {
      const isDiverged = matchIndex !== pointer;
      pointer = matchIndex + 1;
      return { ...word, isDiverged };
    }

    return { ...word, isDiverged: true };
  });

  const divergedRatio = annotated.filter((word) => word.isDiverged).length / annotated.length;
  if (divergedRatio <= 0.35) {
    return annotated;
  }

  // If ASR diverges too much from the script, preserve script wording while reusing timeline pacing.
  const lastWordEndMs = prepared.at(-1)?.endMs || 0;
  const totalDurationMs = Math.max(fallbackDurationMs || 0, lastWordEndMs, scriptTokens.length * 400);
  return scriptTokens.map((word, index) => {
    const ratio = scriptTokens.length > 1 ? index / (scriptTokens.length - 1) : 0;
    const approxWordIndex = Math.round(ratio * (prepared.length - 1));
    const timingSource = prepared[Math.max(0, Math.min(prepared.length - 1, approxWordIndex))];

    const startMs = timingSource?.startMs ?? Math.round((index / scriptTokens.length) * totalDurationMs);
    const defaultEndMs = Math.round(((index + 1) / scriptTokens.length) * totalDurationMs);
    const endMs =
      timingSource?.endMs && timingSource.endMs > startMs
        ? timingSource.endMs
        : Math.max(startMs + 120, defaultEndMs);

    return {
      word,
      startMs,
      endMs,
      index,
      isDiverged: false,
    };
  });
}

function WaveformPulse({ active }: { active: boolean }) {
  const pulse = useSharedValue(0);

  useEffect(() => {
    if (active) {
      pulse.value = withRepeat(
        withTiming(1, { duration: 900, easing: Easing.inOut(Easing.cubic) }),
        -1,
        true
      );
      return;
    }
    pulse.value = withTiming(0, { duration: 180 });
  }, [active, pulse]);

  const waveA = useAnimatedStyle(() => ({
    opacity: 0.2 + pulse.value * 0.7,
    transform: [{ scaleY: 0.7 + pulse.value * 0.3 }],
  }));
  const waveB = useAnimatedStyle(() => ({
    opacity: 0.25 + (1 - pulse.value) * 0.65,
    transform: [{ scaleY: 0.72 + (1 - pulse.value) * 0.28 }],
  }));
  const waveC = useAnimatedStyle(() => ({
    opacity: 0.3 + pulse.value * 0.55,
    transform: [{ scaleY: 0.68 + pulse.value * 0.32 }],
  }));

  return (
    <View style={styles.waveRow}>
      <Animated.View style={[styles.waveBar, waveA]} />
      <Animated.View style={[styles.waveBar, waveB]} />
      <Animated.View style={[styles.waveBar, waveC]} />
    </View>
  );
}

export function AudioPlayer({
  muxPlaybackId,
  duration: initialDuration = 0,
  title = 'Voiceover',
  autoPlay = false,
  showWaveform = true,
  defaultExpanded = false,
  style,
  transcriptWords = [],
  scriptText,
}: AudioPlayerProps) {
  const streamUrl = useMemo(() => getMuxStreamUrl(muxPlaybackId), [muxPlaybackId]);
  const player = useAudioPlayer({ uri: streamUrl }, { updateInterval: 90, keepAudioSessionActive: true });
  const status = useAudioPlayerStatus(player);

  const [expanded, setExpanded] = useState(defaultExpanded);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [progressWidth, setProgressWidth] = useState(1);

  useEffect(() => {
    void setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: false,
    });
  }, []);

  useEffect(() => {
    if (autoPlay && status.isLoaded && !status.playing) {
      player.play();
    }
  }, [autoPlay, player, status.isLoaded, status.playing]);

  const duration = status.duration || initialDuration || 0;
  const currentTime = status.currentTime || 0;
  const hasError = status.playbackState === 'error';
  const isLoading = !status.isLoaded;
  const progressPercent = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;
  const durationMs = Math.round(duration * 1000);

  const transcript = useMemo(
    () => annotateTranscript(transcriptWords, scriptText, durationMs),
    [durationMs, scriptText, transcriptWords]
  );

  const activeWordIndex = useMemo(() => {
    if (transcript.length === 0) return -1;
    const currentMs = Math.round(currentTime * 1000) + TRANSCRIPT_HIGHLIGHT_LEAD_MS;
    const exactIndex = transcript.findIndex((word) => currentMs >= word.startMs && currentMs < word.endMs);
    if (exactIndex >= 0) return exactIndex;

    if (currentMs < transcript[0].startMs) {
      return 0;
    }

    for (let i = 0; i < transcript.length; i += 1) {
      if (currentMs < transcript[i].startMs) {
        return Math.max(0, i - 1);
      }
    }
    return transcript.length - 1;
  }, [currentTime, transcript]);

  const seekTo = useCallback(
    async (seconds: number) => {
      if (duration <= 0) return;
      const safeSeconds = Math.max(0, Math.min(duration, seconds));
      await player.seekTo(safeSeconds);
    },
    [duration, player]
  );

  const togglePlayPause = useCallback(async () => {
    if (hasError) return;
    await triggerActionHaptic('selection');
    if (status.playing) {
      player.pause();
      return;
    }

    if (status.didJustFinish) {
      await player.seekTo(0);
    }
    player.play();
  }, [hasError, player, status.didJustFinish, status.playing]);

  const changeSpeed = useCallback(async (nextSpeed: number) => {
    await triggerActionHaptic('selection');
    setShowSpeedMenu(false);
    player.setPlaybackRate(nextSpeed, 'medium');
  }, [player]);

  const onProgressLayout = useCallback((event: LayoutChangeEvent) => {
    setProgressWidth(Math.max(event.nativeEvent.layout.width, 1));
  }, []);

  if (hasError) {
    return (
      <View style={[styles.container, style]}>
        <Text style={styles.errorTitle}>Audio unavailable</Text>
        <Text style={styles.errorBody}>Could not load this voiceover stream.</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, style]}>
      <View style={styles.topRow}>
        <Pressable style={styles.playButton} onPress={() => void togglePlayPause()} disabled={isLoading}>
          {isLoading ? (
            <ActivityIndicator size="small" color="#2AA1FF" />
          ) : (
            <Ionicons name={status.playing ? 'pause' : 'play'} size={18} color="#12313D" />
          )}
        </Pressable>

        <View style={styles.titleWrap}>
          <Text style={styles.titleText}>{title}</Text>
          <Text style={styles.metaText}>
            {formatPlaybackTime(currentTime)} / {formatPlaybackTime(duration)}
          </Text>
        </View>

        <Pressable
          style={styles.utilityButton}
          onPress={() => {
            setExpanded((value) => !value);
            void triggerActionHaptic('selection');
          }}
        >
          <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color="#8D9AA6" />
        </Pressable>
      </View>

      {showWaveform ? <WaveformPulse active={status.playing && !isLoading} /> : null}

      <View style={styles.progressContainer} onLayout={onProgressLayout}>
        <Pressable
          style={styles.progressTrack}
          onPress={(event) => {
            if (duration <= 0) return;
            const ratio = Math.max(0, Math.min(1, event.nativeEvent.locationX / progressWidth));
            void seekTo(duration * ratio);
            void triggerActionHaptic('selection');
          }}
        >
          <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
        </Pressable>
      </View>

      <View style={styles.controlsRow}>
        <Pressable style={styles.controlChip} onPress={() => void seekTo(currentTime - 5)}>
          <Ionicons name="play-back" size={14} color="#12313D" />
          <Text style={styles.controlLabel}>5s</Text>
        </Pressable>

        <Pressable
          style={styles.controlChip}
          onPress={() => {
            setShowSpeedMenu((value) => !value);
            void triggerActionHaptic('selection');
          }}
        >
          <Text style={styles.controlLabel}>{(status.playbackRate || 1).toFixed(2)}x</Text>
        </Pressable>

        <Pressable style={styles.controlChip} onPress={() => void seekTo(currentTime + 5)}>
          <Ionicons name="play-forward" size={14} color="#12313D" />
          <Text style={styles.controlLabel}>5s</Text>
        </Pressable>
      </View>

      {showSpeedMenu ? (
        <View style={styles.menuWrap}>
          {SPEED_OPTIONS.map((option) => (
            <Pressable
              key={option}
              style={[styles.menuChip, (status.playbackRate || 1) === option && styles.menuChipActive]}
              onPress={() => void changeSpeed(option)}
            >
              <Text
                style={[
                  styles.menuChipText,
                  (status.playbackRate || 1) === option && styles.menuChipTextActive,
                ]}
              >
                {option.toFixed(2)}x
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {expanded && transcript.length > 0 ? (
        <View style={styles.transcriptSection}>
          <Text style={styles.transcriptTitle}>Transcript (tap a word to seek)</Text>
          <ScrollView style={styles.transcriptScroll} contentContainerStyle={styles.transcriptContent}>
            <View style={styles.wordsWrap}>
              {transcript.map((word, index) => {
                const active = index === activeWordIndex;
                return (
                  <Pressable
                    key={`${word.startMs}-${word.endMs}-${index}`}
                    style={[
                      styles.wordChip,
                      word.isDiverged && styles.wordChipDiverged,
                      active && styles.wordChipActive,
                    ]}
                    onPress={() => {
                      void seekTo(word.startMs / 1000);
                      void triggerActionHaptic('selection');
                    }}
                  >
                    <Text
                      style={[
                        styles.wordText,
                        word.isDiverged && styles.wordTextDiverged,
                        active && styles.wordTextActive,
                      ]}
                    >
                      {word.word}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

export default AudioPlayer;
