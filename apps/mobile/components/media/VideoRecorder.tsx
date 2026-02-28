/**
 * Video Recorder Component
 *
 * In-app video recording with camera preview and controls.
 * Requirements: 10.2
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Alert,
  Dimensions,
} from 'react-native';
import { CameraView, CameraType, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import * as FileSystem from 'expo-file-system/legacy';
import Animated, {
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  withSequence,
} from 'react-native-reanimated';
import { Button } from '../ui/Button';
import { colors, typography, spacing, borderRadius, shadows } from '../../lib/theme';
import { triggerHaptic } from '../../lib/haptics';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

export interface VideoRecorderProps {
  /** Callback when recording is complete */
  onRecordingComplete: (uri: string) => void;
  /** Callback to close the recorder */
  onClose: () => void;
  /** Maximum recording duration in seconds */
  maxDuration?: number;
  /** Video quality preset */
  quality?: 'low' | 'medium' | 'high';
}

type RecordingState = 'idle' | 'recording' | 'paused' | 'processing';

export function VideoRecorder({
  onRecordingComplete,
  onClose,
  maxDuration = 300, // 5 minutes default
  quality = 'high',
}: VideoRecorderProps) {
  const cameraRef = useRef<CameraView>(null);
  
  // Permissions
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();
  
  // State
  const [facing, setFacing] = useState<CameraType>('back');
  const [recordingState, setRecordingState] = useState<RecordingState>('idle');
  const [duration, setDuration] = useState(0);
  const [isReady, setIsReady] = useState(false);
  
  // Animation values
  const recordingPulse = useSharedValue(1);
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Request permissions on mount
  useEffect(() => {
    requestPermissions();
    return () => {
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
      }
    };
  }, []);

  // Recording pulse animation
  useEffect(() => {
    if (recordingState === 'recording') {
      recordingPulse.value = withRepeat(
        withSequence(
          withTiming(1.2, { duration: 500 }),
          withTiming(1, { duration: 500 })
        ),
        -1,
        true
      );
    } else {
      recordingPulse.value = 1;
    }
  }, [recordingState]);

  const requestPermissions = async () => {
    const cameraResult = await requestCameraPermission();
    const micResult = await requestMicPermission();

    if (!cameraResult.granted || !micResult.granted) {
      Alert.alert(
        'Permissions Required',
        'Camera and microphone access are required to record video.',
        [
          { text: 'Cancel', onPress: onClose, style: 'cancel' },
          { text: 'Settings', onPress: () => {} }, // Could open settings
        ]
      );
    }
  };

  const handleCameraReady = () => {
    setIsReady(true);
  };

  const toggleCameraFacing = () => {
    triggerHaptic('light');
    setFacing((current) => (current === 'back' ? 'front' : 'back'));
  };

  const startRecording = async () => {
    if (!cameraRef.current || !isReady) return;

    try {
      triggerHaptic('medium');
      setRecordingState('recording');
      setDuration(0);

      // Start duration timer
      durationIntervalRef.current = setInterval(() => {
        setDuration((prev) => {
          if (prev >= maxDuration - 1) {
            stopRecording();
            return prev;
          }
          return prev + 1;
        });
      }, 1000);

      // Start recording
      const video = await cameraRef.current.recordAsync({
        maxDuration,
      });

      // Recording stopped (either manually or max duration reached)
      if (video?.uri) {
        handleRecordingComplete(video.uri);
      }
    } catch (error) {
      console.error('Recording error:', error);
      triggerHaptic('error');
      setRecordingState('idle');
      Alert.alert('Recording Failed', 'Could not start recording. Please try again.');
    }
  };

  const stopRecording = async () => {
    if (!cameraRef.current || recordingState !== 'recording') return;

    try {
      triggerHaptic('medium');
      
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
        durationIntervalRef.current = null;
      }

      setRecordingState('processing');
      await cameraRef.current.stopRecording();
    } catch (error) {
      console.error('Stop recording error:', error);
      setRecordingState('idle');
    }
  };

  const handleRecordingComplete = async (uri: string) => {
    setRecordingState('processing');

    try {
      // Verify file exists
      const fileInfo = await FileSystem.getInfoAsync(uri);
      if (!fileInfo.exists) {
        throw new Error('Recording file not found');
      }

      triggerHaptic('success');
      onRecordingComplete(uri);
    } catch (error) {
      console.error('Recording complete error:', error);
      triggerHaptic('error');
      Alert.alert('Error', 'Could not save recording. Please try again.');
      setRecordingState('idle');
    }
  };

  const handleClose = () => {
    if (recordingState === 'recording') {
      Alert.alert(
        'Recording in Progress',
        'Are you sure you want to cancel the recording?',
        [
          { text: 'Continue Recording', style: 'cancel' },
          {
            text: 'Cancel Recording',
            style: 'destructive',
            onPress: async () => {
              await stopRecording();
              onClose();
            },
          },
        ]
      );
    } else {
      onClose();
    }
  };

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const recordingDotStyle = useAnimatedStyle(() => ({
    transform: [{ scale: recordingPulse.value }],
  }));

  // Permission check
  if (!cameraPermission?.granted || !micPermission?.granted) {
    return (
      <View style={styles.container}>
        <View style={styles.permissionContainer}>
          <Text style={styles.permissionEmoji}>📹</Text>
          <Text style={styles.permissionTitle}>Camera Access Required</Text>
          <Text style={styles.permissionText}>
            Please grant camera and microphone permissions to record video.
          </Text>
          <View style={styles.permissionButtons}>
            <Button variant="outline" onPress={onClose}>
              Cancel
            </Button>
            <Button variant="primary" onPress={requestPermissions}>
              Grant Access
            </Button>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Camera Preview */}
      <CameraView
        ref={cameraRef}
        style={styles.camera}
        facing={facing}
        mode="video"
        onCameraReady={handleCameraReady}
      >
        {/* Top Controls */}
        <Animated.View entering={FadeIn.duration(300)} style={styles.topControls}>
          <Pressable
            style={styles.closeButton}
            onPress={handleClose}
            accessibilityLabel="Close recorder"
          >
            <Text style={styles.closeButtonText}>✕</Text>
          </Pressable>

          {/* Duration Display */}
          {recordingState === 'recording' && (
            <Animated.View entering={FadeIn.duration(200)} style={styles.durationContainer}>
              <Animated.View style={[styles.recordingDot, recordingDotStyle]} />
              <Text style={styles.durationText}>{formatDuration(duration)}</Text>
              <Text style={styles.maxDurationText}>/ {formatDuration(maxDuration)}</Text>
            </Animated.View>
          )}

          <Pressable
            style={styles.flipButton}
            onPress={toggleCameraFacing}
            disabled={recordingState === 'recording'}
            accessibilityLabel="Flip camera"
          >
            <Text style={styles.flipButtonText}>🔄</Text>
          </Pressable>
        </Animated.View>

        {/* Bottom Controls */}
        <Animated.View entering={FadeIn.duration(300).delay(100)} style={styles.bottomControls}>
          {/* Recording Button */}
          <Pressable
            style={[
              styles.recordButton,
              recordingState === 'recording' && styles.recordButtonActive,
            ]}
            onPress={recordingState === 'recording' ? stopRecording : startRecording}
            disabled={!isReady || recordingState === 'processing'}
            accessibilityLabel={recordingState === 'recording' ? 'Stop recording' : 'Start recording'}
          >
            {recordingState === 'recording' ? (
              <View style={styles.stopIcon} />
            ) : recordingState === 'processing' ? (
              <Text style={styles.processingText}>⏳</Text>
            ) : (
              <View style={styles.recordIcon} />
            )}
          </Pressable>

          {/* Instructions */}
          <Text style={styles.instructionText}>
            {recordingState === 'idle' && 'Tap to start recording'}
            {recordingState === 'recording' && 'Tap to stop'}
            {recordingState === 'processing' && 'Processing...'}
          </Text>
        </Animated.View>

        {/* Processing Overlay */}
        {recordingState === 'processing' && (
          <Animated.View
            entering={FadeIn.duration(200)}
            exiting={FadeOut.duration(200)}
            style={styles.processingOverlay}
          >
            <Text style={styles.processingEmoji}>⚙️</Text>
            <Text style={styles.processingLabel}>Processing video...</Text>
          </Animated.View>
        )}
      </CameraView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.border,
  },
  camera: {
    flex: 1,
  },
  // Permission screen
  permissionContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    backgroundColor: colors.background,
  },
  permissionEmoji: {
    fontSize: 64,
    marginBottom: spacing.lg,
  },
  permissionTitle: {
    fontSize: typography.fontSize.xl,
    fontWeight: '700',
    color: colors.text.DEFAULT,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  permissionText: {
    fontSize: typography.fontSize.base,
    color: colors.text.muted,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  permissionButtons: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  // Top controls
  topControls: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: 60,
    paddingBottom: spacing.lg,
  },
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.full,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButtonText: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.surface,
  },
  flipButton: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.full,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  flipButtonText: {
    fontSize: 20,
  },
  // Duration display
  durationContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
    gap: spacing.sm,
  },
  recordingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.error,
  },
  durationText: {
    fontSize: typography.fontSize.base,
    fontWeight: '700',
    color: colors.surface,
  },
  maxDurationText: {
    fontSize: typography.fontSize.sm,
    color: 'rgba(255, 255, 255, 0.6)',
  },
  // Bottom controls
  bottomControls: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingBottom: spacing['4xl'],
    paddingTop: spacing.xl,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  recordButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.surface,
    borderWidth: 4,
    borderColor: colors.error,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.md,
  },
  recordButtonActive: {
    backgroundColor: colors.error,
    borderColor: colors.surface,
  },
  recordIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.error,
  },
  stopIcon: {
    width: 28,
    height: 28,
    borderRadius: 4,
    backgroundColor: colors.surface,
  },
  processingText: {
    fontSize: 32,
  },
  instructionText: {
    marginTop: spacing.md,
    fontSize: typography.fontSize.sm,
    color: colors.surface,
    fontWeight: '600',
  },
  // Processing overlay
  processingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  processingEmoji: {
    fontSize: 48,
    marginBottom: spacing.md,
  },
  processingLabel: {
    fontSize: typography.fontSize.lg,
    fontWeight: '600',
    color: colors.surface,
  },
});

export default VideoRecorder;
