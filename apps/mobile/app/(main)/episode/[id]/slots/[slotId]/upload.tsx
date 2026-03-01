import { useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, usePathname, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Card, Progress, Screen, StickyActionBar } from '@/components/ui';
import { useToast } from '@/components/ui/Toast';
import { useEpisode, episodeKeys } from '@/hooks/useEpisodes';
import { useNavigation } from '@/hooks/useNavigation';
import { useDeleteSlotClip, useSlotClips, slotClipKeys } from '@/hooks/useSlotClips';
import { useSlotUpload } from '@/hooks/useSlotUpload';
import { useSlotUploadBlocking } from '@/hooks/useSlotUploadBlocking';
import { SlotType } from '@/lib/api';
import { checkNavigationGuard } from '@/lib/navigation/navigationGuards';
import { triggerActionHaptic } from '@/lib/haptics';
import { colors, spacing, typography } from '@/lib/theme';

interface SelectedClip {
  id: string;
  uri: string;
  fileName: string;
  fileSize: number;
  durationSeconds?: number;
}

const LIMITS = {
  maxClipsPerEpisode: 30,
  maxFileSizeBytes: 500 * 1024 * 1024,
  minClipDuration: 2,
  maxClipDuration: 80,
};

const SLOT_LABELS: Record<SlotType, string> = {
  a_roll_face: 'Facecam',
  b_roll_illustration: 'Illustration B-roll',
  b_roll_action: 'Action B-roll',
  screen_record: 'Screen Recording',
  product_shot: 'Product Shot',
  pattern_interrupt: 'Pattern Interrupt',
  cta_overlay: 'CTA Overlay',
};

function formatBytes(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(seconds: number) {
  return `${Math.round(seconds)}s`;
}

export default function SlotUploadScreen() {
  const { id = '', slotId = '' } = useLocalSearchParams<{ id: string; slotId: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const isFocused = Boolean(id && slotId) && pathname === `/episode/${id}/slots/${slotId}/upload`;
  const { showToast } = useToast();
  const navigation = useNavigation(id);
  const queryClient = useQueryClient();

  const { data: episode } = useEpisode(id);
  const { data: slotData } = useSlotClips(id);
  const upload = useSlotUpload(id);
  const deleteSlotClip = useDeleteSlotClip();
  const blocking = useSlotUploadBlocking(id);

  const [selected, setSelected] = useState<SelectedClip[]>([]);
  const [isPickerOpen, setIsPickerOpen] = useState(false);

  const slot = useMemo(() => {
    return episode?.template?.slotRequirements?.slots?.find((item) => item.slotId === slotId) || null;
  }, [episode?.template?.slotRequirements?.slots, slotId]);

  const allClips = slotData?.slotClips || [];
  const existingSlotClips = allClips.filter((clip) => clip.slotId === slotId);
  const totalExistingCount = allClips.length;

  const remainingGlobalCapacity = Math.max(LIMITS.maxClipsPerEpisode - totalExistingCount, 0);

  const totalDuration = useMemo(() => {
    const existing = existingSlotClips.reduce((sum, clip) => sum + (clip.duration || 0), 0);
    const pending = selected.reduce((sum, clip) => sum + (clip.durationSeconds || 0), 0);
    return existing + pending;
  }, [existingSlotClips, selected]);

  const minRequired = slot?.duration.min || 0;
  const targetDuration = slot?.duration.target || 0;

  const latestUpload = useMemo(() => {
    const uploads = upload.getSlotUploads(slotId);
    return uploads[uploads.length - 1] || null;
  }, [slotId, upload]);

  const uploadDisabledReason =
    blocking.isBlocked
      ? blocking.blockingMessage || 'Uploads are blocked during active processing.'
      : !slot?.allowedSources.includes('uploaded')
        ? 'This slot only accepts recorded footage.'
        : null;

  useEffect(() => {
    if (!isFocused || !episode) return;

    const guardResult = checkNavigationGuard(
      `/(main)/episode/${id}/slots/${slotId}/upload`,
      id,
      episode.status
    );

    if (!guardResult.canAccess && guardResult.redirectTarget) {
      router.replace(`/(main)/${guardResult.redirectTarget}` as any);
    }
  }, [isFocused, episode, id, slotId, router]);

  const onPickVideos = async () => {
    if (!slot || isPickerOpen || uploadDisabledReason || upload.isUploading) {
      if (uploadDisabledReason) {
        showToast({ type: 'warning', title: 'Upload unavailable', message: uploadDisabledReason });
      }
      return;
    }

    if (remainingGlobalCapacity <= 0) {
      showToast({
        type: 'warning',
        title: 'Episode limit reached',
        message: `Maximum ${LIMITS.maxClipsPerEpisode} clips per episode reached.`,
      });
      return;
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (permission.status !== 'granted') {
      showToast({
        type: 'warning',
        title: 'Gallery access required',
        message: 'Allow photo library permissions to import clips.',
      });
      return;
    }

    try {
      await triggerActionHaptic('selection');
      setIsPickerOpen(true);

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Videos,
        allowsMultipleSelection: true,
        selectionLimit: Math.min(remainingGlobalCapacity, 12),
        quality: 1,
        videoMaxDuration: LIMITS.maxClipDuration,
      });

      if (result.canceled || !result.assets?.length) return;

      const accepted: SelectedClip[] = [];
      let rejected = 0;

      for (const asset of result.assets) {
        const fileName = asset.fileName || `clip_${Date.now()}.mp4`;
        const info = await FileSystem.getInfoAsync(asset.uri);
        const durationSeconds = asset.duration ? asset.duration / 1000 : 0;

        if (!info.exists || (info.size || 0) > LIMITS.maxFileSizeBytes) {
          rejected += 1;
          continue;
        }

        if (durationSeconds < LIMITS.minClipDuration || durationSeconds > LIMITS.maxClipDuration) {
          rejected += 1;
          continue;
        }

        accepted.push({
          id: `${Date.now()}_${Math.random().toString(36).slice(2, 10)}_${accepted.length}`,
          uri: asset.uri,
          fileName,
          fileSize: info.size || 0,
          durationSeconds,
        });
      }

      if (accepted.length > 0) {
        setSelected((current) => [...current, ...accepted]);
      }

      if (rejected > 0) {
        showToast({
          type: 'warning',
          title: 'Some clips skipped',
          message: `${rejected} clip(s) did not meet duration or file-size constraints.`,
        });
      }
    } catch (error) {
      showToast({
        type: 'error',
        title: 'Pick failed',
        message: error instanceof Error ? error.message : 'Could not open media library.',
      });
    } finally {
      setIsPickerOpen(false);
    }
  };

  const onUploadSelected = async () => {
    if (!slot || selected.length === 0 || uploadDisabledReason || upload.isUploading) return;

    await triggerActionHaptic('selection');
    const payload = selected.map((clip) => ({
      uri: clip.uri,
      slotId,
      slotType: slot.slotType as SlotType,
      source: 'uploaded' as const,
      duration: clip.durationSeconds,
    }));

    const results = await upload.uploadMultipleClips(payload);
    const successCount = results.filter(Boolean).length;

    await Promise.all([
      queryClient.invalidateQueries({ queryKey: slotClipKeys.list(id) }),
      queryClient.invalidateQueries({ queryKey: episodeKeys.detail(id) }),
    ]);

    if (successCount === selected.length) {
      setSelected([]);
      await triggerActionHaptic('success');
      showToast({
        type: 'success',
        title: 'Upload complete',
        message: `${successCount} clip(s) uploaded for ${slot.slotId}.`,
      });
      return;
    }

    showToast({
      type: 'warning',
      title: 'Upload completed with errors',
      message: `${successCount}/${selected.length} clip(s) uploaded successfully.`,
    });
    await triggerActionHaptic('warning');
  };

  const onDeleteClip = (clipId: string) => {
    Alert.alert('Delete clip', 'Remove this uploaded clip from the slot?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await triggerActionHaptic('destructive');
            await deleteSlotClip.mutateAsync({ id: clipId, episodeId: id });
            showToast({ type: 'success', title: 'Deleted', message: 'Clip removed.' });
          } catch (error) {
            showToast({
              type: 'error',
              title: 'Delete failed',
              message: error instanceof Error ? error.message : 'Could not delete this clip.',
            });
          }
        },
      },
    ]);
  };

  if (!slot) {
    return (
      <Screen contentContainerStyle={styles.content}>
        <Text style={styles.title}>Slot not found</Text>
        <Text style={styles.muted}>The template no longer contains this slot.</Text>
      </Screen>
    );
  }

  return (
    <View style={styles.root}>
      <Screen contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>{SLOT_LABELS[slot.slotType as SlotType]} Upload</Text>
          <Text style={styles.subtitle}>{slot.slotId} • min {slot.duration.min}s • target {slot.duration.target}s</Text>
        </View>

        {uploadDisabledReason ? (
          <Card variant="pastelOrange">
            <Text style={styles.warningText}>{uploadDisabledReason}</Text>
          </Card>
        ) : null}

        <Card>
          <Text style={styles.sectionTitle}>Coverage</Text>
          <Progress
            value={Math.min((totalDuration / Math.max(minRequired, 1)) * 100, 100)}
            showLabel
            label={`Current ${formatDuration(totalDuration)} • target ${formatDuration(targetDuration)}`}
          />
          <Text style={styles.muted}>Global capacity left: {remainingGlobalCapacity} clips</Text>
        </Card>

        <Card>
          <Text style={styles.sectionTitle}>Pending Selection</Text>
          {selected.length === 0 ? (
            <Text style={styles.muted}>No pending clips.</Text>
          ) : (
            <View style={styles.stack}>
              {selected.map((clip) => (
                <View key={clip.id} style={styles.listRow}>
                  <View style={styles.metaWrap}>
                    <Text style={styles.itemTitle} numberOfLines={1}>
                      {clip.fileName}
                    </Text>
                    <Text style={styles.itemMeta}>
                      {formatBytes(clip.fileSize)} • {formatDuration(clip.durationSeconds || 0)}
                    </Text>
                  </View>
                  <Button
                    variant="ghost"
                    size="sm"
                    onPress={() => setSelected((current) => current.filter((item) => item.id !== clip.id))}
                    style={styles.removeButton}
                  >
                    Remove
                  </Button>
                </View>
              ))}
            </View>
          )}

          <View style={styles.stackTop}>
            <Button variant="outline" onPress={onPickVideos} disabled={!!uploadDisabledReason || upload.isUploading}>
              Pick Videos
            </Button>
            <Button onPress={onUploadSelected} disabled={selected.length === 0 || !!uploadDisabledReason || upload.isUploading}>
              {upload.isUploading ? 'Uploading...' : `Upload ${selected.length || ''}`.trim()}
            </Button>
          </View>
        </Card>

        <Card>
          <Text style={styles.sectionTitle}>Uploaded Clips</Text>
          {existingSlotClips.length === 0 ? (
            <Text style={styles.muted}>No clips uploaded for this slot yet.</Text>
          ) : (
            <View style={styles.stack}>
              {existingSlotClips.map((clip) => (
                <View key={clip.id} style={styles.listRow}>
                  <View style={styles.metaWrap}>
                    <Text style={styles.itemTitle}>{clip.s3Key.split('/').pop() || clip.id}</Text>
                    <Text style={styles.itemMeta}>{clip.duration ? formatDuration(clip.duration) : '--'} • {clip.source}</Text>
                  </View>
                  <Button variant="ghost" size="sm" onPress={() => onDeleteClip(clip.id)} style={styles.removeButton}>
                    Delete
                  </Button>
                </View>
              ))}
            </View>
          )}
        </Card>

        {latestUpload ? (
          <Card>
            <Text style={styles.sectionTitle}>Latest Transfer</Text>
            <Progress value={latestUpload.progress} showLabel label={latestUpload.status} />
          </Card>
        ) : null}
      </Screen>

      <StickyActionBar>
        <Button variant="ghost" onPress={() => navigation.navigateBack()}>
          Back
        </Button>
        <Button onPress={() => navigation.navigate(`/(main)/episode/${id}/slots`, { replace: true })}>
          Slot Board
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
  muted: {
    marginTop: spacing.sm,
    color: colors.text.light,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
  },
  warningText: {
    color: colors.warning,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
    lineHeight: 20,
  },
  stack: {
    gap: spacing.sm,
  },
  stackTop: {
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  metaWrap: {
    flex: 1,
  },
  itemTitle: {
    color: colors.text.DEFAULT,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
  },
  itemMeta: {
    marginTop: 2,
    color: colors.text.light,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.xs,
  },
  removeButton: {
    width: 'auto',
    minWidth: 82,
  },
});
