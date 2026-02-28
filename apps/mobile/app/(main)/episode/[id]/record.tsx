/* eslint-disable max-lines */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { useLocalSearchParams } from 'expo-router';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@/components/ui/SymbolIcon';
import { Button, Card, Progress, Screen, StickyActionBar, TextArea } from '@/components/ui';
import { useToast } from '@/components/ui/Toast';
import { useAudioFilePicker } from '@/hooks/useAudioFilePicker';
import { useElevenLabsVoiceover } from '@/hooks/useElevenLabsVoiceover';
import { useEpisode } from '@/hooks/useEpisodes';
import { useNavigation } from '@/hooks/useNavigation';
import { useVoiceoverUpload } from '@/hooks/useVoiceoverUpload';
import { STATUS_LABELS } from '@/lib/pipeline';
import { borderRadius, colors, spacing, typography } from '@/lib/theme';
import { confirmAction } from '@/lib/confirm';

type RecorderState = 'idle' | 'recording' | 'review';

const ALLOWED_CAPTURE_STATUSES = [
  'draft',
  'voiceover_uploaded',
  'voiceover_cleaning',
  'voiceover_cleaned',
  'collecting_clips',
  'needs_more_clips',
  'chunking_clips',
  'enriching_chunks',
  'matching',
  'cut_plan_ready',
  'rendering',
  'ready',
  'failed',
];

function formatDuration(seconds: number) {
  const mins = Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0');
  const secs = Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0');
  return `${mins}:${secs}`;
}

function VoiceWaveBar({ index, active }: { index: number; active: boolean }) {
  const phase = useSharedValue(0);

  useEffect(() => {
    if (active) {
      phase.value = withRepeat(
        withTiming(1, { duration: 850, easing: Easing.inOut(Easing.ease) }),
        -1,
        true
      );
    } else {
      phase.value = withTiming(0, { duration: 180 });
    }
  }, [active, phase]);

  const animatedStyle = useAnimatedStyle(() => {
    const oscillation = Math.abs(Math.sin((phase.value * Math.PI * 2) + index * 0.48));
    const scaleY = active ? 0.22 + oscillation * 1.25 : 0.35 + ((index % 3) * 0.08);
    const opacity = active ? 0.38 + oscillation * 0.62 : 0.22;

    return {
      transform: [{ scaleY }],
      opacity,
    };
  });

  return <Animated.View style={[styles.waveBar, animatedStyle]} />;
}

function VoiceWaveform({ active }: { active: boolean }) {
  return (
    <View style={styles.waveRow}>
      {Array.from({ length: 30 }).map((_, index) => (
        <VoiceWaveBar key={`wave-${index}`} index={index} active={active} />
      ))}
    </View>
  );
}

export default function EpisodeRecordScreen() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const { data: episode, refetch } = useEpisode(id);
  const navigation = useNavigation(id);
  const { showToast } = useToast();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderStatus = useAudioRecorderState(recorder, 200);

  const [recorderState, setRecorderState] = useState<RecorderState>('idle');
  const [recordingUri, setRecordingUri] = useState<string | null>(null);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [isPreparing, setIsPreparing] = useState(false);
  const recordingStartedAtRef = useRef<number | null>(null);

  const {
    uploadVoiceover,
    uploadProgress,
    isUploading,
  } = useVoiceoverUpload(id);

  const audioPicker = useAudioFilePicker(id);
  const elevenLabs = useElevenLabsVoiceover(id);

  const status = episode?.status ?? 'draft';
  const statusLabel = STATUS_LABELS[status as keyof typeof STATUS_LABELS] ?? status;
  const canCapture = ALLOWED_CAPTURE_STATUSES.includes(status);

  const captureDisabledReason = useMemo(() => {
    if (canCapture) return null;
    return 'Voiceover edits are locked while processing or rendering is active.';
  }, [canCapture]);

  const isBusy =
    isPreparing ||
    recorderState === 'recording' ||
    isUploading ||
    audioPicker.isPicking ||
    audioPicker.isUploading ||
    elevenLabs.isGenerating;
  const hasSavedTake = recorderState === 'review' && Boolean(recordingUri);

  useEffect(() => {
    let mounted = true;

    async function requestPermissionOnMount() {
      const permission = await requestRecordingPermissionsAsync();
      if (mounted && permission.status !== 'granted') {
        showToast({
          type: 'warning',
          title: 'Microphone access required',
          message: 'Enable microphone permissions to record in-app voiceover.',
        });
      }
    }

    void requestPermissionOnMount();

    return () => {
      mounted = false;
      if (recorderStatus.isRecording) {
        void recorder.stop().catch(() => undefined);
      }
    };
  }, [showToast, recorder, recorderStatus.isRecording]);

  useEffect(() => {
    if (recorderState === 'recording') {
      setDurationSeconds(Math.floor(recorderStatus.durationMillis / 1000));
    }
  }, [recorderState, recorderStatus.durationMillis]);

  const startRecording = async () => {
    if (!canCapture || hasSavedTake || recorderState === 'recording' || recorderStatus.isRecording) return;

    try {
      setIsPreparing(true);
      setRecordingUri(null);
      setDurationSeconds(0);

      const permission = await requestRecordingPermissionsAsync();
      if (permission.status !== 'granted') {
        showToast({
          type: 'warning',
          title: 'Microphone access required',
          message: 'Enable microphone permissions to record in-app voiceover.',
        });
        return;
      }

      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
        shouldPlayInBackground: false,
        interruptionMode: 'duckOthers',
      });

      await recorder.prepareToRecordAsync(RecordingPresets.HIGH_QUALITY);
      recorder.record();
      recordingStartedAtRef.current = Date.now();
      setRecorderState('recording');
    } catch (error) {
      showToast({
        type: 'error',
        title: 'Recording failed',
        message: error instanceof Error ? error.message : 'Unable to start recording.',
      });
      setRecorderState('idle');
    } finally {
      setIsPreparing(false);
    }
  };

  const stopRecording = async () => {
    if (recorderState !== 'recording') return;

    try {
      await recorder.stop();
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
        shouldPlayInBackground: false,
      });
      const snapshot = recorder.getStatus();
      const uri = snapshot.url || recorder.uri;
      const elapsedMs = recordingStartedAtRef.current
        ? Math.max(Date.now() - recordingStartedAtRef.current, 0)
        : 0;
      const finalDurationMs = Math.max(
        snapshot.durationMillis || 0,
        recorderStatus.durationMillis || 0,
        durationSeconds * 1000,
        elapsedMs
      );
      const safeDurationSeconds = Math.max(1, Math.floor(finalDurationMs / 1000));

      setRecordingUri(uri ?? null);
      setRecorderState(uri ? 'review' : 'idle');
      setDurationSeconds(uri ? safeDurationSeconds : 0);
      recordingStartedAtRef.current = null;
    } catch (error) {
      showToast({
        type: 'error',
        title: 'Stop failed',
        message: error instanceof Error ? error.message : 'Unable to stop recording.',
      });
      setRecorderState('idle');
      recordingStartedAtRef.current = null;
    }
  };

  const resetRecording = () => {
    if (recorderStatus.isRecording) {
      void recorder.stop().catch(() => undefined);
    }
    setRecordingUri(null);
    setDurationSeconds(0);
    setRecorderState('idle');
    recordingStartedAtRef.current = null;
  };

  const handleUploadRecording = async () => {
    if (!recordingUri) return;
    const result = await uploadVoiceover([recordingUri]);

    if (result.success) {
      showToast({
        type: 'success',
        title: 'Voiceover uploaded',
        message: 'Processing started. Continue to clip collection.',
      });
      await refetch();
      await navigation.navigateToEpisode({ replace: true });
      return;
    }

    showToast({
      type: 'error',
      title: 'Upload failed',
      message: result.error || 'Could not upload the recording.',
    });
  };

  const handleImportAudio = async () => {
    if (!canCapture || hasSavedTake) return;

    const result = await audioPicker.pickAndUploadAudioFile();
    if (result.success) {
      showToast({
        type: 'success',
        title: 'Audio imported',
        message: 'Voiceover is now in the pipeline.',
      });
      await refetch();
      await navigation.navigateToEpisode({ replace: true });
      return;
    }

    if (result.error && result.error !== 'No file selected') {
      showToast({
        type: 'error',
        title: 'Import failed',
        message: result.error,
      });
    }
  };

  const handleGenerateVoiceover = async () => {
    if (!canCapture || hasSavedTake) return;
    const confirmed = await confirmAction(
      'Generate with ElevenLabs?',
      'This call can incur ElevenLabs usage cost.',
      'Generate'
    );
    if (!confirmed) return;

    const result = await elevenLabs.generateVoiceover();
    if (result.success) {
      showToast({
        type: 'success',
        title: 'Voice generated',
        message: 'ElevenLabs output is queued for cleanup.',
      });
      await refetch();
      await navigation.navigateToEpisode({ replace: true });
      return;
    }

    showToast({
      type: 'error',
      title: 'Generation failed',
      message: result.error || 'Could not generate voiceover.',
    });
  };

  const scriptPreview = episode?.scriptContent?.trim() || 'No script yet. Generate or paste script from episode details first.';
  const scriptWordCount = useMemo(
    () => scriptPreview.split(/\s+/).filter(Boolean).length,
    [scriptPreview]
  );
  const scriptReadMinutes = Math.max(1, Math.ceil(scriptWordCount / 140));

  return (
    <View style={styles.root}>
      <Screen contentContainerStyle={styles.content} topInset={false}>
        <View style={styles.header}>
          <Text style={styles.title}>Voiceover Studio</Text>
          <Text style={styles.subtitle}>Record directly, import existing audio, or generate with ElevenLabs.</Text>
          <Text style={styles.statusBadge}>{statusLabel}</Text>
        </View>

        {!canCapture ? (
          <Card variant="pastelOrange">
            <Text style={styles.warningTitle}>Capture is currently locked</Text>
            <Text style={styles.warningText}>{captureDisabledReason}</Text>
          </Card>
        ) : null}

        <Card>
          <View style={styles.recordHeaderRow}>
            <Text style={styles.sectionTitle}>In-app Recorder</Text>
            <Text style={styles.mono}>{formatDuration(durationSeconds)}</Text>
          </View>

          <View style={styles.recorderDockWrap}>
            <VoiceWaveform active={recorderState === 'recording'} />

            <View style={styles.recorderDock}>
              <Pressable
                style={[
                  styles.dockSideButton,
                  recordingUri && styles.dockSideButtonResetReady,
                  !recordingUri && styles.dockSideButtonDisabled,
                ]}
                onPress={resetRecording}
                disabled={!recordingUri || isBusy}
              >
                <Ionicons
                  name="arrow-undo-outline"
                  size={18}
                  color={recordingUri ? colors.error : colors.text.light}
                />
              </Pressable>

              <Pressable
                style={[
                  styles.recordMainButton,
                  recorderState === 'recording' && styles.recordMainButtonActive,
                  (!canCapture || isPreparing || hasSavedTake) &&
                    styles.recordMainButtonDisabled,
                ]}
                onPress={() => {
                  if (recorderState === 'recording') {
                    void stopRecording();
                    return;
                  }
                  void startRecording();
                }}
                disabled={
                  !canCapture ||
                  isPreparing ||
                  (isBusy && recorderState !== 'recording') ||
                  hasSavedTake
                }
              >
                <Ionicons
                  name={recorderState === 'recording' ? 'stop' : 'mic'}
                  size={22}
                  color={colors.text.inverse}
                />
              </Pressable>

              <Pressable
                style={[
                  styles.dockSideButton,
                  recordingUri && canCapture && !isBusy && styles.dockSideButtonUploadReady,
                  (!recordingUri || isBusy || !canCapture) && styles.dockSideButtonDisabled,
                ]}
                onPress={() => void handleUploadRecording()}
                disabled={!recordingUri || isBusy || !canCapture}
              >
                <Ionicons
                  name="cloud-upload-outline"
                  size={18}
                  color={recordingUri && canCapture && !isBusy ? colors.primary.DEFAULT : colors.text.light}
                />
              </Pressable>
            </View>

            <Text style={styles.dockHint}>
              {recorderState === 'recording'
                ? 'Tap center to stop recording.'
                : recordingUri
                  ? 'Take ready. Send to upload or discard.'
                  : 'Tap mic to start a new voice take.'}
            </Text>

            {hasSavedTake ? (
              <View style={styles.takeReadyBanner}>
                <Ionicons name="checkmark-circle" size={16} color={colors.success} />
                <Text style={styles.takeReadyText}>
                  Valid take saved ({formatDuration(durationSeconds)}). Upload or discard before importing another source.
                </Text>
              </View>
            ) : null}

            <View style={styles.quickActionRow}>
              <Button
                variant="outline"
                size="sm"
                fullWidth={false}
                onPress={handleImportAudio}
                disabled={!canCapture || isBusy || hasSavedTake}
                style={styles.quickActionButton}
              >
                Import Audio
              </Button>
              <Button
                variant="outline"
                size="sm"
                fullWidth={false}
                onPress={handleGenerateVoiceover}
                disabled={!canCapture || isBusy || hasSavedTake}
                style={styles.quickActionButton}
              >
                ElevenLabs
              </Button>
            </View>
          </View>

          {(isUploading || uploadProgress.progress > 0) && (
            <View style={styles.progressWrap}>
              <Progress value={uploadProgress.progress} showLabel label={uploadProgress.message} />
            </View>
          )}
        </Card>

        <Card>
          <Text style={styles.sectionTitle}>Script Reference</Text>
          <View style={styles.scriptMetricRow}>
            <Text style={styles.scriptMetricPill}>{scriptWordCount} words</Text>
            <Text style={styles.scriptMetricPill}>~{scriptReadMinutes} min read</Text>
            <Text style={styles.scriptMetricPill}>Teleprompter mode</Text>
          </View>
          <TextArea
            value={scriptPreview}
            editable={false}
            minLines={11}
            inputStyle={styles.scriptInput}
            helperText="Read naturally. Pause at punctuation and hit keywords with emphasis."
          />
        </Card>

        <Card>
          <Text style={styles.sectionTitle}>Alternative Input</Text>
          <Text style={styles.warningText}>
            Use these options when you want to reuse existing voice audio or auto-generate narration.
          </Text>

          {(audioPicker.isUploading || audioPicker.uploadProgress.progress > 0) && (
            <View style={styles.progressWrap}>
              <Progress
                value={audioPicker.uploadProgress.progress}
                showLabel
                label={audioPicker.uploadProgress.message}
              />
            </View>
          )}

          {(elevenLabs.isGenerating || elevenLabs.progress.progress > 0) && (
            <View style={styles.progressWrap}>
              <Progress value={elevenLabs.progress.progress} showLabel label={elevenLabs.progress.message} />
            </View>
          )}
        </Card>
      </Screen>

      <StickyActionBar>
        <Button onPress={() => navigation.navigateToEpisode({ replace: true })} disabled={isBusy}>
          Episode Overview
        </Button>
      </StickyActionBar>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing['4xl'],
    gap: spacing.md,
  },
  header: {
    gap: spacing.xs,
  },
  title: {
    color: colors.text.DEFAULT,
    fontFamily: typography.fontFamily.heading,
    fontSize: typography.fontSize.xl,
    fontWeight: typography.fontWeight.bold,
  },
  subtitle: {
    color: colors.text.muted,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
  },
  statusBadge: {
    alignSelf: 'flex-start',
    marginTop: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.primary.DEFAULT,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.bold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  warningTitle: {
    color: colors.warning,
    fontFamily: typography.fontFamily.heading,
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold,
    marginBottom: spacing.xs,
  },
  warningText: {
    color: colors.text.muted,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
    lineHeight: 20,
  },
  sectionTitle: {
    color: colors.text.DEFAULT,
    fontFamily: typography.fontFamily.heading,
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold,
    marginBottom: spacing.sm,
  },
  scriptMetricRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  scriptMetricPill: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    color: colors.text.muted,
    fontFamily: typography.fontFamily.mono,
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold,
  },
  scriptInput: {
    fontSize: typography.fontSize.lg,
    lineHeight: 31,
    letterSpacing: 0.2,
  },
  progressWrap: {
    marginTop: spacing.md,
  },
  recordHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  mono: {
    color: colors.text.DEFAULT,
    fontFamily: typography.fontFamily.mono,
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold,
  },
  recorderDockWrap: {
    gap: spacing.md,
  },
  waveRow: {
    minHeight: 52,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#EFF5FC',
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    overflow: 'hidden',
  },
  waveBar: {
    width: 4,
    height: 24,
    borderRadius: 999,
    backgroundColor: colors.primary.DEFAULT,
  },
  recorderDock: {
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    minHeight: 70,
    paddingHorizontal: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dockSideButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panelAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dockSideButtonResetReady: {
    borderColor: '#D94A66',
    backgroundColor: '#FFECEE',
  },
  dockSideButtonUploadReady: {
    borderColor: colors.primary.DEFAULT,
    backgroundColor: '#E8FBFD',
  },
  dockSideButtonDisabled: {
    opacity: 0.45,
  },
  recordMainButton: {
    width: 58,
    height: 58,
    borderRadius: 29,
    borderWidth: 1,
    borderColor: colors.primary.dark,
    backgroundColor: colors.primary.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordMainButtonActive: {
    backgroundColor: colors.error,
    borderColor: '#A72840',
    shadowColor: colors.error,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 12,
    elevation: 8,
  },
  recordMainButtonDisabled: {
    opacity: 0.5,
  },
  dockHint: {
    color: colors.text.muted,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
    textAlign: 'center',
  },
  takeReadyBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: '#2A6A52',
    backgroundColor: '#EAF9F2',
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  takeReadyText: {
    flex: 1,
    color: '#1F4E3B',
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
    lineHeight: 20,
    fontWeight: typography.fontWeight.semibold,
  },
  quickActionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  quickActionButton: {
    flex: 1,
    minWidth: 0,
  },
});
