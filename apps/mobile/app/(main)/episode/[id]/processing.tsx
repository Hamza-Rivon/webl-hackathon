import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useLocalSearchParams, usePathname, useRouter } from 'expo-router';
import { Ionicons } from '@/components/ui/SymbolIcon';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { Button, Card, EmptyState, Screen, StickyActionBar, ConnectionBadge, Skeleton } from '@/components/ui';
import { PhaseIndicator, getPhaseFromStatus } from '@/components/episode/PhaseIndicator';
import { useEpisode, useResumeEpisode, useStartProcessing } from '@/hooks/useEpisodes';
import { useEpisodeActions } from '@/hooks/useEpisodeActions';
import { useJobs, useRetryFailedEpisodeJobs, useRetryJob } from '@/hooks/useJobProgress';
import { useUnifiedRealtimeUpdates } from '@/hooks/useUnifiedRealtimeUpdates';
import { canViewFinal, getPhaseResultRoute, type PipelinePhase, sortJobsByPipelineOrder, STAGE_LABELS, STATUS_LABELS, groupJobsByPhase } from '@/lib/pipeline';
import { checkNavigationGuard } from '@/lib/navigation/navigationGuards';
import { colors, spacing, typography, borderRadius } from '@/lib/theme';
import { formatError } from '@/lib/errorMessages';
import { trackPrimaryAction, trackScreenView } from '@/lib/analytics';
import { confirmAction } from '@/lib/confirm';

function ProcessingBars() {
  const phase = useSharedValue(0);

  useEffect(() => {
    phase.value = withRepeat(withTiming(1, { duration: 900 }), -1, true);
  }, [phase]);

  const a = useAnimatedStyle(() => ({ opacity: 0.3 + phase.value * 0.6 }));
  const b = useAnimatedStyle(() => ({ opacity: 0.4 + (1 - phase.value) * 0.5 }));
  const c = useAnimatedStyle(() => ({ opacity: 0.35 + phase.value * 0.5 }));

  return (
    <View style={styles.barsWrap}>
      <Animated.View style={[styles.bar, a]} />
      <Animated.View style={[styles.bar, b]} />
      <Animated.View style={[styles.bar, c]} />
    </View>
  );
}

export default function ProcessingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const isFocused = Boolean(id) && pathname === `/episode/${id}/processing`;

  const episodeQuery = useEpisode(id);
  const jobsQuery = useJobs({ episodeId: id }, { enabled: Boolean(id && isFocused) });
  const retryJob = useRetryJob();
  const retryFailedEpisodeJobs = useRetryFailedEpisodeJobs();
  const startProcessing = useStartProcessing();
  const resumeEpisode = useResumeEpisode();
  const episodeActions = useEpisodeActions(id || '');
  const realtime = useUnifiedRealtimeUpdates({ episodeId: id || '', enabled: Boolean(id && isFocused) });

  const [activeRetryJobId, setActiveRetryJobId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

  const episode = episodeQuery.data;
  const jobs = useMemo(() => sortJobsByPipelineOrder(jobsQuery.data || []), [jobsQuery.data]);
  const active = jobs.filter((job) => job.status === 'pending' || job.status === 'processing');
  const completed = jobs.filter((job) => job.status === 'done');
  const failed = jobs.filter((job) => job.status === 'error');

  useEffect(() => {
    trackScreenView('episode_processing', { episodeId: id });
  }, [id]);

  useEffect(() => {
    if (!isFocused || !episode || jobsQuery.isLoading) return;

    const guardResult = checkNavigationGuard(`/(main)/episode/${id}/processing`, id || '', episode.status, {
      hasActiveJobs: active.length > 0,
    });
    if (!guardResult.canAccess && guardResult.redirectTarget) {
      router.replace(`/(main)/${guardResult.redirectTarget}` as any);
    }
  }, [isFocused, episode, id, router, active.length, jobsQuery.isLoading]);

  const phaseSummaries = useMemo(
    () => groupJobsByPhase(jobs).filter((p) => p.totalJobs > 0),
    [jobs]
  );

  // For "show all" mode, show individual jobs; default mode shows phase summary only
  const visibleJobs = showHistory ? jobs : [];
  const previewGuard = canViewFinal(episode?.status || 'draft', Boolean(episode?.muxFinalPlaybackId));
  const canRequestRender = episode?.status === 'cut_plan_ready' && active.length === 0;

  const aggregateProgress = useMemo(() => {
    if (active.length === 0) return completed.length > 0 ? 100 : 0;
    const total = active.reduce((sum, job) => sum + (job.progress || 0), 0);
    return Math.round(total / active.length);
  }, [active, completed.length]);

  const retrySingleJob = async (jobId: string) => {
    setActiveRetryJobId(jobId);
    try {
      trackPrimaryAction('processing_retry_single_job', { episodeId: id, jobId });
      await retryJob.mutateAsync(jobId);
    } finally {
      setActiveRetryJobId(null);
    }
  };

  const retryFailedSet = async () => {
    if (!id) return;
    trackPrimaryAction('processing_retry_failed_set', { episodeId: id });
    await retryFailedEpisodeJobs.mutateAsync(id);
  };

  const continuePipeline = async () => {
    if (!id) return;
    trackPrimaryAction('processing_continue_pipeline', { episodeId: id });
    setActionFeedback(null);
    const result = await resumeEpisode.mutateAsync({ id, execute: true });
    if (result?.nextRoute) {
      router.push(result.nextRoute as never);
      return;
    }
    if (result?.message) {
      setActionFeedback(result.message);
    }
  };

  const requestRender = async () => {
    if (!id || !canRequestRender) return;

    const confirmed = await confirmAction(
      'Request final render?',
      'Rendering will run FFmpeg and publish steps. Continue?',
      'Render'
    );
    if (!confirmed) return;

    trackPrimaryAction('processing_request_render', { episodeId: id });
    setActionFeedback(null);
    try {
      await episodeActions.requestRender.mutateAsync();
      setActionFeedback('Render requested. Processing has resumed.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to request render.';
      setActionFeedback(message);
    }
  };

  const restartFlow = async () => {
    if (!id) return;
    if (active.length > 0) {
      return;
    }
    const confirmed = await confirmAction(
      'Restart whole episode flow?',
      'This can re-run costly pipeline jobs and API calls.',
      'Restart'
    );
    if (!confirmed) return;
    trackPrimaryAction('processing_restart_flow', { episodeId: id });
    await startProcessing.mutateAsync(id);
  };

  if (episodeQuery.isLoading || jobsQuery.isLoading) {
    return (
      <Screen contentContainerStyle={styles.content} topInset={false}>
        <Card>
          <ProcessingBars />
          <Skeleton height={18} width="60%" radius="sm" />
          <Skeleton height={80} radius="lg" />
        </Card>
      </Screen>
    );
  }

  if (!episode) {
    return (
      <Screen contentContainerStyle={styles.content} topInset={false}>
        <EmptyState title="Episode not found" description="Unable to load processing details." icon={<Ionicons name="pulse-outline" size={44} color={colors.primary.DEFAULT} />} />
      </Screen>
    );
  }

  const currentPhase = getPhaseFromStatus(episode.status);
  const handlePhasePress = (phase: number) => {
    if (!id) return;
    const route = getPhaseResultRoute({
      episodeId: id,
      phase: phase as PipelinePhase,
      hasPlayback: Boolean(episode.muxFinalPlaybackId),
    });
    router.push(route as never);
  };

  const header = (
    <View style={styles.headerStack}>
      <Card variant="elevated">
        <View style={styles.titleRow}>
          <View style={styles.headerTextWrap}>
            <Text style={styles.title}>Pipeline Timeline</Text>
            <Text style={styles.metaText}>Status: {STATUS_LABELS[episode.status as keyof typeof STATUS_LABELS] || episode.status}</Text>
            <Text style={styles.progressText}>{aggregateProgress}% active progress</Text>
          </View>
          <ConnectionBadge connected={realtime.isConnected} />
        </View>
      </Card>

      <Card>
        <PhaseIndicator currentPhase={currentPhase} compact={false} onPhasePress={handlePhasePress} />
      </Card>

      {active.length > 0 ? (
        <Card>
          <Text style={styles.sectionTitle}>Now Processing</Text>
          <ProcessingBars />
          <Text style={styles.metaText}>{active.length} active job(s). Please wait while automation completes.</Text>
        </Card>
      ) : null}

      {canRequestRender ? (
        <Card>
          <Text style={styles.sectionTitle}>Final Render</Text>
          <Text style={styles.metaText}>
            Cut plan is ready. Trigger final rendering to generate your publishable video.
          </Text>
          <View style={styles.retryRow}>
            <Button
              size="sm"
              onPress={() => void requestRender()}
              loading={episodeActions.requestRender.isPending}
              disabled={episodeActions.requestRender.isPending}
              style={styles.actionButton}
            >
              Request Render
            </Button>
          </View>
        </Card>
      ) : null}

      {active.length === 0 && !previewGuard.allowed && !canRequestRender ? (
        <Card>
          <Text style={styles.sectionTitle}>Pipeline Paused</Text>
          <Text style={styles.metaText}>
            No active jobs detected for this phase. Resume to continue orchestration.
          </Text>
          <View style={styles.retryRow}>
            <Button
              variant="outline"
              size="sm"
              onPress={() => void continuePipeline()}
              loading={resumeEpisode.isPending}
              disabled={resumeEpisode.isPending}
              style={styles.actionButton}
            >
              Continue Pipeline
            </Button>
          </View>
        </Card>
      ) : null}

      {actionFeedback ? (
        <Card variant="pastelBlue">
          <Text style={styles.metaText}>{actionFeedback}</Text>
        </Card>
      ) : null}

      {failed.length > 0 ? (
        <Card variant="pastelPink">
          <Text style={styles.sectionTitle}>Failure Diagnostics</Text>
          <Text style={styles.metaText}>{failed.length} job(s) failed in this episode.</Text>
          <View style={styles.retryRow}>
            <Button
              variant="outline"
              size="sm"
              onPress={() => void retryFailedSet()}
              loading={retryFailedEpisodeJobs.isPending}
              disabled={retryFailedEpisodeJobs.isPending}
              style={styles.actionButton}
            >
              Retry Failed Phase Set
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onPress={() => void restartFlow()}
              loading={startProcessing.isPending}
              disabled={startProcessing.isPending || active.length > 0}
              style={styles.actionButton}
            >
              Restart Whole Episode Flow
            </Button>
          </View>
          {active.length > 0 ? (
            <Text style={styles.metaText}>Restart is disabled while jobs are actively running.</Text>
          ) : null}
        </Card>
      ) : null}

      {/* Phase-grouped pipeline status */}
      <Card>
        <Text style={styles.sectionTitle}>Phase Summary</Text>
        <View style={styles.phaseSummaryWrap}>
          {phaseSummaries.map((phase) => (
            <View key={phase.phase} style={styles.phaseRow}>
              <View style={[styles.phaseDot, { backgroundColor: phase.status === 'idle' ? '#C8D4E3' : phase.color }]} />
              <View style={styles.phaseRowContent}>
                <Text style={styles.phaseRowLabel}>{phase.label}</Text>
                {phase.latestJob ? (
                  <Text style={styles.phaseRowMeta}>
                    {phase.latestJob.type.replaceAll('_', ' ')} · {phase.latestJob.status}
                  </Text>
                ) : null}
              </View>
              <Text style={[
                styles.phaseStatusBadge,
                phase.status === 'done' && styles.phaseStatusDone,
                phase.status === 'error' && styles.phaseStatusError,
                phase.status === 'active' && styles.phaseStatusActive,
              ]}>
                {phase.status === 'done' ? 'Complete'
                  : phase.status === 'error' ? 'Failed'
                  : phase.status === 'active' ? `${phase.latestJob?.progress ?? 0}%`
                  : '—'}
              </Text>
            </View>
          ))}
        </View>
      </Card>

      {/* Show all jobs toggle */}
      {jobs.length > 0 ? (
        <Button
          variant="ghost"
          size="sm"
          onPress={() => setShowHistory((current) => !current)}
          style={styles.actionButton}
        >
          {showHistory ? 'Hide Technical Job Log' : 'Show Technical Job Log'}
        </Button>
      ) : null}
    </View>
  );

  return (
    <View style={styles.root}>
      <Screen scroll={false} topInset={false}>
        <FlashList
          data={visibleJobs}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={header}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => {
            const isActive = item.status === 'pending' || item.status === 'processing';
            const isFailed = item.status === 'error';
            const diagnostics = isFailed ? formatError(item.errorMessage || 'Unknown failure') : null;

            return (
              <Card variant={isFailed ? 'pastelPink' : isActive ? 'pastelBlue' : 'default'}>
                {/* Inline progress bar */}
                <View style={styles.jobProgressTrack}>
                  <View style={[styles.jobProgressFill, { width: `${item.progress || 0}%` }, isFailed && styles.jobProgressFailed]} />
                </View>
                <View style={styles.jobHeader}>
                  <View style={styles.jobMetaWrap}>
                    <Text style={styles.jobType}>{item.type.replaceAll('_', ' ')}</Text>
                    <Text style={styles.metaText}>
                      {item.stage ? STAGE_LABELS[item.stage as keyof typeof STAGE_LABELS] || item.stage : 'Queued'} · {item.status}
                    </Text>
                    <Text style={styles.metaText}>{new Date(item.updatedAt).toLocaleString()}</Text>
                  </View>
                  <Text style={styles.badge}>{item.progress}%</Text>
                </View>

                {isFailed && diagnostics ? (
                  <View style={styles.diagnosticsWrap}>
                    <Text style={styles.errorTitle}>{diagnostics.title}</Text>
                    <Text style={styles.errorText}>{diagnostics.message}</Text>
                    <Text style={styles.errorHint}>{diagnostics.suggestion}</Text>
                    {item.errorMessage ? <Text style={styles.rawErrorText}>Technical: {item.errorMessage}</Text> : null}
                    <Button
                      variant="outline"
                      size="sm"
                      onPress={() => void retrySingleJob(item.id)}
                      loading={activeRetryJobId === item.id}
                      disabled={activeRetryJobId === item.id}
                      style={styles.actionButton}
                    >
                      Retry This Job
                    </Button>
                  </View>
                ) : null}
              </Card>
            );
          }}
        />
      </Screen>

      <StickyActionBar>
        <Button variant="outline" onPress={() => router.push(`/(main)/episode/${id}`)}>
          Episode Detail
        </Button>
        <Button
          onPress={() => router.push(`/(main)/episode/${id}/preview`)}
          disabled={!previewGuard.allowed}
        >
          Open Preview
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
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
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
  sectionTitle: {
    marginBottom: spacing.sm,
    color: colors.text.DEFAULT,
    fontFamily: typography.fontFamily.heading,
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold,
  },
  progressText: {
    marginTop: spacing.sm,
    color: colors.primary.DEFAULT,
    fontFamily: typography.fontFamily.mono,
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold,
  },
  barsWrap: {
    height: 32,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  bar: {
    width: 7,
    height: 24,
    borderRadius: borderRadius.full,
    backgroundColor: colors.primary.DEFAULT,
  },
  separator: {
    height: spacing.sm,
  },
  jobProgressTrack: {
    height: 3,
    backgroundColor: 'rgba(0,0,0,0.06)',
    borderRadius: 2,
    marginBottom: spacing.sm,
    overflow: 'hidden',
  },
  jobProgressFill: {
    height: '100%',
    backgroundColor: colors.primary.DEFAULT,
    borderRadius: 2,
  },
  jobProgressFailed: {
    backgroundColor: colors.error,
  },
  jobHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  jobMetaWrap: {
    flex: 1,
  },
  jobType: {
    color: colors.text.DEFAULT,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
    textTransform: 'capitalize',
  },
  metaText: {
    color: colors.text.light,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
    textTransform: 'capitalize',
  },
  badge: {
    color: colors.primary.DEFAULT,
    fontFamily: typography.fontFamily.mono,
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.bold,
  },
  diagnosticsWrap: {
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: '#703B4B',
    backgroundColor: '#261218',
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    gap: spacing.xs,
  },
  errorTitle: {
    color: colors.error,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.bold,
  },
  errorText: {
    color: colors.text.DEFAULT,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
    lineHeight: 20,
  },
  errorHint: {
    color: colors.text.muted,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.xs,
    lineHeight: 18,
  },
  rawErrorText: {
    color: colors.text.light,
    fontFamily: typography.fontFamily.mono,
    fontSize: typography.fontSize.xs,
    lineHeight: 18,
  },
  retryRow: {
    marginTop: spacing.md,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  historyToggleWrap: {
    marginTop: spacing.md,
    marginBottom: spacing.md,
    alignItems: 'flex-start',
  },
  actionButton: {
    width: 'auto',
  },
  // Phase summary styles
  phaseSummaryWrap: {
    gap: spacing.xs,
  },
  phaseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 8,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.md,
    backgroundColor: 'rgba(255,255,255,0.5)',
  },
  phaseDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  phaseRowContent: {
    flex: 1,
    gap: 1,
  },
  phaseRowLabel: {
    color: colors.text.DEFAULT,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
  },
  phaseRowMeta: {
    color: colors.text.muted,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.xs,
    textTransform: 'capitalize',
  },
  phaseStatusBadge: {
    color: colors.text.muted,
    fontFamily: typography.fontFamily.mono,
    fontSize: typography.fontSize.xs,
  },
  phaseStatusDone: {
    color: '#0A9F6A',
    fontWeight: typography.fontWeight.semibold,
  },
  phaseStatusError: {
    color: colors.error,
    fontWeight: typography.fontWeight.bold,
  },
  phaseStatusActive: {
    color: colors.primary.DEFAULT,
    fontWeight: typography.fontWeight.semibold,
  },
});
