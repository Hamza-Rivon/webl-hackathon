import { useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, usePathname, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { Button, Card, Progress, Screen, StickyActionBar } from '@/components/ui';
import { useToast } from '@/components/ui/Toast';
import { useEpisode } from '@/hooks/useEpisodes';
import { useNavigation } from '@/hooks/useNavigation';
import { useApiClient } from '@/lib/api';
import { STATUS_LABELS } from '@/lib/pipeline';
import { colors, spacing, typography } from '@/lib/theme';

interface ClipSelection {
  id: string;
  uri: string;
  fileName: string;
  fileSize: number;
  durationSeconds?: number;
}

interface ClipUploadState {
  id: string;
  fileName: string;
  progress: number;
  status: 'pending' | 'uploading' | 'processing' | 'done' | 'error';
  error?: string;
}

const ALLOWED_UPLOAD_STATUSES = ['voiceover_cleaned', 'collecting_clips', 'needs_more_clips'];
const MAX_FILE_SIZE_BYTES = 500 * 1024 * 1024;

function formatBytes(bytes: number) {
  if (bytes <= 0) return '0 MB';
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(seconds?: number) {
  if (!seconds) return '--';
  return `${Math.round(seconds)}s`;
}

function sanitizeFilename(fileName: string) {
  const extension = fileName.split('.').pop()?.toLowerCase() || 'mp4';
  const safeBase = fileName
    .replace(/\.[^/.]+$/, '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 64);
  const safeExt = ['mp4', 'mov'].includes(extension) ? extension : 'mp4';
  return `${safeBase || 'clip'}.${safeExt}`;
}

export default function EpisodeUploadScreen() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const isFocused = Boolean(id) && pathname === `/episode/${id}/upload`;
  const apiClient = useApiClient();
  const navigation = useNavigation(id);
  const { showToast } = useToast();

  const { data: episode, refetch } = useEpisode(id);

  const [clips, setClips] = useState<ClipSelection[]>([]);
  const [uploads, setUploads] = useState<ClipUploadState[]>([]);
  const [isPicking, setIsPicking] = useState(false);
  const [isUploadingAll, setIsUploadingAll] = useState(false);

  const status = episode?.status ?? 'draft';
  const statusLabel = STATUS_LABELS[status as keyof typeof STATUS_LABELS] ?? status;
  const canUpload = ALLOWED_UPLOAD_STATUSES.includes(status);

  useEffect(() => {
    if (!isFocused || !episode) return;
    if (!canUpload) {
      router.replace(`/(main)/episode/${id}` as any);
    }
  }, [isFocused, canUpload, episode, id, router]);

  const averageProgress = useMemo(() => {
    if (uploads.length === 0) return 0;
    const total = uploads.reduce((sum, item) => sum + item.progress, 0);
    return total / uploads.length;
  }, [uploads]);

  const pendingCount = uploads.filter((item) => item.status === 'pending').length;
  const failedCount = uploads.filter((item) => item.status === 'error').length;
  const doneCount = uploads.filter((item) => item.status === 'done').length;

  const requestGalleryPermission = async () => {
    const result = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (result.status !== 'granted') {
      showToast({
        type: 'warning',
        title: 'Gallery access required',
        message: 'Allow photo library access to import video clips.',
      });
      return false;
    }

    return true;
  };

  const handlePickVideos = async () => {
    if (!canUpload || isPicking || isUploadingAll) return;

    const permitted = await requestGalleryPermission();
    if (!permitted) return;

    try {
      setIsPicking(true);

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Videos,
        allowsMultipleSelection: true,
        selectionLimit: 15,
        quality: 1,
        videoMaxDuration: 180,
      });

      if (result.canceled || !result.assets?.length) return;

      const accepted: ClipSelection[] = [];
      const rejected: string[] = [];

      for (const asset of result.assets) {
        const fileName = asset.fileName || `clip_${Date.now()}.mp4`;
        const fileInfo = await FileSystem.getInfoAsync(asset.uri);

        if (!fileInfo.exists) {
          rejected.push(`${fileName} (missing file)`);
          continue;
        }

        const extension = fileName.split('.').pop()?.toLowerCase();
        if (!extension || !['mp4', 'mov'].includes(extension)) {
          rejected.push(`${fileName} (invalid format)`);
          continue;
        }

        const fileSize = fileInfo.size || 0;
        if (fileSize > MAX_FILE_SIZE_BYTES) {
          rejected.push(`${fileName} (>500MB)`);
          continue;
        }

        accepted.push({
          id: `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
          uri: asset.uri,
          fileName,
          fileSize,
          durationSeconds: asset.duration ? asset.duration / 1000 : undefined,
        });
      }

      if (accepted.length) {
        setClips((current) => [...current, ...accepted]);
      }

      if (rejected.length) {
        showToast({
          type: 'warning',
          title: 'Some clips were skipped',
          message: rejected.slice(0, 2).join(', '),
        });
      }
    } catch (error) {
      showToast({
        type: 'error',
        title: 'Could not open gallery',
        message: error instanceof Error ? error.message : 'Please try again.',
      });
    } finally {
      setIsPicking(false);
    }
  };

  const setUploadState = (clipId: string, updates: Partial<ClipUploadState>) => {
    setUploads((current) =>
      current.map((item) => (item.id === clipId ? { ...item, ...updates } : item))
    );
  };

  const uploadClip = async (clip: ClipSelection) => {
    try {
      setUploadState(clip.id, { status: 'uploading', progress: 5, error: undefined });

      const initResponse = await apiClient.post<{
        url: string;
        fields: Record<string, string>;
        key: string;
      }>('/uploads/init', {
        type: 'clip',
        episodeId: id,
        filename: sanitizeFilename(clip.fileName),
        contentType: 'video/mp4',
        fileSize: clip.fileSize,
      });

      const { url, fields, key } = initResponse.data;

      const task = FileSystem.createUploadTask(
        url,
        clip.uri,
        {
          uploadType: FileSystem.FileSystemUploadType.MULTIPART,
          fieldName: 'file',
          parameters: fields,
          headers: { 'Content-Type': 'multipart/form-data' },
        },
        (progress) => {
          const ratio = progress.totalBytesSent / Math.max(progress.totalBytesExpectedToSend, 1);
          setUploadState(clip.id, { progress: 10 + ratio * 75 });
        }
      );

      const uploadResult = await task.uploadAsync();
      if (!uploadResult || uploadResult.status >= 400) {
        throw new Error(`Upload failed with status ${uploadResult?.status || 0}`);
      }

      setUploadState(clip.id, { status: 'processing', progress: 90 });

      await apiClient.post(
        '/uploads/complete',
        {
          type: 'clip',
          episodeId: id,
          key,
        },
        { timeout: 60000 }
      );

      setUploadState(clip.id, { status: 'done', progress: 100 });
      return true;
    } catch (error) {
      setUploadState(clip.id, {
        status: 'error',
        progress: 100,
        error: error instanceof Error ? error.message : 'Upload failed',
      });
      return false;
    }
  };

  const handleUploadAll = async () => {
    if (!canUpload || clips.length === 0 || isUploadingAll) return;

    const initial: ClipUploadState[] = clips.map((clip) => ({
      id: clip.id,
      fileName: clip.fileName,
      progress: 0,
      status: 'pending',
    }));

    setUploads(initial);
    setIsUploadingAll(true);

    let successCount = 0;
    for (const clip of clips) {
      const success = await uploadClip(clip);
      if (success) successCount += 1;
    }

    await refetch();

    if (successCount === clips.length) {
      showToast({
        type: 'success',
        title: 'Upload complete',
        message: `${successCount} clip(s) are now processing.`,
      });
      setClips([]);
      return;
    }

    showToast({
      type: 'warning',
      title: 'Upload finished with issues',
      message: `${successCount}/${clips.length} clips uploaded successfully.`,
    });

    setIsUploadingAll(false);
  };

  const handleBack = async () => {
    if (isUploadingAll) {
      Alert.alert('Uploads in progress', 'Leave anyway? Incomplete uploads will fail.', [
        { text: 'Stay', style: 'cancel' },
        { text: 'Leave', style: 'destructive', onPress: () => void navigation.navigateBack() },
      ]);
      return;
    }

    await navigation.navigateBack();
  };

  const removeClip = (clipId: string) => {
    if (isUploadingAll) return;
    setClips((current) => current.filter((clip) => clip.id !== clipId));
  };

  return (
    <View style={styles.root}>
      <Screen contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>Bulk Clip Import</Text>
          <Text style={styles.subtitle}>Quickly send extra B-roll clips to your episode intake queue.</Text>
          <Text style={styles.badge}>{statusLabel}</Text>
        </View>

        {!canUpload ? (
          <Card variant="pastelOrange">
            <Text style={styles.warningTitle}>Upload unavailable</Text>
            <Text style={styles.warningText}>
              Clip import opens after voiceover cleanup and before processing starts.
            </Text>
          </Card>
        ) : null}

        <Card>
          <Text style={styles.sectionTitle}>Selected Clips</Text>
          {clips.length === 0 ? (
            <Text style={styles.muted}>No clips selected yet.</Text>
          ) : (
            <View style={styles.stack}>
              {clips.map((clip) => (
                <View key={clip.id} style={styles.clipRow}>
                  <View style={styles.clipMeta}>
                    <Text style={styles.clipName} numberOfLines={1}>
                      {clip.fileName}
                    </Text>
                    <Text style={styles.clipSubtext}>
                      {formatBytes(clip.fileSize)} • {formatDuration(clip.durationSeconds)}
                    </Text>
                  </View>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={isUploadingAll}
                    onPress={() => removeClip(clip.id)}
                    style={styles.removeButton}
                  >
                    Remove
                  </Button>
                </View>
              ))}
            </View>
          )}

          <View style={styles.stackTop}>
            <Button onPress={handlePickVideos} disabled={!canUpload || isPicking || isUploadingAll} variant="outline">
              {isPicking ? 'Opening Gallery...' : 'Pick Videos'}
            </Button>
            <Button onPress={handleUploadAll} disabled={!canUpload || clips.length === 0 || isUploadingAll}>
              {isUploadingAll ? 'Uploading...' : `Upload ${clips.length || ''}`.trim()}
            </Button>
          </View>
        </Card>

        {uploads.length > 0 ? (
          <Card>
            <Text style={styles.sectionTitle}>Transfer Status</Text>
            <Progress value={averageProgress} showLabel label="Overall progress" />
            <View style={styles.statsRow}>
              <Text style={styles.statText}>{doneCount} done</Text>
              <Text style={styles.statText}>{pendingCount} pending</Text>
              <Text style={[styles.statText, failedCount > 0 && styles.statError]}>{failedCount} failed</Text>
            </View>
            <View style={styles.stack}>
              {uploads.map((upload) => (
                <View key={upload.id} style={styles.uploadItem}>
                  <View style={styles.uploadHeader}>
                    <Text style={styles.clipName} numberOfLines={1}>
                      {upload.fileName}
                    </Text>
                    <Text style={styles.uploadState}>{upload.status}</Text>
                  </View>
                  <Progress value={upload.progress} size="sm" />
                  {upload.error ? <Text style={styles.errorText}>{upload.error}</Text> : null}
                </View>
              ))}
            </View>
          </Card>
        ) : null}
      </Screen>

      <StickyActionBar>
        <Button variant="ghost" onPress={handleBack}>
          Back
        </Button>
        <Button onPress={() => navigation.navigateToSlots()} disabled={isUploadingAll || !canUpload}>
          Open Slots
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
  badge: {
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
    letterSpacing: 0.4,
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
  muted: {
    color: colors.text.light,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
  },
  stack: {
    gap: spacing.sm,
  },
  stackTop: {
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  clipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  clipMeta: {
    flex: 1,
    gap: 2,
  },
  clipName: {
    color: colors.text.DEFAULT,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
  },
  clipSubtext: {
    color: colors.text.light,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.xs,
  },
  removeButton: {
    width: 'auto',
    minWidth: 82,
  },
  statsRow: {
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
    flexDirection: 'row',
    gap: spacing.md,
  },
  statText: {
    color: colors.text.muted,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  statError: {
    color: colors.error,
  },
  uploadItem: {
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: spacing.md,
    padding: spacing.sm,
  },
  uploadHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  uploadState: {
    color: colors.text.muted,
    fontFamily: typography.fontFamily.mono,
    fontSize: typography.fontSize.xs,
    textTransform: 'uppercase',
  },
  errorText: {
    color: colors.error,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.xs,
  },
});
