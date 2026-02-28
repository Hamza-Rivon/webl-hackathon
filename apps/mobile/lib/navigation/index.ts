/**
 * Navigation Module Index
 *
 * Re-exports all navigation-related utilities.
 */

// Navigation Service
export {
  NavigationService,
  getNavigationService,
  resetNavigationService,
  type NavigationContext,
  type NavigationAction,
  type NavigationEvent,
  type ScreenContextValue,
  type NavigationStoreActions,
} from './navigationService';

// Navigation Service Provider and Hook
export {
  NavigationServiceProvider,
  useNavigationService,
  useNavigationServiceOptional,
} from './NavigationServiceProvider';

// Navigation Flows
export {
  EPISODE_FLOWS,
  getFlowSteps,
  isScreenInFlow,
  getFlowStepIndex,
  getNextFlowStep,
  getPreviousFlowStep,
  normalizeScreenName,
  type FlowName,
} from './navigationFlows';

// Navigation Rules
export {
  navigationRules,
  getValidNavigationPaths,
  getAutoNavigateTransitions,
  getStatusToScreenMap,
  getNavigationTargetForTransition,
  type NavigationRules,
} from './navigationRules';

// Navigation Guards
export {
  checkNavigationGuard,
  getGuardRules,
  canAccessScreenType,
  getRedirectInfo,
  type GuardResult,
  type GuardRule,
} from './navigationGuards';
