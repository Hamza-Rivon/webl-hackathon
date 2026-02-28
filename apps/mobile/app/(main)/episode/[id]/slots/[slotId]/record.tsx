import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Platform, Pressable, StatusBar, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useLocalSearchParams, usePathname, useRouter } from 'expo-router';
import { CameraType, CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { useQueryClient } from '@tanstack/react-query';
import Animated, {
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, Progress, Screen, StickyActionBar } from '@/components/ui';
import { useToast } from '@/components/ui/Toast';
import { Teleprompter, TeleprompterBeat } from '@/components/media/Teleprompter';
import { useEpisode, episodeKeys, ScriptBeat } from '@/hooks/useEpisodes';
import { useNavigation } from '@/hooks/useNavigation';
import { useSlotUpload } from '@/hooks/useSlotUpload';
import { slotClipKeys } from '@/hooks/useSlotClips';
import { SlotType } from '@/lib/api';
import { checkNavigationGuard } from '@/lib/navigation/navigationGuards';
import { isARollFirstTemplateWithFallback } from '@/lib/templateWorkflow';
import { triggerActionHaptic } from '@/lib/haptics';
import { colors, spacing, typography, borderRadius, shadows } from '@/lib/theme';

type RecordState = 'idle' | 'recording' | 'review';

/** Statuses that allow regular (non-A-roll-first) slot recording */
const ALLOWED_STATUS = ['voiceover_cleaned', 'collecting_clips', 'needs_more_clips'];

/**
 * For A-roll-first templates (workflow: aroll_clean_then_broll), the A-roll slot
 * can be recorded from draft status onwards. The recorded video+audio gets its
 * audio extracted and cleaned through the voiceover pipeline automatically.
 */
const AROLL_FIRST_ALLOWED_STATUS = [
  'draft',
  'voiceover_uploaded',
  'voiceover_cleaning',
  'voiceover_cleaned',
  'collecting_clips',
  'needs_more_clips',
  'failed',
];

const TELEPROMPTER_SPRING = {
  damping: 24,
  stiffness: 240,
  mass: 0.8,
  overshootClamping: true,
};

function formatDuration(seconds: number) {
  const mins = Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0');
  const secs = Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0');
  return `${mins}:${secs}`;
}

const SLOT_LABELS: Record<SlotType, string> = {
  a_roll_face: 'Facecam',
  b_roll_illustration: 'Illustration B-roll',
  b_roll_action: 'Action B-roll',
  screen_record: 'Screen Recording',
  product_shot: 'Product Shot',
  pattern_interrupt: 'Pattern Interrupt',
  cta_overlay: 'CTA Overlay',
};

const TELEPROMPTER_TEXT_SIZE_OPTIONS = [
  { label: 'S', value: 0.85 },
  { label: 'M', value: 1.0 },
  { label: 'L', value: 1.2 },
] as const;

export default function SlotRecordScreen() {
  const { id = '', slotId = '' } = useLocalSearchParams<{ id: string; slotId: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const isFocused = Boolean(id && slotId) && pathname === `/episode/${id}/slots/${slotId}/record`;
  const { showToast } = useToast();
  const navigation = useNavigation(id);
  const queryClient = useQueryClient();

  const { data: episode } = useEpisode(id);
  const slotUpload = useSlotUpload(id);

  const cameraRef = useRef<CameraView | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordStateRef = useRef<RecordState>('idle');

  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [microphonePermission, requestMicPermission] = useMicrophonePermissions();

  const [recordState, setRecordState] = useState<RecordState>('idle');
  const [cameraFacing, setCameraFacing] = useState<CameraType>('front');
  const [seconds, setSeconds] = useState(0);
  const [recordedUri, setRecordedUri] = useState<string | null>(null);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  // Teleprompter state
  const [showTeleprompter, setShowTeleprompter] = useState(true);
  const [teleprompterSpeed, setTeleprompterSpeed] = useState(1.0);
  const [teleprompterTextSize, setTeleprompterTextSize] = useState(1.0);
  const [currentBeatIndex, setCurrentBeatIndex] = useState(0);
  const [showSpeedControls, setShowSpeedControls] = useState(false);

  const teleprompterLayout = useMemo(() => {
    const bottomBarBottom = Platform.OS === 'ios' ? insets.bottom + 12 : insets.bottom + 10;
    const overlayBottom = bottomBarBottom + 88;
    const speedPanelBottom = overlayBottom + 18;
    const topClearance = Platform.OS === 'ios' ? insets.top + 88 : insets.top + 72;
    const availableHeight = Math.max(240, windowHeight - topClearance - overlayBottom - spacing.md);
    const minHeight = Math.max(92, Math.min(132, availableHeight * 0.18));
    const maxHeight = Math.min(
      availableHeight,
      Math.max(minHeight + 84, availableHeight * 0.62)
    );
    const defaultHeight = Math.min(
      maxHeight - 16,
      Math.max(minHeight + 10, availableHeight * 0.26)
    );

    return {
      bottomBarBottom,
      overlayBottom,
      speedPanelBottom,
      minHeight,
      defaultHeight,
      maxHeight,
    };
  }, [insets.bottom, insets.top, windowHeight]);
  const teleprompterTopLimit = useMemo(
    () => (Platform.OS === 'ios' ? insets.top + 76 : insets.top + 64),
    [insets.top]
  );

  // Resizable teleprompter height (drag handle to resize, with responsive limits)
  const [teleprompterExpanded, setTeleprompterExpanded] = useState(false);
  const teleprompterHeight = useSharedValue(teleprompterLayout.defaultHeight);
  const teleprompterStartHeight = useSharedValue(teleprompterLayout.defaultHeight);
  const teleprompterOffsetY = useSharedValue(0);
  const teleprompterStartOffsetY = useSharedValue(0);

  const syncTeleprompterExpandedState = (height: number) => {
    const midpoint = (teleprompterLayout.minHeight + teleprompterLayout.maxHeight) / 2;
    setTeleprompterExpanded(height >= midpoint);
  };

  useEffect(() => {
    const clampedHeight = Math.max(
      teleprompterLayout.minHeight,
      Math.min(teleprompterLayout.maxHeight, teleprompterHeight.value)
    );
    teleprompterHeight.value = withSpring(clampedHeight, TELEPROMPTER_SPRING);
    syncTeleprompterExpandedState(clampedHeight);
    const maxLift = Math.max(
      0,
      windowHeight - teleprompterTopLimit - clampedHeight - teleprompterLayout.overlayBottom
    );
    const clampedOffset = Math.max(-maxLift, Math.min(0, teleprompterOffsetY.value));
    teleprompterOffsetY.value = withSpring(clampedOffset, TELEPROMPTER_SPRING);
  }, [
    teleprompterLayout.maxHeight,
    teleprompterLayout.minHeight,
    teleprompterLayout.overlayBottom,
    teleprompterTopLimit,
    windowHeight,
  ]);

  const dragGesture = Gesture.Pan()
    .activeOffsetY([-3, 3])
    .onStart(() => {
      teleprompterStartOffsetY.value = teleprompterOffsetY.value;
    })
    .onUpdate((event) => {
      const nextOffset = teleprompterStartOffsetY.value + event.translationY;
      const maxLift = Math.max(
        0,
        windowHeight - teleprompterTopLimit - teleprompterHeight.value - teleprompterLayout.overlayBottom
      );
      teleprompterOffsetY.value = Math.max(-maxLift, Math.min(0, nextOffset));
    })
    .onEnd((event) => {
      const projectedOffset = teleprompterOffsetY.value + event.velocityY * 0.06;
      const maxLift = Math.max(
        0,
        windowHeight - teleprompterTopLimit - teleprompterHeight.value - teleprompterLayout.overlayBottom
      );
      const clampedOffset = Math.max(-maxLift, Math.min(0, projectedOffset));
      teleprompterOffsetY.value = withSpring(clampedOffset, TELEPROMPTER_SPRING);
    });

  const resizeGesture = Gesture.Pan()
    .activeOffsetY([-3, 3])
    .onStart(() => {
      teleprompterStartHeight.value = teleprompterHeight.value;
    })
    .onUpdate((event) => {
      const nextHeight = teleprompterStartHeight.value - event.translationY;
      const clampedHeight = Math.max(
        teleprompterLayout.minHeight,
        Math.min(teleprompterLayout.maxHeight, nextHeight)
      );
      teleprompterHeight.value = clampedHeight;

      const maxLift = Math.max(
        0,
        windowHeight - teleprompterTopLimit - clampedHeight - teleprompterLayout.overlayBottom
      );
      teleprompterOffsetY.value = Math.max(-maxLift, Math.min(0, teleprompterOffsetY.value));
    })
    .onEnd((event) => {
      const projectedHeight = teleprompterHeight.value - event.velocityY * 0.08;
      const clampedHeight = Math.max(
        teleprompterLayout.minHeight,
        Math.min(teleprompterLayout.maxHeight, projectedHeight)
      );
      teleprompterHeight.value = withSpring(clampedHeight, TELEPROMPTER_SPRING);

      const maxLift = Math.max(
        0,
        windowHeight - teleprompterTopLimit - clampedHeight - teleprompterLayout.overlayBottom
      );
      teleprompterOffsetY.value = withSpring(
        Math.max(-maxLift, Math.min(0, teleprompterOffsetY.value)),
        TELEPROMPTER_SPRING
      );
    });

  const teleprompterAnimatedStyle = useAnimatedStyle(() => ({
    height: teleprompterHeight.value,
    transform: [{ translateY: teleprompterOffsetY.value }],
  }));

  // Toggle expand/collapse
  const toggleTeleprompterSize = () => {
    void triggerActionHaptic('selection');
    const next = !teleprompterExpanded;
    setTeleprompterExpanded(next);
    const targetHeight = next ? teleprompterLayout.maxHeight : teleprompterLayout.defaultHeight;
    teleprompterHeight.value = withSpring(targetHeight, TELEPROMPTER_SPRING);
    const maxLift = Math.max(
      0,
      windowHeight - teleprompterTopLimit - targetHeight - teleprompterLayout.overlayBottom
    );
    teleprompterOffsetY.value = withSpring(
      Math.max(-maxLift, Math.min(0, teleprompterOffsetY.value)),
      TELEPROMPTER_SPRING
    );
  };

  const status = episode?.status ?? 'draft';
  const isAroll = useMemo(() => {
    const slot = episode?.template?.slotRequirements?.slots?.find((item: any) => item.slotId === slotId);
    return slot?.slotType === 'a_roll_face';
  }, [episode?.template?.slotRequirements?.slots, slotId]);

  // Detect A-roll-first template (workflow: aroll_clean_then_broll)
  const isArollFirstTemplate = useMemo(() => {
    const slotReqs = episode?.template?.slotRequirements ?? null;
    const templateName = episode?.template?.name ?? null;
    return isARollFirstTemplateWithFallback(slotReqs as any, templateName);
  }, [episode?.template?.slotRequirements, episode?.template?.name]);

  // For A-roll slots in A-roll-first templates, allow recording from draft onwards
  const canCapture = isAroll && isArollFirstTemplate
    ? AROLL_FIRST_ALLOWED_STATUS.includes(status)
    : ALLOWED_STATUS.includes(status);

  useEffect(() => {
    if (!isFocused || !episode) return;
    // For A-roll slots in A-roll-first templates, skip the slot_collection guard
    // because recording is allowed from `draft` status onwards (voiceover_capture action).
    // The standard guard uses `slot_collection` which requires voiceover_cleaned+.
    if (isAroll && isArollFirstTemplate) return;

    const guardResult = checkNavigationGuard(
      `/(main)/episode/${id}/slots/${slotId}/record`,
      id,
      episode.status
    );
    if (!guardResult.canAccess && guardResult.redirectTarget) {
      router.replace(`/(main)/${guardResult.redirectTarget}` as any);
    }
  }, [isFocused, episode, id, slotId, router, isAroll, isArollFirstTemplate]);

  const slot = useMemo(() => {
    return episode?.template?.slotRequirements?.slots?.find((item: any) => item.slotId === slotId) || null;
  }, [episode?.template?.slotRequirements?.slots, slotId]);

  // Convert scriptBeats to TeleprompterBeat format
  const teleprompterBeats = useMemo<TeleprompterBeat[]>(() => {
    const beats = (episode?.scriptBeats || []) as ScriptBeat[];
    if (beats.length === 0 && episode?.scriptContent) {
      // Fallback: split script into paragraphs if no beats
      const paragraphs = episode.scriptContent.split(/\n\n+/).filter(Boolean);
      return paragraphs.map((text, index) => ({
        index,
        type: 'content',
        text: text.trim(),
        duration: Math.max(3, Math.ceil(text.split(/\s+/).length / 2.5)),
      }));
    }
    return beats.map((beat, index) => ({
      index,
      type: beat.beatType || 'content',
      text: beat.text || '',
      duration: beat.duration || 5,
    }));
  }, [episode?.scriptBeats, episode?.scriptContent]);

  const guidanceText = useMemo(() => {
    const beats = (episode?.scriptBeats || []) as ScriptBeat[];
    if (slot?.layoutUsage?.beatIndices?.length) {
      const lines = slot.layoutUsage.beatIndices
        .map((index: number) => beats[index]?.text)
        .filter(Boolean)
        .slice(0, 3);
      if (lines.length) return lines.join('\n\n');
    }
    return slot?.description || 'Frame the shot clearly and keep motion intentional.';
  }, [episode?.scriptBeats, slot?.description, slot?.layoutUsage?.beatIndices]);

  const latestUpload = useMemo(() => {
    const uploads = slotUpload.getSlotUploads(slotId);
    return uploads[uploads.length - 1] || null;
  }, [slotId, slotUpload]);

  useEffect(() => {
    recordStateRef.current = recordState;
  }, [recordState]);

  useEffect(() => {
    let cancelled = false;
    async function requestPermissions() {
      const [camera, mic] = await Promise.all([requestCameraPermission(), requestMicPermission()]);
      if (cancelled) return;
      if (!camera.granted || !mic.granted) {
        showToast({
          type: 'warning',
          title: 'Permissions required',
          message: 'Camera and microphone access are required for slot recording.',
        });
      }
    }
    void requestPermissions();
    return () => {
      cancelled = true;
    };
  }, [requestCameraPermission, requestMicPermission, showToast]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (cameraRef.current && recordStateRef.current === 'recording') {
        void cameraRef.current.stopRecording();
      }
    };
  }, []);

  const maxDuration = slot?.duration?.max || 30;

  const startRecording = async () => {
    if (!cameraRef.current || !canCapture || !slot || !isCameraReady) return;
    try {
      await triggerActionHaptic('selection');
      setSeconds(0);
      setRecordedUri(null);
      setRecordState('recording');
      setShowSpeedControls(false);
      timerRef.current = setInterval(() => {
        setSeconds((value) => {
          const next = value + 1;
          if (next >= maxDuration) void stopRecording();
          return next;
        });
      }, 1000);
      const result = await cameraRef.current.recordAsync({ maxDuration });
      if (result?.uri) {
        setRecordedUri(result.uri);
        setRecordState('review');
      } else {
        setRecordState('idle');
      }
    } catch (error) {
      setRecordState('idle');
      showToast({
        type: 'error',
        title: 'Recording failed',
        message: error instanceof Error ? error.message : 'Could not start recording.',
      });
    } finally {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  };

  const stopRecording = async () => {
    if (!cameraRef.current || recordState !== 'recording') return;
    try {
      await triggerActionHaptic('selection');
      await cameraRef.current.stopRecording();
    } catch {
      setRecordState('idle');
    }
  };

  const uploadRecording = async () => {
    if (!slot || !recordedUri) return;
    const result = await slotUpload.uploadSlotClip({
      uri: recordedUri,
      slotId,
      slotType: slot.slotType as SlotType,
      source: 'recorded',
      duration: seconds,
    });
    if (!result) {
      showToast({ type: 'error', title: 'Upload failed', message: 'Could not upload this take.' });
      return;
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: slotClipKeys.list(id) }),
      queryClient.invalidateQueries({ queryKey: episodeKeys.detail(id) }),
    ]);

    // For A-roll-first templates, the backend auto-starts the voiceover pipeline
    // from the recorded video's audio. Navigate to episode detail to show processing.
    if (isAroll && isArollFirstTemplate) {
      showToast({
        type: 'success',
        title: 'A-Roll recorded',
        message: 'Audio is being extracted and cleaned. You can add B-roll after cleanup.',
      });
      await triggerActionHaptic('success');
      await navigation.navigate(`/(main)/episode/${id}`, { replace: true });
      return;
    }

    showToast({
      type: 'success',
      title: 'Slot recorded',
      message: `${SLOT_LABELS[slot.slotType as SlotType]} clip uploaded successfully.`,
    });
    await triggerActionHaptic('success');
    await navigation.navigate(`/(main)/episode/${id}/slots`, { replace: true });
  };

  const handleBack = async () => {
    if (recordState === 'recording' || slotUpload.isUploading) {
      Alert.alert('Leave recording?', 'Current recording/upload will be interrupted.', [
        { text: 'Stay', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: () => {
            if (recordState === 'recording') void stopRecording();
            void navigation.navigateBack();
          },
        },
      ]);
      return;
    }
    await navigation.navigateBack();
  };

  if (!slot) {
    return (
      <Screen contentContainerStyle={recStyles.content}>
        <Text style={recStyles.title}>Slot not found</Text>
        <Text style={recStyles.muted}>This slot is not part of the current template plan.</Text>
      </Screen>
    );
  }

  const permissionDenied = cameraPermission && microphonePermission && (!cameraPermission.granted || !microphonePermission.granted);
  const canRecordNow = canCapture && !permissionDenied && recordState !== 'recording' && !slotUpload.isUploading;
  const showTeleprompterOverlay = isAroll && showTeleprompter && teleprompterBeats.length > 0;

  // ───── Full-screen A-roll (facecam) layout ─────
  if (isAroll) {
    return (
      <View style={fullStyles.root}>
        <StatusBar barStyle="light-content" />

        {/* Full-screen camera */}
        {permissionDenied ? (
          <View style={fullStyles.permissionWrap}>
            <Text style={fullStyles.permissionText}>Camera and microphone permissions are required for facecam recording.</Text>
            <Pressable style={fullStyles.backBtn} onPress={handleBack}>
              <Text style={fullStyles.backBtnText}>Go Back</Text>
            </Pressable>
          </View>
        ) : (
          <CameraView
            ref={cameraRef}
            facing={cameraFacing}
            style={StyleSheet.absoluteFillObject}
            mode="video"
            onCameraReady={() => setIsCameraReady(true)}
          />
        )}

        {/* Teleprompter overlay — bottom-anchored, resizable panel */}
        {showTeleprompterOverlay && !permissionDenied ? (
          <Animated.View
            entering={FadeIn.duration(300)}
            exiting={FadeOut.duration(200)}
            style={[
              fullStyles.teleprompterOverlayShell,
              { bottom: teleprompterLayout.overlayBottom },
            ]}
          >
            <Animated.View style={[fullStyles.teleprompterOverlay, teleprompterAnimatedStyle]}>
              <GestureDetector gesture={dragGesture}>
                <View style={fullStyles.teleprompterHeader}>
                  <View style={fullStyles.dragHandle}>
                    <View style={fullStyles.dragHandleBar} />
                  </View>
                  <View style={fullStyles.teleprompterTextSizeRow}>
                    {TELEPROMPTER_TEXT_SIZE_OPTIONS.map((preset) => (
                      <Pressable
                        key={preset.label}
                        style={[
                          fullStyles.textSizeChip,
                          teleprompterTextSize === preset.value && fullStyles.textSizeChipActive,
                        ]}
                        onPress={() => {
                          void triggerActionHaptic('selection');
                          setTeleprompterTextSize(preset.value);
                        }}
                      >
                        <Text
                          style={[
                            fullStyles.textSizeChipText,
                            teleprompterTextSize === preset.value && fullStyles.textSizeChipTextActive,
                          ]}
                        >
                          {preset.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  <Pressable style={fullStyles.expandToggle} onPress={toggleTeleprompterSize} hitSlop={12}>
                    <Text style={fullStyles.expandToggleText}>{teleprompterExpanded ? '▾' : '▴'}</Text>
                  </Pressable>
                </View>
              </GestureDetector>
              <GestureDetector gesture={resizeGesture}>
                <View style={fullStyles.resizeRail} pointerEvents="box-only">
                  <View style={fullStyles.resizeRailLine} />
                </View>
              </GestureDetector>
              <Teleprompter
                beats={teleprompterBeats}
                currentBeatIndex={currentBeatIndex}
                isPlaying={recordState === 'recording'}
                speed={teleprompterSpeed}
                textSize={teleprompterTextSize}
                onSpeedChange={setTeleprompterSpeed}
                onTextSizeChange={setTeleprompterTextSize}
                onBeatChange={setCurrentBeatIndex}
                showControls={false}
                mirrored={false}
                allowManualScroll={recordState !== 'recording'}
              />
            </Animated.View>
          </Animated.View>
        ) : null}

        {/* Top bar: timer + recording indicator */}
        <View style={[fullStyles.topBar, { top: Math.max(8, insets.top - 44) }]}>
          <Pressable style={fullStyles.topBackBtn} onPress={handleBack}>
            <Text style={fullStyles.topBackText}>✕</Text>
          </Pressable>

          <View style={fullStyles.timerWrap}>
            {recordState === 'recording' ? (
              <Animated.View entering={FadeIn.duration(200)} style={fullStyles.recBadge}>
                <View style={fullStyles.recDot} />
                <Text style={fullStyles.timerText}>REC</Text>
              </Animated.View>
            ) : null}
            <Text style={fullStyles.timerText}>{formatDuration(seconds)}</Text>
          </View>

          <View style={fullStyles.topRightPlaceholder} />
        </View>

        {/* Speed controls popover */}
        {showSpeedControls && recordState !== 'recording' ? (
          <Animated.View
            entering={FadeIn.duration(200)}
            exiting={FadeOut.duration(150)}
            style={[fullStyles.speedPanel, { bottom: teleprompterLayout.speedPanelBottom }]}
          >
            <Text style={fullStyles.speedTitle}>Speed</Text>
            <View style={fullStyles.speedRow}>
              {[0.5, 0.75, 1, 1.25, 1.5, 2].map((speed) => (
                <Pressable
                  key={speed}
                  style={[fullStyles.speedChip, teleprompterSpeed === speed && fullStyles.speedChipActive]}
                  onPress={() => setTeleprompterSpeed(speed)}
                >
                  <Text style={[fullStyles.speedChipText, teleprompterSpeed === speed && fullStyles.speedChipTextActive]}>
                    {speed}x
                  </Text>
                </Pressable>
              ))}
            </View>
          </Animated.View>
        ) : null}

        {/* Bottom controls overlay */}
        <View style={[fullStyles.bottomBar, { bottom: teleprompterLayout.bottomBarBottom }]}>
          {/* Left column: teleprompter + speed + flip */}
          <View style={fullStyles.sideCol}>
            <Pressable
              style={[fullStyles.iconBtn, showTeleprompter && fullStyles.iconBtnActive]}
              onPress={() => {
                void triggerActionHaptic('selection');
                setShowTeleprompter((v) => !v);
              }}
            >
              <Text style={fullStyles.iconBtnText}>{showTeleprompter ? 'Hide' : 'Script'}</Text>
            </Pressable>
            {showTeleprompter ? (
              <Pressable
                style={fullStyles.iconBtn}
                onPress={() => {
                  void triggerActionHaptic('selection');
                  setShowSpeedControls((v) => !v);
                }}
              >
                <Text style={fullStyles.iconBtnText}>{teleprompterSpeed}x</Text>
              </Pressable>
            ) : null}
          </View>

          {/* Center: main record / stop / save button */}
          <View style={fullStyles.centerCol}>
            {recordState === 'idle' && !recordedUri ? (
              <Pressable
                style={[fullStyles.recordBtn, !canRecordNow && fullStyles.recordBtnDisabled]}
                onPress={startRecording}
                disabled={!canRecordNow}
              >
                <View style={fullStyles.recordBtnInner} />
              </Pressable>
            ) : null}

            {recordState === 'recording' ? (
              <Pressable style={fullStyles.stopBtn} onPress={stopRecording}>
                <View style={fullStyles.stopBtnInner} />
              </Pressable>
            ) : null}

            {recordedUri ? (
              <View style={fullStyles.reviewActions}>
                <Pressable
                  style={fullStyles.discardBtn}
                  onPress={() => {
                    setRecordedUri(null);
                    setSeconds(0);
                    setRecordState('idle');
                  }}
                  disabled={slotUpload.isUploading}
                >
                  <Text style={fullStyles.discardBtnText}>Retake</Text>
                </Pressable>
                <Pressable
                  style={[fullStyles.saveBtn, slotUpload.isUploading && fullStyles.saveBtnDisabled]}
                  onPress={uploadRecording}
                  disabled={slotUpload.isUploading}
                >
                  <Text style={fullStyles.saveBtnText}>
                    {slotUpload.isUploading ? 'Saving...' : 'Save'}
                  </Text>
                </Pressable>
              </View>
            ) : null}
          </View>

          {/* Right column: flip camera */}
          <View style={fullStyles.sideCol}>
            <Pressable
              style={fullStyles.iconBtn}
              onPress={() => {
                void triggerActionHaptic('selection');
                setCameraFacing((v) => (v === 'front' ? 'back' : 'front'));
              }}
              disabled={recordState === 'recording'}
            >
              <Text style={fullStyles.iconBtnText}>Flip</Text>
            </Pressable>
          </View>
        </View>

        {!canCapture ? (
          <View style={fullStyles.warningBanner}>
            <Text style={fullStyles.warningBannerText}>
              {isArollFirstTemplate
                ? 'Recording locked — write or generate a script first.'
                : 'Recording locked — episode not in clip-collection state.'}
            </Text>
          </View>
        ) : null}

        {latestUpload ? (
          <View style={fullStyles.uploadProgress}>
            <Progress value={latestUpload.progress} showLabel label={latestUpload.status} />
          </View>
        ) : null}
      </View>
    );
  }

  // ───── Standard (non-A-roll) layout ─────
  return (
    <View style={recStyles.root}>
      <Screen contentContainerStyle={recStyles.content}>
        <View style={recStyles.header}>
          <Text style={recStyles.title}>{SLOT_LABELS[slot.slotType as SlotType]} Capture</Text>
          <Text style={recStyles.subtitle}>{slot.slotId} • target {slot.duration.target}s • max {slot.duration.max}s</Text>
        </View>

        {/* Camera with teleprompter overlay */}
        <Card variant="elevated" padding="md" style={recStyles.cameraCard}>
          {permissionDenied ? (
            <View style={recStyles.placeholder}>
              <Text style={recStyles.warningText}>Camera and microphone permissions are required.</Text>
            </View>
          ) : (
            <View style={recStyles.cameraContainer}>
              <CameraView
                ref={cameraRef}
                facing={cameraFacing}
                style={recStyles.camera}
                mode="video"
                onCameraReady={() => setIsCameraReady(true)}
              />

              {/* Recording indicator */}
              {recordState === 'recording' ? (
                <Animated.View entering={FadeIn.duration(200)} style={recStyles.recordingIndicator}>
                  <View style={recStyles.recordingDot} />
                  <Text style={recStyles.recordingText}>REC {formatDuration(seconds)}</Text>
                </Animated.View>
              ) : null}

              {/* Camera controls overlay */}
              <View style={recStyles.cameraControlsOverlay}>
                <Pressable
                  style={recStyles.overlayButton}
                  onPress={() => {
                    void triggerActionHaptic('selection');
                    setCameraFacing((v) => (v === 'front' ? 'back' : 'front'));
                  }}
                  disabled={recordState === 'recording'}
                >
                  <Text style={recStyles.overlayButtonText}>Flip</Text>
                </Pressable>
              </View>
            </View>
          )}

          <View style={recStyles.cameraMeta}>
            <Text style={recStyles.mono}>{formatDuration(seconds)}</Text>
            <Text style={recStyles.muted}>
              {recordState === 'recording' ? 'Recording live' : recordedUri ? 'Take ready' : 'Ready'}
            </Text>
          </View>
        </Card>

        {/* Controls */}
        <Card>
          <Text style={recStyles.sectionTitle}>Controls</Text>
          <View style={recStyles.stack}>
            {recordState === 'idle' && !recordedUri ? (
              <Button onPress={startRecording} disabled={!canRecordNow}>
                Start Recording
              </Button>
            ) : null}
            {recordState === 'recording' ? (
              <Button variant="danger" onPress={stopRecording}>
                Stop Recording
              </Button>
            ) : null}
            {recordedUri ? (
              <>
                <Button onPress={uploadRecording} disabled={slotUpload.isUploading} loading={slotUpload.isUploading}>
                  Upload Take
                </Button>
                <Button
                  variant="ghost"
                  onPress={() => {
                    setRecordedUri(null);
                    setSeconds(0);
                    setRecordState('idle');
                  }}
                  disabled={slotUpload.isUploading}
                >
                  Discard Take
                </Button>
              </>
            ) : null}
          </View>
          {!canCapture ? (
            <Text style={recStyles.warningText}>Recording is locked while this episode is outside clip-collection states.</Text>
          ) : null}
        </Card>

        {/* Non-A-roll guidance */}
        <Card>
          <Text style={recStyles.sectionTitle}>Guidance</Text>
          <Text style={recStyles.guidance}>{guidanceText}</Text>
        </Card>

        {latestUpload ? (
          <Card>
            <Text style={recStyles.sectionTitle}>Latest Upload</Text>
            <Progress value={latestUpload.progress} showLabel label={latestUpload.status} />
          </Card>
        ) : null}
      </Screen>

      <StickyActionBar>
        <Button variant="ghost" onPress={handleBack}>
          Back
        </Button>
        <Button onPress={() => navigation.navigate(`/(main)/episode/${id}/slots`, { replace: true })}>
          Slot Board
        </Button>
      </StickyActionBar>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════════
//  Full-screen A-roll styles
// ═══════════════════════════════════════════════════════════════════════
const fullStyles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000',
  },
  permissionWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.lg,
  },
  permissionText: {
    color: '#FFFFFF',
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.base,
    textAlign: 'center',
    lineHeight: 24,
  },
  backBtn: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.full,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  backBtnText: {
    color: '#FFFFFF',
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
  },
  // Top bar
  topBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    zIndex: 30,
  },
  topBackBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  topBackText: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: typography.fontWeight.bold,
  },
  timerWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
  },
  recBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  recDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#FF3B30',
  },
  timerText: {
    color: '#FFFFFF',
    fontFamily: typography.fontFamily.mono,
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold,
    letterSpacing: 1,
  },
  topRightPlaceholder: {
    width: 40,
  },
  // Teleprompter overlay — bottom-anchored resizable panel
  teleprompterOverlayShell: {
    position: 'absolute',
    left: spacing.sm,
    right: spacing.sm,
    zIndex: 10,
  },
  teleprompterOverlay: {
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    backgroundColor: 'rgba(5, 8, 12, 0.2)',
  },
  teleprompterHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xs,
    paddingBottom: spacing.xs,
  },
  dragHandle: {
    minHeight: 20,
    minWidth: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.full,
    backgroundColor: 'rgba(255,255,255,0.04)',
    zIndex: 30,
  },
  dragHandleBar: {
    width: 28,
    height: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.5)',
  },
  teleprompterTextSizeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  textSizeChip: {
    minWidth: 24,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  textSizeChipActive: {
    borderColor: 'rgba(255,255,255,0.45)',
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
  },
  textSizeChipText: {
    color: 'rgba(255,255,255,0.85)',
    fontFamily: typography.fontFamily.mono,
    fontSize: 10,
    fontWeight: typography.fontWeight.medium,
  },
  textSizeChipTextActive: {
    color: '#FFFFFF',
    fontWeight: typography.fontWeight.bold,
  },
  expandToggle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  expandToggleText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: typography.fontWeight.bold as any,
  },
  resizeRail: {
    height: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  resizeRailLine: {
    width: '88%',
    height: 2,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.32)',
  },
  // Speed controls panel
  speedPanel: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    backgroundColor: 'rgba(8, 10, 14, 0.42)',
    borderRadius: borderRadius.lg,
    padding: spacing.sm,
    zIndex: 25,
  },
  speedTitle: {
    color: 'rgba(255,255,255,0.7)',
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.bold,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: spacing.sm,
  },
  speedRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  speedChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  speedChipActive: {
    backgroundColor: colors.primary.DEFAULT,
    borderColor: colors.primary.DEFAULT,
  },
  speedChipText: {
    color: '#FFFFFF',
    fontFamily: typography.fontFamily.mono,
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.bold,
  },
  speedChipTextActive: {
    color: '#FFFFFF',
  },
  // Bottom bar
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    zIndex: 30,
  },
  sideCol: {
    width: 64,
    gap: spacing.sm,
    alignItems: 'center',
  },
  centerCol: {
    flex: 1,
    alignItems: 'center',
  },
  iconBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnActive: {
    backgroundColor: 'rgba(14, 165, 168, 0.7)',
  },
  iconBtnText: {
    color: '#FFFFFF',
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.bold,
    textAlign: 'center',
  },
  // Record button
  recordBtn: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 4,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  recordBtnDisabled: {
    opacity: 0.4,
  },
  recordBtnInner: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#FF3B30',
  },
  // Stop button
  stopBtn: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 4,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  stopBtnInner: {
    width: 32,
    height: 32,
    borderRadius: 6,
    backgroundColor: '#FF3B30',
  },
  // Review actions
  reviewActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
  },
  discardBtn: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.full,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
  },
  discardBtnText: {
    color: '#FFFFFF',
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
  },
  saveBtn: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.full,
    backgroundColor: colors.primary.DEFAULT,
  },
  saveBtnDisabled: {
    opacity: 0.5,
  },
  saveBtnText: {
    color: '#FFFFFF',
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold,
  },
  // Warning banner
  warningBanner: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 110 : 90,
    left: spacing.lg,
    right: spacing.lg,
    backgroundColor: 'rgba(255, 152, 0, 0.9)',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    zIndex: 30,
  },
  warningBannerText: {
    color: '#FFFFFF',
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold,
    textAlign: 'center',
  },
  // Upload progress
  uploadProgress: {
    position: 'absolute',
    bottom: Platform.OS === 'ios' ? 150 : 130,
    left: spacing.lg,
    right: spacing.lg,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    zIndex: 25,
  },
});

// ═══════════════════════════════════════════════════════════════════════
//  Standard (non-A-roll) styles
// ═══════════════════════════════════════════════════════════════════════
const recStyles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing['2xl'],
    paddingBottom: spacing['4xl'],
    gap: spacing.md,
  },
  header: {
    gap: spacing.xs,
  },
  title: {
    color: colors.text.DEFAULT,
    fontFamily: typography.fontFamily.heading,
    fontSize: typography.fontSize['2xl'],
    fontWeight: typography.fontWeight.bold,
  },
  subtitle: {
    color: colors.text.muted,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.base,
  },
  sectionTitle: {
    color: colors.text.DEFAULT,
    fontFamily: typography.fontFamily.heading,
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold,
    marginBottom: spacing.sm,
  },
  cameraCard: {
    overflow: 'hidden',
  },
  cameraContainer: {
    position: 'relative',
    width: '100%',
    height: 420,
    borderRadius: spacing.md,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  camera: {
    width: '100%',
    height: '100%',
  },
  placeholder: {
    width: '100%',
    height: 420,
    borderRadius: spacing.md,
    backgroundColor: colors.panel,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  cameraMeta: {
    marginTop: spacing.sm,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  mono: {
    color: colors.text.DEFAULT,
    fontFamily: typography.fontFamily.mono,
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold,
  },
  muted: {
    color: colors.text.light,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
  },
  guidance: {
    color: colors.text.muted,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.base,
    lineHeight: 22,
  },
  warningText: {
    color: colors.warning,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
    lineHeight: 20,
    marginTop: spacing.sm,
  },
  stack: {
    gap: spacing.sm,
  },
  // Recording indicator
  recordingIndicator: {
    position: 'absolute',
    top: spacing.md,
    left: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
    zIndex: 20,
  },
  recordingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#FF3B30',
  },
  recordingText: {
    color: '#FFFFFF',
    fontFamily: typography.fontFamily.mono,
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.bold,
    letterSpacing: 1,
  },
  // Camera controls overlay
  cameraControlsOverlay: {
    position: 'absolute',
    bottom: spacing.md,
    right: spacing.md,
    flexDirection: 'column',
    gap: spacing.sm,
    zIndex: 15,
  },
  overlayButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    ...shadows.sm,
  },
  overlayButtonActive: {
    backgroundColor: 'rgba(14, 165, 168, 0.7)',
  },
  overlayButtonText: {
    color: '#FFFFFF',
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.bold,
    textAlign: 'center',
  },
});
