/**
 * Stores Index
 *
 * Re-exports all Zustand stores.
 */

export { useAuthStore } from './auth';
export { useUploadStore, type UploadProgress } from './upload';
export { useJobStore, type Job } from './jobs';
export {
  useOnboardingStore,
  type Niche,
  type Tone,
  type Platform,
  type AudienceAge,
  type ContentGoal,
  type PersonaData,
  type OnboardingChoice,
} from './onboarding';
export {
  useRecordingStore,
  useRecordingProgress,
  useBeatRecordingStatus,
  type SegmentRecording,
  type RecordingMode,
  type RecordingStatus,
} from './recording';

export {
  useEpisodeJourneyStore,
  JOURNEY_STEPS,
  BLOCKING_STATUSES,
  BLOCKING_REASONS,
  statusToJourneyStep,
  getStepIndex,
  getStepConfig,
  calculateJourneyProgress,
  isStepComplete,
  isCurrentStep,
  isUpcomingStep,
  isBlockingStatus,
  getBlockingReason,
  type JourneyStep,
  type JourneySubState,
  type JourneyStepConfig,
  type StatusMappingResult,
  type EpisodeStatus as JourneyEpisodeStatus,
} from './episodeJourney';

export {
  useNavigationStore,
  useCurrentScreen,
  useNavigationStack,
  useIsNavigating,
  usePendingNavigation,
  useNavigationHistory,
} from './navigation';

export {
  useNotificationStore,
  type AppNotification,
  type AppNotificationType,
} from './notifications';
