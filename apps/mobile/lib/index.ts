/**
 * Lib Index
 *
 * Re-exports all library utilities.
 */

export {
  apiClient,
  useApiClient,
  useApiUrl,
  useAuthToken,
  ApiError,
  NetworkError,
  AuthenticationError,
  ValidationError,
  type CreateSeriesInput,
  type UpdateSeriesInput,
  type CreateEpisodeInput,
  type UpdateEpisodeInput,
  type TemplateFilters,
  type TemplateSearchInput,
} from './api';
export { tokenCache, clearAllTokens } from './clerk';
export { queryClient } from './queryClient';
export {
  theme,
  colors,
  typography,
  spacing,
  borderRadius,
  shadows,
  surfaceLevels,
  elevation,
  buttonStyles,
  cardStyles,
  inputStyles,
  badgeStyles,
  progressStyles,
  tabBarStyles,
  type Theme,
  type Colors,
  type Typography,
} from './theme';
export {
  triggerHaptic,
  triggerActionHaptic,
  useHaptics,
  type HapticType,
  type HapticActionType,
} from './haptics';

// Upload utilities
export {
  validateVideoFile,
  validateMultipleFiles,
  isAllowedFormat,
  isAllowedMimeType,
  getFileExtension,
  formatBytes,
  formatDuration,
  estimateUploadTime,
  getValidationErrorMessage,
  needsChunkedUpload,
  calculateChunks,
  VIDEO_VALIDATION_CONFIG,
  type ValidationResult,
  type VideoMetadata,
} from './fileValidation';

export {
  saveUploadState,
  loadUploadState,
  clearUploadState,
  getPendingUploads,
  calculateTotalChunks,
  performChunkedUpload,
  performSimpleUpload,
  validateFile,
  type UploadChunkState,
  type UploadProgressCallback,
} from './uploadService';

// Notifications
export {
  requestNotificationPermissions,
  showNotification,
  showJobCompletionNotification,
  showVideoReadyNotification,
  cancelAllNotifications,
  getBadgeCount,
  setBadgeCount,
  useNotificationListeners,
  type NotificationType,
  type NotificationOptions,
} from './notifications';

// Button states utility
export {
  getButtonStates,
  hasActivePhase1Jobs,
  hasActivePhase2Jobs,
  hasActivePhase5Jobs,
  hasAnyActiveJobs,
  isBlockingState,
  getBlockingStateReason,
  type ButtonStates,
  type ButtonState,
  type GetButtonStatesInput,
} from './buttonStates';

// Error messages utility
export {
  categorizeError,
  translateErrorMessage,
  getErrorSuggestion,
  getErrorTitle,
  isRetryableError,
  formatError,
  type ErrorCategory,
} from './errorMessages';

// Navigation module
export {
  NavigationService,
  NavigationServiceProvider,
  useNavigationService,
  useNavigationServiceOptional,
  getNavigationService,
  resetNavigationService,
  EPISODE_FLOWS,
  navigationRules,
  getFlowSteps,
  isScreenInFlow,
  getFlowStepIndex,
  checkNavigationGuard,
  getGuardRules,
  canAccessScreenType,
  getRedirectInfo,
  type NavigationContext,
  type NavigationAction,
  type NavigationEvent,
  type ScreenContextValue,
  type NavigationStoreActions,
  type FlowName,
  type NavigationRules,
  type GuardResult,
  type GuardRule,
} from './navigation';

export {
  trackEvent,
  trackScreenView,
  trackPrimaryAction,
  trackFailure,
} from './analytics';

export {
  saveLastRoute,
  clearLastRoute,
  getLastRoute,
  isRestorableRoute,
  getSafeFallbackRoute,
} from './sessionRestore';
