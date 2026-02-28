/**
 * Hooks Index
 *
 * Re-exports all React Query hooks for the mobile app.
 */

// Utility hooks
export { useDebounce } from './useDebounce';

// Series hooks
export {
  useSeries,
  useSeriesDetail,
  useCreateSeries,
  useUpdateSeries,
  useDeleteSeries,
  seriesKeys,
  type Series,
  type SeriesWithEpisodeCount,
  type SeriesWithEpisodes,
} from './useSeries';

// Episode hooks
export {
  useEpisodes,
  useEpisode,
  useEpisodeScript,
  useCreateEpisode,
  useUpdateEpisode,
  useDeleteEpisode,
  useRegenerateScript,
  useUpdateScript,
  useStartRender,
  useStartProcessing,
  useStartSlotPlanning,
  useEpisodeDownloadUrl,
  useRequestVariation,
  episodeKeys,
  type Episode,
  type EpisodeWithSeries,
  type EpisodeWithDetails,
  type EpisodeStatus,
  type ScriptBeat,
  type EpisodeScript,
  type GeneratedScript,
  type TemplateSlotRequirements,
  type SlotClipSummary,
  type TemplateCompile,
  type EpisodeDownloadUrlResponse,
} from './useEpisodes';

// Episode actions hook
export { useEpisodeActions } from './useEpisodeActions';

// Template hooks
export {
  useTemplates,
  useTemplate,
  useRecommendedTemplates,
  useSearchTemplates,
  useSearchTemplatesMutation,
  templateKeys,
  type Template,
  type TemplateWithScore,
  type TemplateBeat,
  type TemplateStructure,
  type EditingRecipe,
} from './useTemplates';

// Job progress hooks
export {
  useJobs,
  useJob,
  useRetryJob,
  useRetryFailedEpisodeJobs,
  useCancelJob,
  useJobProgress,
  useJobProgressPolling,
  useActiveJobsWithNotifications,
  useAggregateProgress,
  jobKeys,
  // Phase 1-5 stage labels (Requirement 5.1-5.5, 5.9)
  JOB_TYPE_INFO,
  JOB_STAGE_LABELS,
  getJobTypeInfo,
  getStageLabel,
  getJobDescription,
  getPhaseLabel,
  // Aggregate progress (Requirement 5.10)
  calculateAggregateProgress,
  getPhase2ProgressMessage,
  getPhase3ProgressMessage,
  getPhase5ProgressMessage,
  type JobStatus,
  type JobStage,
  type JobProgress,
  type JobData,
  type JobTypeInfo,
  type AggregateProgressResult,
} from './useJobProgress';

// Voiceover upload hooks
export {
  useVoiceoverUpload,
  type VoiceoverUploadResult,
  type UploadProgress,
} from './useVoiceoverUpload';

// ElevenLabs voiceover generation hook
export {
  useElevenLabsVoiceover,
  type ElevenLabsVoiceoverResult,
  type ElevenLabsProgress,
} from './useElevenLabsVoiceover';

// Audio file picker hooks
export {
  useAudioFilePicker,
  type AudioFileInfo,
  type AudioPickResult,
} from './useAudioFilePicker';

// Clip upload hooks
export {
  useClipUpload,
  type ClipUploadState,
  type ClipUploadStatus,
} from './useClipUpload';

// Slot clips hooks
export {
  useSlotClips,
  useSlotClip,
  useCreateSlotClip,
  useUpdateSlotClip,
  useDeleteSlotClip,
  useSlotClipDownloadUrl,
  slotClipKeys,
  type SlotProgress,
  type SlotClipWithUrl,
} from './useSlotClips';

// Slot upload hooks
export {
  useSlotUpload,
  type SlotUploadState,
  type SlotUploadStatus,
} from './useSlotUpload';

// Real-time updates hooks
export {
  useRealtimeUpdates,
  useHomeRealtimeUpdates,
  useActiveJobsPolling,
  type ConnectionType,
  type RealtimeUpdatesResult,
} from './useRealtimeUpdates';

export {
  useUnifiedRealtimeUpdates,
  type UseUnifiedRealtimeUpdatesOptions,
  type UnifiedRealtimeUpdatesResult,
} from './useUnifiedRealtimeUpdates';

// Episode journey hooks
export { useEpisodeJourney } from './useEpisodeJourney';

// Blocking state hooks
export {
  useBlockingState,
  PHASE_1_JOB_TYPES,
  PHASE_2_JOB_TYPES,
  PHASE_3_JOB_TYPES,
  PHASE_4_JOB_TYPES,
  PHASE_5_JOB_TYPES,
  ALL_BLOCKING_JOB_TYPES,
  hasActivePhase1Jobs,
  hasActivePhase2Jobs,
  hasActivePhase3Jobs,
  hasActivePhase5Jobs,
  type BlockingStateResult,
} from './useBlockingState';

// User settings hooks
export {
  useUserSettings,
  useUpdateElevenLabsVoiceId,
  useUpdateElevenLabsApiKey,
  useUpdateElevenLabsSettings,
  userSettingsKeys,
  type UserSettings,
} from './useUserSettings';

// Active job types hook
export {
  useActiveJobTypes,
  PHASE_1_JOB_TYPES as ACTIVE_PHASE_1_JOB_TYPES,
  PHASE_2_JOB_TYPES as ACTIVE_PHASE_2_JOB_TYPES,
  PHASE_3_JOB_TYPES as ACTIVE_PHASE_3_JOB_TYPES,
  PHASE_4_JOB_TYPES as ACTIVE_PHASE_4_JOB_TYPES,
  PHASE_5_JOB_TYPES as ACTIVE_PHASE_5_JOB_TYPES,
  JOB_TYPES_BY_PHASE,
  type ActiveJobTypesResult,
} from './useActiveJobTypes';

// Slot upload blocking hook
export {
  useSlotUploadBlocking,
  SLOT_UPLOAD_BLOCKING_STATUSES,
  SLOT_UPLOAD_ALLOWED_STATUSES,
  BROLL_JOB_TYPES,
  SLOT_UPLOAD_BLOCKING_MESSAGES,
  type SlotUploadBlockingResult,
} from './useSlotUploadBlocking';


// Status transition hook
export {
  useStatusTransition,
  triggerTransitionAnimation,
  type UseStatusTransitionOptions,
  type UseStatusTransitionResult,
} from './useStatusTransition';

// Navigation hooks
export {
  useNavigation,
  type UseNavigationResult,
} from './useNavigation';
