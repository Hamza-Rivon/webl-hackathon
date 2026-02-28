/**
 * Retake Modal Component
 *
 * Modal for confirming segment retake with playback preview.
 * Requirements: 9.6
 */

import React, { useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
} from 'react-native';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import Animated, { FadeIn, FadeOut, SlideInDown, SlideOutDown } from 'react-native-reanimated';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Progress } from '../ui/Progress';
import { colors, typography, spacing, borderRadius, shadows } from '../../lib/theme';
import { triggerHaptic } from '../../lib/haptics';

export interface RetakeModalProps {
  /** Whether modal is visible */
  visible: boolean;
  /** Beat index being retaken */
  beatIndex: number;
  /** Beat type (hook, problem, etc.) */
  beatType: string;
  /** Beat text content */
  beatText: string;
  /** URI of existing recording */
  recordingUri: string;
  /** Recording duration in seconds */
  duration: number;
  /** Callback when retake is confirmed */
  onConfirm: () => void;
  /** Callback when modal is closed */
  onClose: () => void;
}

// Beat type emojis
const beatTypeEmojis: Record<string, string> = {
  hook: '🎣',
  problem: '❓',
  solution: '💡',
  proof: '📊',
  cta: '👆',
  intro: '👋',
  outro: '👋',
  content: '📝',
};

export function RetakeModal({
  visible,
  beatIndex,
  beatType,
  beatText,
  recordingUri,
  duration,
  onConfirm,
  onClose,
}: RetakeModalProps) {
  const player = useAudioPlayer(recordingUri ? { uri: recordingUri } : null, {
    updateInterval: 200,
    keepAudioSessionActive: true,
  });
  const status = useAudioPlayerStatus(player);

  useEffect(() => {
    if (!visible) {
      player.pause();
      void player.seekTo(0);
    }
  }, [player, visible]);

  const handlePlayPause = async () => {
    try {
      if (status.playing) {
        player.pause();
      } else {
        if (status.didJustFinish) {
          await player.seekTo(0);
        }
        player.play();
        triggerHaptic('light');
      }
    } catch (error) {
      console.error('Playback error:', error);
    }
  };

  const handleConfirm = async () => {
    triggerHaptic('warning');
    player.pause();
    await player.seekTo(0);
    onConfirm();
  };

  const handleClose = async () => {
    player.pause();
    await player.seekTo(0);
    onClose();
  };

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const emoji = beatTypeEmojis[beatType] || '📝';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={handleClose}
    >
      <Animated.View
        entering={FadeIn.duration(200)}
        exiting={FadeOut.duration(200)}
        style={styles.overlay}
      >
        <Pressable style={styles.backdrop} onPress={handleClose} />
        
        <Animated.View
          entering={SlideInDown.duration(300).springify()}
          exiting={SlideOutDown.duration(200)}
          style={styles.modalContainer}
        >
          <Card variant="default" style={styles.modal}>
            {/* Header */}
            <View style={styles.header}>
              <Text style={styles.emoji}>{emoji}</Text>
              <Text style={styles.title}>Retake Beat {beatIndex + 1}?</Text>
              <Text style={styles.beatType}>
                {beatType.charAt(0).toUpperCase() + beatType.slice(1)}
              </Text>
            </View>

            {/* Beat Text Preview */}
            <View style={styles.textPreview}>
              <Text style={styles.textPreviewLabel}>Script:</Text>
              <Text style={styles.textPreviewContent} numberOfLines={3}>
                {beatText}
              </Text>
            </View>

            {/* Playback Controls */}
            <View style={styles.playbackSection}>
              <Text style={styles.playbackLabel}>Current Recording</Text>
              <View style={styles.playbackControls}>
                <Pressable
                  style={styles.playButton}
                  onPress={handlePlayPause}
                  accessibilityLabel={status.playing ? 'Pause' : 'Play'}
                  accessibilityRole="button"
                >
                  <Text style={styles.playButtonText}>
                    {status.playing ? '⏸️' : '▶️'}
                  </Text>
                </Pressable>
                <View style={styles.playbackProgress}>
                  <Progress
                    value={status.duration > 0 ? (status.currentTime / status.duration) * 100 : 0}
                    variant="primary"
                    size="sm"
                  />
                </View>
                <Text style={styles.durationText}>{formatDuration(duration)}</Text>
              </View>
            </View>

            {/* Warning */}
            <View style={styles.warning}>
              <Text style={styles.warningIcon}>⚠️</Text>
              <Text style={styles.warningText}>
                This will delete the current recording and let you record again.
              </Text>
            </View>

            {/* Actions */}
            <View style={styles.actions}>
              <Button
                variant="outline"
                size="md"
                onPress={handleClose}
                style={styles.cancelButton}
              >
                Keep Recording
              </Button>
              <Button
                variant="primary"
                size="md"
                onPress={handleConfirm}
                style={styles.confirmButton}
              >
                🔄 Retake
              </Button>
            </View>
          </Card>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalContainer: {
    padding: spacing.lg,
    paddingBottom: spacing['3xl'],
  },
  modal: {
    padding: spacing.xl,
  },
  header: {
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  emoji: {
    fontSize: 48,
    marginBottom: spacing.sm,
  },
  title: {
    fontSize: typography.fontSize.xl,
    fontWeight: '700',
    color: colors.text.DEFAULT,
  },
  beatType: {
    fontSize: typography.fontSize.sm,
    color: colors.text.muted,
    marginTop: spacing.xs,
  },
  textPreview: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  textPreviewLabel: {
    fontSize: typography.fontSize.xs,
    fontWeight: '600',
    color: colors.text.muted,
    marginBottom: spacing.xs,
  },
  textPreviewContent: {
    fontSize: typography.fontSize.sm,
    color: colors.text.DEFAULT,
    lineHeight: 20,
  },
  playbackSection: {
    marginBottom: spacing.lg,
  },
  playbackLabel: {
    fontSize: typography.fontSize.sm,
    fontWeight: '600',
    color: colors.text.DEFAULT,
    marginBottom: spacing.sm,
  },
  playbackControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  playButton: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.sm,
  },
  playButtonText: {
    fontSize: 20,
  },
  playbackProgress: {
    flex: 1,
  },
  durationText: {
    fontSize: typography.fontSize.sm,
    fontWeight: '600',
    color: colors.text.muted,
    minWidth: 40,
    textAlign: 'right',
  },
  warning: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.pastel.yellow,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
    gap: spacing.sm,
  },
  warningIcon: {
    fontSize: 16,
  },
  warningText: {
    flex: 1,
    fontSize: typography.fontSize.sm,
    color: colors.text.DEFAULT,
    lineHeight: 20,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  cancelButton: {
    flex: 1,
  },
  confirmButton: {
    flex: 1,
  },
});

export default RetakeModal;
