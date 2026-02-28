/* eslint-disable max-lines */
import { useEffect, useMemo, useState } from 'react';
import { Pressable, Switch, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useLocalSearchParams, usePathname, useRouter } from 'expo-router';
import Animated, { FadeInDown, FadeOutUp, LinearTransition } from 'react-native-reanimated';
import { Ionicons } from '@/components/ui/SymbolIcon';
import {
  useDeleteEpisode,
  useEpisode,
  useRegenerateScript,
  useResumeEpisode,
  useStartProcessing,
  useUpdateEpisode,
  useUpdateScript,
} from '@/hooks/useEpisodes';
import { useElevenLabsVoiceover } from '@/hooks/useElevenLabsVoiceover';
import { useEpisodeActions } from '@/hooks/useEpisodeActions';
import { useJobs } from '@/hooks/useJobProgress';
import { useUnifiedRealtimeUpdates } from '@/hooks/useUnifiedRealtimeUpdates';
import {
  EpisodeStatus,
  STATUS_LABELS,
  STATUS_TO_STEP,
  getPhaseResultRoute,
  type PipelinePhase,
  getEpisodeActionMatrix,
  getVisibleSections,
  sortJobsByPipelineOrder,
  STAGE_LABELS,
  groupJobsByPhase,
} from '@/lib/pipeline';
import {
  Button,
  Card,
  EmptyState,
  Input,
  Progress,
  Screen,
  StickyActionBar,
  TextArea,
  Skeleton,
  ConnectionBadge,
} from '@/components/ui';
import { PhaseIndicator, getPhaseFromStatus } from '@/components/episode/PhaseIndicator';
import { AudioPlayer } from '@/components/media/AudioPlayer';
import { VideoPlayer } from '@/components/media/VideoPlayer';
import { colors } from '@/lib/theme';
import { trackPrimaryAction, trackScreenView } from '@/lib/analytics';
import { confirmAction } from '@/lib/confirm';
import { styles } from '@/components/screens/episode-detail-screen.styles';
import { ApiError } from '@/lib/api';
import { isARollFirstTemplateWithFallback, getPrimaryARollSlotId } from '@/lib/templateWorkflow';

interface WorkflowCTA {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
}

function formatActionError(error: unknown): string {
  if (error instanceof ApiError) {
    const details = error.details || {};
    const missingSlots = Array.isArray(details.missingSlots) ? details.missingSlots : [];
    if (missingSlots.length > 0) {
      return `Missing required slots: ${missingSlots.join(', ')}.`;
    }

    if (typeof details.pendingChunkJobs === 'number' && details.pendingChunkJobs > 0) {
      return `Background processing is still running (${details.pendingChunkJobs} pending job(s)).`;
    }

    if (typeof details.phase === 'string') {
      return `${error.message} Current phase: ${details.phase}.`;
    }

    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'Action failed. Please retry.';
}

export default function EpisodeDetailScreen() {
  const { id, focus } = useLocalSearchParams<{ id: string; focus?: string | string[] }>();
  const router = useRouter();
  const pathname = usePathname();
  const isFocused = Boolean(id) && pathname === `/episode/${id}`;
  const focusValue = Array.isArray(focus) ? focus[0] : focus;
  const forceVoiceoverPreview = focusValue === 'voiceover';

  const episodeQuery = useEpisode(id);
  const deleteEpisode = useDeleteEpisode();
  const updateScript = useUpdateScript();
  const updateEpisode = useUpdateEpisode();
  const regenerateScript = useRegenerateScript();
  const startProcessing = useStartProcessing();
  const resumeEpisode = useResumeEpisode();
  const episodeActions = useEpisodeActions(id);
  const elevenLabs = useElevenLabsVoiceover(id);
  const jobsQuery = useJobs({ episodeId: id }, { enabled: Boolean(id && isFocused) });
  const realtime = useUnifiedRealtimeUpdates({ episodeId: id || '', enabled: Boolean(id && isFocused) });

  const episode = episodeQuery.data;
  const jobs = useMemo(() => sortJobsByPipelineOrder(jobsQuery.data || []), [jobsQuery.data]);

  const [draftTitle, setDraftTitle] = useState('');
  const [draftScript, setDraftScript] = useState('');
  const [editingScript, setEditingScript] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const [captionsEnabled, setCaptionsEnabled] = useState(true);

  useEffect(() => {
    setActionFeedback(null);
    setCaptionsEnabled(true);
  }, [id]);

  useEffect(() => {
    const spec = episode?.renderSpec as Record<string, unknown> | null;
    if (spec && typeof spec.captionsEnabled === 'boolean') {
      setCaptionsEnabled(spec.captionsEnabled);
    }
  }, [episode?.renderSpec]);

  const handleToggleCaptions = async (value: boolean) => {
    if (!id) return;
    const previousValue = captionsEnabled;
    setCaptionsEnabled(value);
    try {
      await updateEpisode.mutateAsync({ id, data: { captionsEnabled: value } });
      setActionFeedback(value ? 'Captions enabled for final render.' : 'Captions disabled for final render.');
    } catch (error) {
      setCaptionsEnabled(previousValue);
      setActionFeedback(formatActionError(error));
    }
  };

  useEffect(() => {
    trackScreenView('episode_detail', { episodeId: id });
  }, [id]);

  const status = episode?.status || 'draft';
  const step = STATUS_TO_STEP[status as keyof typeof STATUS_TO_STEP] || 'script';
  const slotsComplete = Boolean(episode?.slotProgress?.isComplete);
  const hasPlayback = Boolean(episode?.muxFinalPlaybackId);
  const hasActiveJobs = jobs.some((job) => job.status === 'pending' || job.status === 'processing');
  const pipelineBusy = hasActiveJobs || startProcessing.isPending || episodeActions.requestRender.isPending;

  // Detect A-roll-first template (camera+audio first, then B-roll)
  const arollFirstInfo = useMemo(() => {
    const slotReqs = (episode as any)?.template?.slotRequirements ?? null;
    const templateName = (episode as any)?.template?.name ?? null;
    const isArollFirst = isARollFirstTemplateWithFallback(slotReqs, templateName);
    const primarySlotId = isArollFirst ? (getPrimaryARollSlotId(slotReqs) || 'A1') : null;
    return { isArollFirst, primarySlotId };
  }, [(episode as any)?.template?.slotRequirements, (episode as any)?.template?.name]);

  const sections = useMemo(() => getVisibleSections(status as EpisodeStatus), [status]);

  const actionMatrix = useMemo(
    () => getEpisodeActionMatrix({ status, slotsComplete, hasPlayback, hasActiveJobs }),
    [status, slotsComplete, hasPlayback, hasActiveJobs]
  );

  const activeJobs = jobs.filter((job) => job.status === 'pending' || job.status === 'processing');
  const failedJobs = jobs.filter((job) => job.status === 'error');

  const phaseSummaries = useMemo(
    () => groupJobsByPhase(jobs).filter((p) => p.totalJobs > 0),
    [jobs]
  );

  // --- Handlers (unchanged) ---

  const onSaveScript = async () => {
    if (!id) return;
    try {
      setActionFeedback(null);
      trackPrimaryAction('episode_save_script', { episodeId: id });
      await updateScript.mutateAsync({ id, data: { scriptContent: draftScript.trim() } });
      setEditingScript(false);
    } catch (error) {
      setActionFeedback(formatActionError(error));
    }
  };

  const onGenerateScript = async () => {
    if (!id) return;
    const confirmed = await confirmAction(
      'Generate script?',
      'This runs an LLM call and may replace your current draft script.',
      'Generate'
    );
    if (!confirmed) return;
    try {
      setActionFeedback(null);
      trackPrimaryAction('episode_generate_script', { episodeId: id });
      await regenerateScript.mutateAsync({ id, data: {} });
    } catch (error) {
      setActionFeedback(formatActionError(error));
    }
  };

  const onGenerateVoiceover = async () => {
    const confirmed = await confirmAction(
      'Generate voiceover?',
      'This triggers ElevenLabs and can incur usage costs.',
      'Generate'
    );
    if (!confirmed) return;
    try {
      setActionFeedback(null);
      trackPrimaryAction('episode_generate_voiceover', { episodeId: id });
      const result = await elevenLabs.generateVoiceover();
      if (!result.success && result.error) {
        setActionFeedback(result.error);
      }
    } catch (error) {
      setActionFeedback(formatActionError(error));
    }
  };

  const onStartProcessing = async () => {
    if (!id || !actionMatrix.start_processing.allowed) return;
    const confirmed = await confirmAction(
      'Start processing?',
      'This launches multiple pipeline jobs and paid AI services.',
      'Start'
    );
    if (!confirmed) return;
    try {
      setActionFeedback(null);
      trackPrimaryAction('episode_start_processing', { episodeId: id });
      await startProcessing.mutateAsync(id);
      router.push(`/(main)/episode/${id}/processing`);
    } catch (error) {
      setActionFeedback(formatActionError(error));
    }
  };

  const onRequestRender = async () => {
    if (!actionMatrix.request_render.allowed) return;
    const confirmed = await confirmAction(
      'Request final render?',
      'Rendering will run FFmpeg and publish steps. Continue?',
      'Render'
    );
    if (!confirmed) return;
    try {
      setActionFeedback(null);
      trackPrimaryAction('episode_request_render', { episodeId: id });
      await episodeActions.requestRender.mutateAsync();
      router.push(`/(main)/episode/${id}/processing`);
    } catch (error) {
      setActionFeedback(formatActionError(error));
    }
  };

  const onResumePipeline = async () => {
    if (!id) return;
    try {
      setActionFeedback(null);
      const result = await resumeEpisode.mutateAsync({ id, execute: true });
      if (result.nextRoute) {
        router.push(result.nextRoute as never);
        return;
      }
      if (result.message) {
        setActionFeedback(result.message);
      }
    } catch (error) {
      setActionFeedback(formatActionError(error));
    }
  };

  const onDeleteEpisode = async () => {
    if (!id) return;
    const confirmed = await confirmAction(
      'Delete this episode?',
      'This permanently deletes the episode, clips, and job history. This cannot be undone.',
      'Delete'
    );
    if (!confirmed) return;
    try {
      setActionFeedback(null);
      trackPrimaryAction('episode_delete', { episodeId: id });
      await deleteEpisode.mutateAsync(id);
      router.replace('/(main)/(tabs)/home');
    } catch (error) {
      setActionFeedback(formatActionError(error));
    }
  };

  const handleBack = () => {
    router.back();
  };

  // --- Computed values ---

  const lastActionRejection = useMemo(() => {
    if (actionFeedback) return actionFeedback;
    const candidates = [
      startProcessing.error,
      episodeActions.requestRender.error,
      regenerateScript.error,
      updateScript.error,
    ].filter(Boolean) as Array<unknown>;

    if (candidates.length === 0) return null;
    const latest = candidates[candidates.length - 1];
    if (latest instanceof Error) return latest.message;
    return 'Action was rejected. Check requirements and retry.';
  }, [
    actionFeedback,
    episodeActions.requestRender.error,
    regenerateScript.error,
    startProcessing.error,
    updateScript.error,
  ]);

  const primaryWorkflowAction = useMemo<WorkflowCTA>(() => {
    if (!episode?.scriptContent?.trim() && actionMatrix.generate_script.allowed) {
      return {
        label: 'Generate Script',
        onPress: () => void onGenerateScript(),
        disabled: regenerateScript.isPending,
        loading: regenerateScript.isPending,
      };
    }

    if (sections.voiceover && actionMatrix.voiceover_capture.allowed) {
      // Block primary CTA during ElevenLabs generation
      if (elevenLabs.isGenerating) {
        return {
          label: 'Generating Voiceover...',
          onPress: () => {},
          disabled: true,
          loading: true,
        };
      }
      // A-roll-first templates: go directly to camera recording (video+audio)
      if (arollFirstInfo.isArollFirst && arollFirstInfo.primarySlotId) {
        return {
          label: 'Record A-Roll',
          onPress: () => router.push(`/(main)/episode/${id}/slots/${arollFirstInfo.primarySlotId}/record` as any),
        };
      }
      return {
        label: 'Record Voiceover',
        onPress: () => router.push(`/(main)/episode/${id}/record`),
      };
    }

    if (sections.clips && actionMatrix.slot_collection.allowed) {
      return {
        label: 'Manage Clip Slots',
        onPress: () => router.push(`/(main)/episode/${id}/slots`),
      };
    }

    if (actionMatrix.start_processing.allowed) {
      return {
        label: 'Start Processing',
        onPress: () => void onStartProcessing(),
        disabled: startProcessing.isPending,
        loading: startProcessing.isPending,
      };
    }

    if (actionMatrix.request_render.allowed) {
      return {
        label: 'Request Render',
        onPress: () => void onRequestRender(),
        disabled: episodeActions.requestRender.isPending,
        loading: episodeActions.requestRender.isPending,
      };
    }

    if (actionMatrix.processing_timeline.allowed) {
      return {
        label: 'View Processing',
        onPress: () => router.push(`/(main)/episode/${id}/processing`),
      };
    }

    if (actionMatrix.preview.allowed) {
      return {
        label: 'Open Preview',
        onPress: () => router.push(`/(main)/episode/${id}/preview`),
      };
    }

    if (sections.recovery) {
      return {
        label: 'Resume Pipeline',
        onPress: () => void onResumePipeline(),
        disabled: resumeEpisode.isPending,
        loading: resumeEpisode.isPending,
      };
    }

    return {
      label: 'View Processing',
      onPress: () => router.push(`/(main)/episode/${id}/processing`),
      disabled: true,
    };
  }, [
    actionMatrix, arollFirstInfo, elevenLabs.isGenerating, episode?.scriptContent,
    episodeActions.requestRender.isPending, id, regenerateScript.isPending,
    resumeEpisode.isPending, router, sections, startProcessing.isPending,
  ]);

  const showContinuePipelineAction =
    sections.processing &&
    !hasActiveJobs &&
    !actionMatrix.request_render.allowed &&
    !actionMatrix.preview.allowed;

  // --- Render ---

  if (episodeQuery.isLoading) {
    return (
      <Screen contentContainerStyle={styles.content} topInset={false}>
        <Card>
          <Skeleton height={18} width="40%" radius="sm" />
          <Skeleton height={120} radius="lg" />
          <Skeleton height={120} radius="lg" />
        </Card>
      </Screen>
    );
  }

  if (!episode) {
    return (
      <Screen contentContainerStyle={styles.content} topInset={false}>
        <EmptyState title="Episode not found" description="It may have been deleted." icon={<Ionicons name="film-outline" size={44} color={colors.primary.DEFAULT} />} />
      </Screen>
    );
  }

  const hasScriptContent = Boolean(episode.scriptContent?.trim());
  const currentPhase = getPhaseFromStatus(status);
  const phaseProgress = activeJobs.length > 0
    ? Math.round(activeJobs.reduce((sum, j) => sum + (j.progress || 0), 0) / activeJobs.length)
    : (step === 'final' ? 100 : 0);
  const handlePhasePress = (phase: number) => {
    if (!id) return;
    const route = getPhaseResultRoute({
      episodeId: id,
      phase: phase as PipelinePhase,
      hasPlayback: Boolean(episode?.muxFinalPlaybackId),
    });
    router.push(route as never);
  };

  const header = (
    <View style={styles.headerStack}>
      {/* Title + Status */}
      <View style={styles.header}>
        <Input
          label="Episode Title"
          value={draftTitle || episode.title}
          onChangeText={setDraftTitle}
          editable={false}
        />
        <View style={styles.glassStatusCard}>
          <View style={styles.glassStatusLeft}>
            <Text style={styles.glassStatusLabel}>
              {STATUS_LABELS[status as keyof typeof STATUS_LABELS] || status}
            </Text>
            <Text style={styles.glassStatusStep}>Stage: {step}</Text>
          </View>
          <ConnectionBadge connected={realtime.isConnected} />
        </View>
      </View>

      {/* Phase Indicator — shown during active pipeline phases */}
      {sections.phaseIndicator ? (
        <Animated.View entering={FadeInDown.duration(300)} exiting={FadeOutUp.duration(200)} layout={LinearTransition.springify()}>
          <PhaseIndicator
            currentPhase={currentPhase}
            phaseProgress={phaseProgress}
            isPhaseComplete={step === 'final'}
            compact={false}
            onPhasePress={handlePhasePress}
          />
        </Animated.View>
      ) : null}

      {/* Voiceover Preview — visible in voiceover/clips phases and when explicitly requested via phase click */}
      {(sections.voiceoverPreview || forceVoiceoverPreview) ? (
        <Animated.View entering={FadeInDown.duration(250)} exiting={FadeOutUp.duration(200)} layout={LinearTransition.springify()}>
          <Card>
            <Text style={styles.sectionTitle}>Voiceover Preview</Text>
            {episode.activeVoiceoverPlaybackId ? (
              <AudioPlayer
                muxPlaybackId={episode.activeVoiceoverPlaybackId}
                title="Cleaned Voiceover"
                defaultExpanded={false}
                transcriptWords={episode.correctedWordTranscript || episode.wordTranscript || []}
                scriptText={episode.scriptContent || undefined}
              />
            ) : (
              <Text style={styles.metaText}>
                Cleaned voiceover is not available yet for this episode.
              </Text>
            )}

            {arollFirstInfo.isArollFirst && episode.arollCleanPreviewPlaybackId ? (
              <View style={styles.arollVideoPreviewWrap}>
                <Text style={styles.subSectionTitle}>Cleaned A-Roll Video</Text>
                <VideoPlayer
                  muxPlaybackId={episode.arollCleanPreviewPlaybackId}
                  showControls
                  enablePlaybackSpeed
                  enableFullscreen
                  contentFit="contain"
                  aspectRatio={9 / 16}
                />
              </View>
            ) : null}
          </Card>
        </Animated.View>
      ) : null}

      {/* ============ PHASE: Script ============ */}
      {sections.script ? (
        <Animated.View entering={FadeInDown.duration(250)} exiting={FadeOutUp.duration(200)} layout={LinearTransition.springify()}>
          <Card>
            <Text style={styles.sectionTitle}>Script</Text>
            <View style={styles.stack}>
              <TextArea
                label="Script"
                value={editingScript ? draftScript : episode.scriptContent || ''}
                onChangeText={setDraftScript}
                editable={editingScript && actionMatrix.edit_script.allowed}
                helperText="Write your script, then record or generate voiceover."
              />
              <Button
                variant="outline"
                onPress={() => {
                  setEditingScript(true);
                  setDraftScript(episode.scriptContent || '');
                }}
                disabled={editingScript || !actionMatrix.edit_script.allowed}
              >
                {hasScriptContent ? 'Edit Script Manually' : 'Add Script Manually'}
              </Button>
              {editingScript ? (
                <Button
                  onPress={() => void onSaveScript()}
                  loading={updateScript.isPending}
                  disabled={!editingScript || updateScript.isPending || !draftScript.trim()}
                >
                  Save Script
                </Button>
              ) : null}
              <View style={styles.scriptGenerateWrap}>
                <Text style={styles.scriptGenerateHint}>
                  Optional: generate with AI only after manual script edits.
                </Text>
                <Button
                  variant="secondary"
                  onPress={() => void onGenerateScript()}
                  loading={regenerateScript.isPending}
                  disabled={regenerateScript.isPending || !actionMatrix.generate_script.allowed}
                >
                  Generate Script (AI)
                </Button>
              </View>
            </View>
          </Card>
        </Animated.View>
      ) : null}

      {/* ============ PHASE: Voiceover capture ============ */}
      {sections.voiceover && episode.scriptContent?.trim() ? (
        <Animated.View entering={FadeInDown.duration(250).delay(80)} exiting={FadeOutUp.duration(200)} layout={LinearTransition.springify()}>
          {/* ElevenLabs generation in progress — block all voiceover actions */}
          {elevenLabs.isGenerating ? (
            <Card variant="pastelBlue">
              <View style={styles.blockingCard}>
                <Ionicons name="volume-high-outline" size={32} color={colors.primary.DEFAULT} />
                <Text style={styles.blockingText}>{elevenLabs.progress.message}</Text>
                <View style={styles.elevenLabsProgressWrap}>
                  <Progress value={elevenLabs.progress.progress} size="sm" />
                </View>
                <Text style={styles.blockingSubtext}>
                  Generating voiceover with ElevenLabs. Please wait and do not navigate away.
                </Text>
              </View>
            </Card>
          ) : (
            <Card>
              <Text style={styles.sectionTitle}>
                {arollFirstInfo.isArollFirst ? 'A-Roll Recording' : 'Voiceover'}
              </Text>
              <View style={styles.stack}>
                {arollFirstInfo.isArollFirst && arollFirstInfo.primarySlotId ? (
                  <>
                    <Button
                      onPress={() => router.push(`/(main)/episode/${id}/slots/${arollFirstInfo.primarySlotId}/record` as any)}
                      disabled={!actionMatrix.voiceover_capture.allowed || elevenLabs.isGenerating}
                    >
                      Record A-Roll (Camera + Audio)
                    </Button>
                    <Text style={styles.metaText}>
                      Record video and audio together. Audio will be cleaned automatically, then you can add B-roll.
                    </Text>
                  </>
                ) : (
                  <>
                    <Button
                      onPress={() => void onGenerateVoiceover()}
                      loading={elevenLabs.isGenerating}
                      disabled={!actionMatrix.voiceover_capture.allowed || elevenLabs.isGenerating}
                    >
                      Generate Voiceover (ElevenLabs)
                    </Button>
                    <Button
                      variant="outline"
                      onPress={() => router.push(`/(main)/episode/${id}/record`)}
                      disabled={!actionMatrix.voiceover_capture.allowed || elevenLabs.isGenerating}
                    >
                      Record Voiceover
                    </Button>
                  </>
                )}
              </View>
            </Card>
          )}
        </Animated.View>
      ) : null}

      {/* ============ PHASE: Voiceover processing (blocking) ============ */}
      {step === 'voiceover' ? (
        <Animated.View entering={FadeInDown.duration(250)} exiting={FadeOutUp.duration(200)} layout={LinearTransition.springify()}>
          <Card>
            <View style={styles.blockingCard}>
              <Ionicons name="hourglass-outline" size={32} color={colors.primary.DEFAULT} />
              <Text style={styles.blockingText}>Processing your voiceover...</Text>
              <Text style={styles.blockingSubtext}>
                Transcription, correction, and audio cleanup are running automatically.
              </Text>
            </View>
          </Card>
        </Animated.View>
      ) : null}

      {/* ============ PHASE: Clips ============ */}
      {sections.clips ? (
        <Animated.View entering={FadeInDown.duration(250)} exiting={FadeOutUp.duration(200)} layout={LinearTransition.springify()}>
          <Card>
            <Text style={styles.sectionTitle}>Footage and Processing</Text>
            <View style={styles.stack}>
              <Button
                variant="outline"
                onPress={() => router.push(`/(main)/episode/${id}/slots`)}
                disabled={!actionMatrix.slot_collection.allowed || pipelineBusy}
              >
                Manage Clip Slots
              </Button>
              <Button
                variant="outline"
                onPress={() => router.push(`/(main)/episode/${id}/upload`)}
                disabled={!actionMatrix.slot_collection.allowed || pipelineBusy}
              >
                Bulk Clip Import
              </Button>

              {/* Captions toggle */}
              <View style={styles.captionsRow}>
                <View style={styles.captionsTextWrap}>
                  <Text style={styles.captionsLabel}>Captions on Video</Text>
                  <Text style={styles.captionsHint}>
                    {captionsEnabled ? 'Subtitles will be burned into the final video.' : 'Final video will have no captions.'}
                  </Text>
                </View>
                <Switch
                  value={captionsEnabled}
                  onValueChange={handleToggleCaptions}
                  disabled={updateEpisode.isPending}
                  trackColor={{ false: '#3e3e3e', true: colors.primary.DEFAULT }}
                  thumbColor="#FFFFFF"
                />
              </View>

              {actionMatrix.start_processing.allowed ? (
                <Button
                  onPress={() => void onStartProcessing()}
                  loading={startProcessing.isPending}
                  disabled={startProcessing.isPending}
                >
                  Start Processing
                </Button>
              ) : null}
              {!actionMatrix.start_processing.allowed && actionMatrix.start_processing.disabledReason ? (
                <Text style={styles.warningText}>{actionMatrix.start_processing.disabledReason}</Text>
              ) : null}
              {pipelineBusy ? (
                <Text style={styles.warningText}>
                  Jobs are running. Clip editing and processing triggers are temporarily locked.
                </Text>
              ) : null}
            </View>
          </Card>
        </Animated.View>
      ) : null}

      {/* ============ PHASE: Processing ============ */}
      {sections.processing ? (
        <Animated.View entering={FadeInDown.duration(250)} exiting={FadeOutUp.duration(200)} layout={LinearTransition.springify()}>
          <Card>
            <Text style={styles.sectionTitle}>Processing</Text>
            <View style={styles.stack}>
              <Button
                onPress={() => router.push(`/(main)/episode/${id}/processing`)}
              >
                Open Processing Timeline
              </Button>
              {sections.render ? (
                <Button
                  onPress={() => void onRequestRender()}
                  loading={episodeActions.requestRender.isPending}
                  disabled={!actionMatrix.request_render.allowed || episodeActions.requestRender.isPending}
                >
                  Request Render
                </Button>
              ) : null}
              {hasActiveJobs ? (
                <Text style={styles.metaText}>{activeJobs.length} active job(s) running...</Text>
              ) : null}
              {showContinuePipelineAction ? (
                <Button
                  variant="outline"
                  onPress={() => void onResumePipeline()}
                  loading={resumeEpisode.isPending}
                  disabled={resumeEpisode.isPending}
                >
                  Continue Pipeline
                </Button>
              ) : null}
            </View>
          </Card>
        </Animated.View>
      ) : null}

      {/* ============ PHASE: Final ============ */}
      {sections.finalPreview ? (
        <Animated.View entering={FadeInDown.duration(300)} exiting={FadeOutUp.duration(200)} layout={LinearTransition.springify()}>
          <Card variant="pastelGreen">
            <Text style={styles.sectionTitle}>Your Video is Ready</Text>
            <View style={styles.stack}>
              <Button
                onPress={() => router.push(`/(main)/episode/${id}/preview`)}
                disabled={!actionMatrix.preview.allowed}
              >
                Open Preview
              </Button>
            </View>
          </Card>
        </Animated.View>
      ) : null}

      {/* ============ PHASE: Recovery ============ */}
      {sections.recovery ? (
        <Animated.View entering={FadeInDown.duration(250)} exiting={FadeOutUp.duration(200)} layout={LinearTransition.springify()}>
          <Card variant="pastelPink">
            <Text style={styles.sectionTitle}>Pipeline Failed</Text>
            <Text style={styles.metaText}>
              {failedJobs.length} job(s) failed. You can resume from the last successful phase or retry individual jobs.
            </Text>
            <View style={styles.stack}>
              <Button
                onPress={() => void onResumePipeline()}
                loading={resumeEpisode.isPending}
                disabled={resumeEpisode.isPending}
              >
                Resume from Current Phase
              </Button>
              <Button
                variant="outline"
                onPress={() => router.push(`/(main)/episode/${id}/processing`)}
              >
                Open Processing Timeline
              </Button>
            </View>
          </Card>
        </Animated.View>
      ) : null}

      {/* Action feedback */}
      {lastActionRejection ? (
        <Animated.View entering={FadeInDown.duration(200)} exiting={FadeOutUp.duration(150)} layout={LinearTransition.springify()}>
          <Card variant="pastelYellow">
            <View style={styles.guidanceCard}>
              <Text style={styles.guidanceTitle}>Last action response</Text>
              <Text style={styles.guidanceText}>{lastActionRejection}</Text>
            </View>
          </Card>
        </Animated.View>
      ) : null}

      {/* Pipeline Status — grouped by phase, latest per phase */}
      {phaseSummaries.length > 0 ? (
        <Animated.View entering={FadeInDown.duration(200)} layout={LinearTransition.springify()}>
          <Card>
            <Text style={styles.sectionTitle}>Pipeline Status</Text>
            <View style={styles.phaseSummaryWrap}>
              {phaseSummaries.map((phase) => (
                <View key={phase.phase} style={styles.phaseRow}>
                  <View style={[styles.phaseDot, { backgroundColor: phase.status === 'idle' ? '#C8D4E3' : phase.color }]} />
                  <Text style={styles.phaseLabel}>{phase.label}</Text>
                  <Text style={[
                    styles.phaseStatusText,
                    phase.status === 'done' && styles.phaseStatusDone,
                    phase.status === 'error' && styles.phaseStatusError,
                    phase.status === 'active' && styles.phaseStatusActive,
                  ]}>
                    {phase.status === 'done' ? 'Complete'
                      : phase.status === 'error' ? 'Failed'
                      : phase.status === 'active' ? `Processing${phase.latestJob ? ` ${phase.latestJob.progress}%` : ''}`
                      : '—'}
                  </Text>
                </View>
              ))}
            </View>
          </Card>
        </Animated.View>
      ) : null}
    </View>
  );

  return (
    <View style={styles.root}>
      <Screen scroll={false} topInset={false}>
        <FlashList
          data={phaseSummaries}
          keyExtractor={(item) => String(item.phase)}
          ListHeaderComponent={header}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={null}
          renderItem={() => null}
        />
      </Screen>

      <StickyActionBar>
        <Button
          onPress={primaryWorkflowAction.onPress}
          disabled={primaryWorkflowAction.disabled}
          loading={primaryWorkflowAction.loading}
        >
          {primaryWorkflowAction.label}
        </Button>
        <Button
          variant="danger"
          onPress={() => void onDeleteEpisode()}
          loading={deleteEpisode.isPending}
          disabled={deleteEpisode.isPending}
        >
          Delete Episode
        </Button>
      </StickyActionBar>
    </View>
  );
}
