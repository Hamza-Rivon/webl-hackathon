import { useEffect, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useLocalSearchParams, usePathname, useRouter } from 'expo-router';
import { Button, Card, Progress, Screen, StickyActionBar, ConnectionBadge, Skeleton } from '@/components/ui';
import { useToast } from '@/components/ui/Toast';
import { useEpisode, useStartProcessing } from '@/hooks/useEpisodes';
import { useJobs } from '@/hooks/useJobProgress';
import { useNavigation } from '@/hooks/useNavigation';
import { useSlotClips } from '@/hooks/useSlotClips';
import { useSlotUploadBlocking } from '@/hooks/useSlotUploadBlocking';
import { useUnifiedRealtimeUpdates } from '@/hooks/useUnifiedRealtimeUpdates';
import { canStartProcessing, SLOT_COLLECTION_STATUSES, STATUS_LABELS, type EpisodeStatus } from '@/lib/pipeline';
import { checkNavigationGuard } from '@/lib/navigation/navigationGuards';
import { SlotSource, SlotType } from '@/lib/api';
import { colors, spacing, typography } from '@/lib/theme';
import { trackPrimaryAction, trackScreenView } from '@/lib/analytics';
import { confirmAction } from '@/lib/confirm';
import { isARollFirstTemplateWithFallback } from '@/lib/templateWorkflow';

interface SlotViewModel {
  slotId: string;
  slotType: SlotType;
  priority: 'required' | 'optional';
  description: string;
  allowedSources: SlotSource[];
  durationMin: number;
  durationTarget: number;
  durationMax: number;
  totalDuration: number;
  clipCount: number;
  isComplete: boolean;
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

function formatDuration(seconds: number) {
  if (!seconds) return '0s';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  return `${(seconds / 60).toFixed(1)}m`;
}

export default function EpisodeSlotsScreen() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const isFocused = Boolean(id) && pathname === `/episode/${id}/slots`;
  const { showToast } = useToast();
  const navigation = useNavigation(id);

  const realtime = useUnifiedRealtimeUpdates({ episodeId: id, enabled: Boolean(id && isFocused) });

  const { data: episode, isLoading: episodeLoading, refetch: refetchEpisode } = useEpisode(id);
  const { data: slotData, isLoading: slotLoading, refetch: refetchSlots } = useSlotClips(id);
  const { data: jobs } = useJobs({ episodeId: id }, { enabled: Boolean(id && isFocused) });
  const startProcessing = useStartProcessing();
  const blocking = useSlotUploadBlocking(id);

  useEffect(() => {
    trackScreenView('episode_slots', { episodeId: id });
  }, [id]);

  const status = episode?.status ?? 'draft';
  const statusLabel = STATUS_LABELS[status as keyof typeof STATUS_LABELS] ?? status;
  const activeJobs = jobs?.filter((job) => job.status === 'pending' || job.status === 'processing') ?? [];
  const canOpenSlotActions = SLOT_COLLECTION_STATUSES.includes(status as EpisodeStatus);

  useEffect(() => {
    if (!isFocused || !episode || episodeLoading || jobs === undefined) return;

    const guardResult = checkNavigationGuard(`/(main)/episode/${id}/slots`, id, episode.status, {
      hasActiveJobs: activeJobs.length > 0,
    });
    if (!guardResult.canAccess && guardResult.redirectTarget) {
      router.replace(`/(main)/${guardResult.redirectTarget}` as any);
    }
  }, [isFocused, episode, episodeLoading, id, router, activeJobs.length, jobs]);

  const slots = useMemo<SlotViewModel[]>(() => {
    const requirements = episode?.template?.slotRequirements?.slots;
    if (!requirements?.length) return [];

    const clipList = slotData?.slotClips || [];

    const all = requirements
      .map((slot) => {
        const clips = clipList.filter((clip) => clip.slotId === slot.slotId);
        const totalDuration = clips.reduce((sum, clip) => sum + (clip.duration || 0), 0);

        return {
          slotId: slot.slotId,
          slotType: slot.slotType as SlotType,
          priority: slot.priority,
          description: slot.description,
          allowedSources: slot.allowedSources,
          durationMin: slot.duration.min,
          durationTarget: slot.duration.target,
          durationMax: slot.duration.max,
          totalDuration,
          clipCount: clips.length,
          isComplete: totalDuration >= slot.duration.min,
        };
      })
      .sort((a, b) => {
        if (a.priority === b.priority) return a.slotId.localeCompare(b.slotId);
        return a.priority === 'required' ? -1 : 1;
      });

    // Limit b_roll_illustration slots to max 2 to reduce UI noise
    let brollIllustrationCount = 0;
    return all.filter((slot) => {
      if (slot.slotType === 'b_roll_illustration') {
        brollIllustrationCount++;
        return brollIllustrationCount <= 2;
      }
      return true;
    });
  }, [episode?.template?.slotRequirements?.slots, slotData?.slotClips]);

  const progress = useMemo(() => {
    const required = slots.filter((slot) => slot.priority === 'required');
    const optional = slots.filter((slot) => slot.priority === 'optional');
    const requiredComplete = required.filter((slot) => slot.isComplete).length;
    const optionalComplete = optional.filter((slot) => slot.isComplete).length;

    return {
      requiredTotal: required.length,
      requiredComplete,
      optionalTotal: optional.length,
      optionalComplete,
      percent: required.length > 0 ? (requiredComplete / required.length) * 100 : 0,
      allRequiredComplete: required.length > 0 && requiredComplete === required.length,
    };
  }, [slots]);

  const processGuard = canStartProcessing(status, progress.allRequiredComplete, activeJobs.length > 0);
  const actionsDisabledReason = blocking.isBlocked
    ? blocking.blockingMessage || 'Uploads are currently blocked.'
    : !canOpenSlotActions
      ? 'Slot editing is available only before processing starts.'
      : null;
  const isARollFirstWorkflow = useMemo(() => {
    return isARollFirstTemplateWithFallback(
      episode?.template?.slotRequirements,
      episode?.template?.name
    );
  }, [episode?.template?.slotRequirements, episode?.template?.name]);
  const isFacecamLocked = useMemo(() => {
    if (!isARollFirstWorkflow) return false;
    const hasFacecamClip = (slotData?.slotClips ?? []).some((clip) => clip.slotType === 'a_roll_face');
    const hasCleanedARollOutput = Boolean(
      episode?.arollCleanPreviewS3Key ||
      episode?.arollCleanPreviewPlaybackId ||
      episode?.cleanVoiceoverS3Key ||
      episode?.cleanVoiceoverPlaybackId
    );
    return hasFacecamClip || hasCleanedARollOutput;
  }, [
    isARollFirstWorkflow,
    slotData?.slotClips,
    episode?.arollCleanPreviewPlaybackId,
    episode?.arollCleanPreviewS3Key,
    episode?.cleanVoiceoverPlaybackId,
    episode?.cleanVoiceoverS3Key,
  ]);

  const getSlotActionBlockedReason = (slot: SlotViewModel, action: 'record' | 'upload'): string | null => {
    if (actionsDisabledReason) return actionsDisabledReason;
    if (action === 'record' && !slot.allowedSources.includes('recorded')) {
      return 'Recording is not available for this slot.';
    }
    if (action === 'upload' && !slot.allowedSources.includes('uploaded')) {
      return 'Upload is not available for this slot.';
    }
    if (action === 'record' && slot.slotType === 'a_roll_face' && isFacecamLocked) {
      return 'Facecam A-roll is already finalized for this episode. Continue with B-roll only.';
    }
    return null;
  };

  const refreshAll = async () => {
    trackPrimaryAction('slots_refresh', { episodeId: id });
    await Promise.all([refetchEpisode(), refetchSlots()]);
  };

  const openSlotRoute = async (slot: SlotViewModel, action: 'record' | 'upload') => {
    const blockedReason = getSlotActionBlockedReason(slot, action);
    if (blockedReason) {
      showToast({
        type: 'warning',
        title: 'Action unavailable',
        message: blockedReason,
      });
      return;
    }

    trackPrimaryAction('slots_open_slot_action', {
      episodeId: id,
      slotId: slot.slotId,
      action,
    });

    const route = `/(main)/episode/${id}/slots/${slot.slotId}/${action}`;
    await navigation.navigate(route);
  };

  const onStartProcessing = async () => {
    if (!processGuard.allowed || startProcessing.isPending) {
      if (processGuard.disabledReason) {
        showToast({
          type: 'info',
          title: 'Not ready yet',
          message: processGuard.disabledReason,
        });
      }
      return;
    }
    const confirmed = await confirmAction(
      'Start processing?',
      'This launches matching/planning/render pipeline jobs and AI calls.',
      'Start'
    );
    if (!confirmed) return;

    trackPrimaryAction('slots_start_processing', { episodeId: id });

    await startProcessing.mutateAsync(id);
    showToast({
      type: 'success',
      title: 'Processing started',
      message: 'Pipeline jobs are now running.',
    });
    await navigation.navigateToProcessing();
  };

  if (episodeLoading || slotLoading) {
    return (
      <Screen contentContainerStyle={styles.content}>
        <Card>
          <Skeleton height={18} width="40%" radius="sm" />
          <Skeleton height={120} radius="lg" />
          <Skeleton height={120} radius="lg" />
        </Card>
      </Screen>
    );
  }

  const listHeader = (
    <View style={styles.headerStack}>
      <View style={styles.header}>
        <Text style={styles.title}>Slot Collection</Text>
        <Text style={styles.subtitle}>Complete required coverage before launching processing.</Text>
        <View style={styles.badgeRow}>
          <Text style={styles.badge}>{statusLabel}</Text>
          <ConnectionBadge connected={realtime.isConnected} />
        </View>
      </View>

      <Card>
        <Text style={styles.sectionTitle}>Coverage Progress</Text>
        <Progress value={progress.percent} showLabel label="Required slots" />
        <View style={styles.statRow}>
          <Text style={styles.statText}>{progress.requiredComplete}/{progress.requiredTotal} required complete</Text>
          <Text style={styles.statText}>{progress.optionalComplete}/{progress.optionalTotal} optional complete</Text>
        </View>
        {activeJobs.length > 0 ? (
          <Text style={styles.liveText}>{activeJobs.length} active pipeline job(s)</Text>
        ) : null}
        {blocking.isBlocked ? (
          <View style={styles.blockingInfoWrap}>
            <Text style={styles.warningText}>{blocking.blockingMessage}</Text>
            <Text style={styles.blockingMetaText}>
              {blocking.blockingProgress > 0 ? `Progress ${blocking.blockingProgress}%` : 'Preparing jobs'}
              {blocking.estimatedTimeRemaining ? ` • ~${blocking.estimatedTimeRemaining}s remaining` : ''}
            </Text>
          </View>
        ) : null}
      </Card>

      {slots.length === 0 ? (
        <Card>
          <Text style={styles.sectionTitle}>No slot plan yet</Text>
          <Text style={styles.muted}>This episode has no template slot requirements attached.</Text>
          <View style={styles.stackTop}>
            <Button variant="outline" onPress={() => void refreshAll()}>
              Refresh
            </Button>
            <Button onPress={() => navigation.navigateToEpisode({ replace: true })}>Back to Episode</Button>
          </View>
        </Card>
      ) : null}
    </View>
  );

  return (
    <View style={styles.root}>
      <Screen scroll={false} topInset={false}>
        {slots.length === 0 ? (
          <View style={styles.content}>{listHeader}</View>
        ) : (
          <FlashList
            data={slots}
            keyExtractor={(item) => item.slotId}
            ListHeaderComponent={listHeader}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
            renderItem={({ item: slot }) => {
              const slotProgress = Math.min((slot.totalDuration / Math.max(slot.durationMin, 1)) * 100, 100);
              const recordBlockedReason = getSlotActionBlockedReason(slot, 'record');
              const uploadBlockedReason = getSlotActionBlockedReason(slot, 'upload');

              return (
                <Card variant={slot.priority === 'required' ? 'default' : 'pastelBlue'}>
                  <View style={styles.slotHeader}>
                    <View style={styles.slotTitleWrap}>
                      <Text style={styles.slotTitle}>{SLOT_LABELS[slot.slotType]}</Text>
                      <Text style={styles.slotId}>{slot.slotId}</Text>
                    </View>
                    <Text style={slot.priority === 'required' ? styles.requiredPill : styles.optionalPill}>
                      {slot.priority}
                    </Text>
                  </View>

                  <Text style={styles.slotDescription}>{slot.description}</Text>

                  <View style={styles.slotMetrics}>
                    <Text style={styles.metricText}>Target {formatDuration(slot.durationTarget)}</Text>
                    <Text style={styles.metricText}>Min {formatDuration(slot.durationMin)}</Text>
                    <Text style={styles.metricText}>{slot.clipCount} clip(s)</Text>
                  </View>

                  <Progress value={slotProgress} size="sm" />

                  <View style={styles.actionRow}>
                    {/* Record button: only for A-roll and non-B-roll types (B-roll uses upload only) */}
                    {!slot.slotType.startsWith('b_roll_') ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onPress={() => void openSlotRoute(slot, 'record')}
                        disabled={!!recordBlockedReason}
                        style={styles.rowButton}
                      >
                        Record
                      </Button>
                    ) : null}
                    {/* Upload button: available for all non-A-roll-face slots */}
                    {slot.slotType !== 'a_roll_face' ? (
                      <Button
                        variant={slot.slotType.startsWith('b_roll_') ? 'outline' : 'outline'}
                        size="sm"
                        onPress={() => void openSlotRoute(slot, 'upload')}
                        disabled={!!uploadBlockedReason}
                        style={styles.rowButton}
                      >
                        Upload
                      </Button>
                    ) : null}
                  </View>
                  {slot.slotType === 'a_roll_face' && isFacecamLocked ? (
                    <Text style={styles.lockedHint}>
                      A-roll is already finalized. Keep adding B-roll clips only.
                    </Text>
                  ) : null}
                </Card>
              );
            }}
          />
        )}

        {!processGuard.allowed && processGuard.disabledReason ? (
          <Text style={styles.warningText}>{processGuard.disabledReason}</Text>
        ) : null}
      </Screen>

      <StickyActionBar>
        <Button
          variant="outline"
          onPress={() => navigation.navigate(`/(main)/episode/${id}/upload`)}
          disabled={!!actionsDisabledReason}
        >
          Bulk Import
        </Button>
        <Button onPress={() => void onStartProcessing()} disabled={!processGuard.allowed || startProcessing.isPending}>
          {startProcessing.isPending ? 'Starting...' : 'Start Processing'}
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
  headerStack: {
    gap: spacing.md,
    marginBottom: spacing.md,
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
  badgeRow: {
    marginTop: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.primary.DEFAULT,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.bold,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  sectionTitle: {
    color: colors.text.DEFAULT,
    fontFamily: typography.fontFamily.heading,
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold,
    marginBottom: spacing.sm,
  },
  statRow: {
    marginTop: spacing.sm,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  statText: {
    color: colors.text.muted,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  liveText: {
    marginTop: spacing.sm,
    color: colors.text.light,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
  },
  muted: {
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
  blockingInfoWrap: {
    marginTop: spacing.sm,
    gap: spacing.xs,
  },
  blockingMetaText: {
    color: colors.text.light,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  separator: {
    height: spacing.sm,
  },
  stackTop: {
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  slotHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  slotTitleWrap: {
    flex: 1,
    gap: 2,
  },
  slotTitle: {
    color: colors.text.DEFAULT,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold,
  },
  slotId: {
    color: colors.text.light,
    fontFamily: typography.fontFamily.mono,
    fontSize: typography.fontSize.xs,
    textTransform: 'uppercase',
  },
  requiredPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.warning,
    color: colors.warning,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  optionalPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.info,
    color: colors.info,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  slotDescription: {
    color: colors.text.muted,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
    lineHeight: 20,
    marginBottom: spacing.sm,
  },
  slotMetrics: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  metricText: {
    color: colors.text.light,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.35,
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  rowButton: {
    flex: 1,
    width: 'auto',
  },
  lockedHint: {
    marginTop: spacing.sm,
    color: colors.info,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.xs,
    lineHeight: 18,
  },
});
