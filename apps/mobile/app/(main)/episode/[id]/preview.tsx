import { useEffect, useMemo, useState } from 'react';
import { Share, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, usePathname, useRouter } from 'expo-router';
import { Ionicons } from '@/components/ui/SymbolIcon';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { Button, Card, EmptyState, Screen, StickyActionBar, ConnectionBadge } from '@/components/ui';
import { useToast } from '@/components/ui/Toast';
import { PhaseIndicator, getPhaseFromStatus } from '@/components/episode/PhaseIndicator';
import { useEpisode, useEpisodeDownloadUrl } from '@/hooks/useEpisodes';
import { useUnifiedRealtimeUpdates } from '@/hooks/useUnifiedRealtimeUpdates';
import { VideoPlayer } from '@/components/media/VideoPlayer';
import { canViewFinal, getPhaseResultRoute, type PipelinePhase, STATUS_LABELS } from '@/lib/pipeline';
import { checkNavigationGuard } from '@/lib/navigation/navigationGuards';
import { colors, spacing, typography, borderRadius } from '@/lib/theme';
import { trackPrimaryAction, trackScreenView, trackFailure } from '@/lib/analytics';

function getPlaybackUrl(playbackId?: string | null, explicit?: string | null): string | null {
  if (explicit) return explicit;
  if (!playbackId) return null;
  return `https://stream.mux.com/${playbackId}.m3u8`;
}

// Download exclusively from S3 — Mux static renditions are unreliable for direct download.

function buildDownloadFilename(title: string | undefined, fallbackId: string): string {
  const raw = (title || `webl_${fallbackId}`)
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `${raw || `webl_${fallbackId}`}.mp4`;
}

function sanitizeDownloadFilename(filename: string): string {
  const ext = '.mp4';
  const base = filename
    .replace(/\.mp4$/i, '')
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `${base || 'webl_video'}${ext}`;
}

async function downloadFromCandidates(urls: string[], fileUri: string): Promise<{ uri: string; sourceUrl: string }> {
  let lastError: unknown = null;

  for (let index = 0; index < urls.length; index += 1) {
    const sourceUrl = urls[index];
    const candidateUri = fileUri.replace(/\.mp4$/i, `_${index}.mp4`);

    try {
      console.log(`[Download] Trying candidate ${index + 1}/${urls.length}: ${sourceUrl.substring(0, 80)}...`);
      const result = await FileSystem.downloadAsync(sourceUrl, candidateUri);

      if (result.status >= 200 && result.status < 300) {
        // Verify the file actually exists and has content
        const fileInfo = await FileSystem.getInfoAsync(candidateUri);
        if (fileInfo.exists && (fileInfo.size || 0) > 1000) {
          console.log(`[Download] Success from candidate ${index + 1}, size: ${fileInfo.size} bytes`);
          return { uri: result.uri, sourceUrl };
        }
        console.warn(`[Download] Candidate ${index + 1} returned ${result.status} but file is empty/tiny`);
        const fileSize = fileInfo.exists ? (fileInfo.size || 0) : 0;
        lastError = new Error(`Downloaded file is empty or too small (${fileSize} bytes)`);
      } else {
        console.warn(`[Download] Candidate ${index + 1} failed with status ${result.status}`);
        lastError = new Error(`Download failed with status ${result.status}`);
      }
    } catch (error) {
      console.warn(`[Download] Candidate ${index + 1} error:`, error instanceof Error ? error.message : error);
      lastError = error;
    }

    try {
      await FileSystem.deleteAsync(candidateUri, { idempotent: true });
    } catch {
      // Ignore cleanup failures.
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error('No downloadable source was available.');
}

function WaitingPulse() {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withRepeat(withTiming(1, { duration: 1000 }), -1, true);
  }, [progress]);

  const barA = useAnimatedStyle(() => ({
    opacity: 0.25 + progress.value * 0.65,
    transform: [{ scaleY: 0.7 + progress.value * 0.35 }],
  }));

  const barB = useAnimatedStyle(() => ({
    opacity: 0.3 + (1 - progress.value) * 0.6,
    transform: [{ scaleY: 0.8 + (1 - progress.value) * 0.3 }],
  }));

  const barC = useAnimatedStyle(() => ({
    opacity: 0.35 + progress.value * 0.5,
    transform: [{ scaleY: 0.75 + progress.value * 0.25 }],
  }));

  return (
    <View style={styles.waitingWrap}>
      <Animated.View style={[styles.waitingBar, barA]} />
      <Animated.View style={[styles.waitingBar, barB]} />
      <Animated.View style={[styles.waitingBar, barC]} />
    </View>
  );
}

export default function EpisodePreviewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const isFocused = Boolean(id) && pathname === `/episode/${id}/preview`;
  const { showToast } = useToast();

  const episodeQuery = useEpisode(id);
  const downloadUrl = useEpisodeDownloadUrl();
  const realtime = useUnifiedRealtimeUpdates({ episodeId: id || '', enabled: Boolean(id && isFocused) });

  const episode = episodeQuery.data;

  useEffect(() => {
    trackScreenView('episode_preview', { episodeId: id });
  }, [id]);

  const playbackId = useMemo(() => episode?.muxFinalPlaybackId || null, [episode?.muxFinalPlaybackId]);
  const shareUrl = useMemo(
    () => getPlaybackUrl(playbackId, episode?.muxPlaybackUrl || null),
    [episode?.muxPlaybackUrl, playbackId]
  );

  const canView = canViewFinal(episode?.status || 'draft', Boolean(playbackId));

  const [saveState, setSaveState] = useState<'idle' | 'downloading' | 'saving'>('idle');

  useEffect(() => {
    if (!isFocused || !episode) return;

    const guardResult = checkNavigationGuard(`/(main)/episode/${id}/preview`, id || '', episode.status, {
      hasPlayback: Boolean(playbackId),
    });
    if (!guardResult.canAccess && guardResult.redirectTarget) {
      router.replace(`/(main)/${guardResult.redirectTarget}` as any);
    }
  }, [isFocused, episode, id, router, playbackId]);

  const handleShare = async () => {
    if (!shareUrl) {
      showToast({
        type: 'info',
        title: 'Export unavailable',
        message: 'Playback URL is not available yet.',
      });
      return;
    }

    trackPrimaryAction('preview_share', { episodeId: id, via: 'share_sheet' });

    try {
      await Share.share({
        title: episode?.title || 'WEBL Video',
        message: `${episode?.title || 'Watch this video'}\n${shareUrl}`,
        url: shareUrl,
      });
    } catch (error) {
      trackFailure('preview_share', {
        episodeId: id,
        reason: error instanceof Error ? error.message : 'share_failed',
      });
      showToast({
        type: 'error',
        title: 'Share failed',
        message: error instanceof Error ? error.message : 'Could not open share sheet.',
      });
    }
  };

  const handleDownloadVideo = async () => {
    if (!id) return;

    trackPrimaryAction('preview_download_video', { episodeId: id });

    try {
      setSaveState('downloading');

      // Step 1: Request media library permission FIRST (before downloading)
      const permission = await MediaLibrary.requestPermissionsAsync();
      if (!permission.granted) {
        throw new Error('Media library permission is required to save video.');
      }

      const baseDir = FileSystem.cacheDirectory || FileSystem.documentDirectory;
      if (!baseDir) {
        throw new Error('No writable storage directory is available on this device.');
      }

      const fallbackFilename = buildDownloadFilename(episode?.title, id);

      // Step 2: Get S3 download URL from API (the only reliable source)
      console.log('[Download] Fetching S3 download URL from API...');
      const response = await downloadUrl.mutateAsync(id);
      const primaryUrl = response.url;
      const filename = sanitizeDownloadFilename(response.filename || fallbackFilename);

      if (!primaryUrl) {
        throw new Error('Video file is not available for download yet. The render may still be processing.');
      }

      console.log('[Download] Got S3 URL, downloading...');
      const candidateUrls = [primaryUrl];

      // Step 3: Download the file
      const fileUri = `${baseDir}${Date.now()}_${filename}`;
      const downloadResult = await downloadFromCandidates(candidateUrls, fileUri);
      console.log('[Download] Downloaded from:', downloadResult.sourceUrl.substring(0, 80));

      // Step 4: Save to media library
      setSaveState('saving');
      await MediaLibrary.saveToLibraryAsync(downloadResult.uri);

      // Clean up temp file
      try {
        await FileSystem.deleteAsync(downloadResult.uri, { idempotent: true });
      } catch {
        // Ignore cleanup failures
      }

      showToast({
        type: 'success',
        title: 'Downloaded',
        message: 'Video saved to your device library.',
      });
    } catch (error) {
      console.error('[Download] Failed:', error instanceof Error ? error.message : error);
      trackFailure('preview_download_video', {
        episodeId: id,
        reason: error instanceof Error ? error.message : 'save_failed',
      });
      showToast({
        type: 'error',
        title: 'Download failed',
        message: error instanceof Error ? error.message : 'Could not download this video.',
      });
    } finally {
      setSaveState('idle');
    }
  };

  if (episodeQuery.isLoading) {
    return (
      <Screen contentContainerStyle={styles.content} topInset={false}>
        <Card>
          <WaitingPulse />
          <Text style={styles.waitingText}>Loading preview...</Text>
        </Card>
      </Screen>
    );
  }

  if (!episode) {
    return (
      <Screen contentContainerStyle={styles.content} topInset={false}>
        <EmptyState
          title="Episode not found"
          description="Unable to load preview."
          icon={<Ionicons name="film-outline" size={44} color={colors.primary.DEFAULT} />}
        />
      </Screen>
    );
  }

  const currentPhase = getPhaseFromStatus(episode.status);
  const handlePhasePress = (phase: number) => {
    if (!id) return;
    const route = getPhaseResultRoute({
      episodeId: id,
      phase: phase as PipelinePhase,
      hasPlayback: Boolean(playbackId),
    });
    router.push(route as never);
  };

  return (
    <View style={styles.root}>
      <Screen contentContainerStyle={styles.content} topInset={false}>
        <Card variant="elevated">
          <View style={styles.headerRow}>
            <View style={styles.headerTextWrap}>
              <Text style={styles.title}>Final Preview</Text>
              <Text style={styles.metaText}>{STATUS_LABELS[episode.status as keyof typeof STATUS_LABELS] || episode.status}</Text>
              <Text style={styles.episodeTitle}>{episode.title}</Text>
            </View>
            <ConnectionBadge connected={realtime.isConnected} />
          </View>

          {saveState !== 'idle' ? (
            <Text style={styles.exportStateText}>
              {saveState === 'downloading' ? 'Downloading video...' : 'Saving to device...'}
            </Text>
          ) : null}
        </Card>

        <Card>
          <PhaseIndicator currentPhase={currentPhase} compact={false} onPhasePress={handlePhasePress} />
        </Card>

        {canView.allowed && playbackId ? (
          <Card>
            <VideoPlayer
              muxPlaybackId={playbackId}
              showControls
              enablePlaybackSpeed
              enableFullscreen
              contentFit="contain"
              aspectRatio={9 / 16}
            />
          </Card>
        ) : (
          <Card>
            <WaitingPulse />
            <EmptyState
              title="Final video is not ready"
              description={canView.disabledReason || 'Pipeline is still running.'}
              icon={<Ionicons name="pulse-outline" size={44} color={colors.warning} />}
            />
          </Card>
        )}
      </Screen>

      <StickyActionBar>
        <Button variant="outline" onPress={() => router.push(`/(main)/episode/${id}/processing`)}>
          Processing
        </Button>
        <Button variant="outline" onPress={handleShare} disabled={!canView.allowed || !shareUrl}>
          Share
        </Button>
        <Button onPress={() => void handleDownloadVideo()} disabled={saveState !== 'idle' || downloadUrl.isPending}>
          Download Video
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
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  headerTextWrap: {
    flex: 1,
  },
  title: {
    color: colors.text.DEFAULT,
    fontFamily: typography.fontFamily.heading,
    fontSize: typography.fontSize.xl,
    fontWeight: typography.fontWeight.bold,
  },
  episodeTitle: {
    marginTop: spacing.sm,
    color: colors.text.DEFAULT,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
  },
  metaText: {
    color: colors.text.light,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
    textTransform: 'capitalize',
  },
  exportStateText: {
    marginTop: spacing.sm,
    color: colors.primary.DEFAULT,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
  },
  waitingWrap: {
    height: 50,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
    marginVertical: spacing.sm,
  },
  waitingBar: {
    width: 8,
    height: 32,
    borderRadius: borderRadius.full,
    backgroundColor: colors.primary.DEFAULT,
  },
  waitingText: {
    color: colors.text.muted,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
});
