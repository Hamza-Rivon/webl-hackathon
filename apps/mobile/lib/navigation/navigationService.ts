/* eslint-disable max-lines */
/**
 * Navigation Service
 *
 * Centralized service that manages all navigation in the app.
 * Prevents conflicts and coordinates navigation actions through a queue system.
 *
 * Requirements: 1.1-1.10
 */

import { Router } from 'expo-router';
import { Alert } from 'react-native';
import { EPISODE_FLOWS, type FlowName } from './navigationFlows';
import { navigationRules } from './navigationRules';
import { checkNavigationGuard, type GuardResult } from './navigationGuards';

/**
 * Navigation context containing current state
 * Requirements: 1.3
 */
export interface NavigationContext {
  currentScreen: string | null;
  navigationStack: string[];
  isNavigating: boolean;
  pendingNavigation: NavigationAction | null;
}

/**
 * Navigation action with type, route, params, priority, and condition
 * Requirements: 1.4, 1.6
 */
export interface NavigationAction {
  id: string;
  type: 'push' | 'replace' | 'back';
  route: string;
  params?: Record<string, unknown>;
  priority: 'high' | 'normal' | 'low';
  condition?: () => boolean;
  timestamp: number;
}

/**
 * Screen context value interface for coordination
 * Requirements: 5.1-5.9
 */
export interface ScreenContextValue {
  currentScreen: string | null;
  isUserActive: boolean;
  canNavigate: boolean;
  blockedReason: string | null;
}

/**
 * Navigation event for history tracking
 * Requirements: 13.1-13.5
 */
export interface NavigationEvent {
  type: 'push' | 'replace' | 'back';
  route: string;
  timestamp: number;
  success: boolean;
  error?: string;
  duration?: number; // Time to navigate in ms
  queueWaitTime?: number; // Time spent in queue in ms
}

/**
 * Performance metrics for navigation
 * Requirements: 13.7
 */
export interface NavigationMetrics {
  totalNavigations: number;
  successfulNavigations: number;
  failedNavigations: number;
  totalQueueWaitTime: number;
  totalNavigationTime: number;
  averageQueueWaitTime: number;
  averageNavigationTime: number;
  errorRate: number;
  commonErrors: Array<{ error: string; count: number }>;
  conflicts: number; // Number of navigation conflicts detected
}

/**
 * Navigation conflict information
 * Requirements: 13.3
 */
export interface NavigationConflict {
  timestamp: number;
  conflictingActions: NavigationAction[];
  reason: string;
}

/**
 * Navigation store interface for state persistence
 * Requirements: 10.1-10.8
 */
export interface NavigationStoreActions {
  setCurrentScreen: (screen: string | null) => void;
  pushToStack: (screen: string) => void;
  popFromStack: () => string | null;
  setIsNavigating: (isNavigating: boolean) => void;
  setPendingNavigation: (action: NavigationAction | null) => void;
  addToHistory: (event: NavigationEvent) => void;
  clearStack: () => void;
  getNavigationHistory: () => NavigationEvent[];
}

// Generate unique action ID
function generateActionId(): string {
  return `nav_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * NavigationService class - singleton that manages all navigation
 * Requirements: 1.1-1.10
 */
export class NavigationService {
  private context: NavigationContext;
  private queue: NavigationAction[] = [];
  private router: Router | null = null;
  private screenContext: ScreenContextValue | null = null;
  private store: NavigationStoreActions | null = null;
  private showToast: ((message: string, type?: 'info' | 'error' | 'success') => void) | null = null;
  private isProcessingQueue = false;

  // Queue limits
  private static readonly MAX_QUEUE_SIZE = 50;
  private static readonly MAX_STACK_SIZE = 20;

  // Analytics and debugging
  // Requirements: 13.1-13.7
  private metrics: NavigationMetrics = {
    totalNavigations: 0,
    successfulNavigations: 0,
    failedNavigations: 0,
    totalQueueWaitTime: 0,
    totalNavigationTime: 0,
    averageQueueWaitTime: 0,
    averageNavigationTime: 0,
    errorRate: 0,
    commonErrors: [],
    conflicts: 0,
  };
  private conflicts: NavigationConflict[] = [];
  private errorCounts: Map<string, number> = new Map();
  private actionQueueTimes: Map<string, number> = new Map(); // Track when action was queued

  constructor() {
    this.context = {
      currentScreen: null,
      navigationStack: [],
      isNavigating: false,
      pendingNavigation: null,
    };
  }

  private getRouteKey(route: string): string {
    return route.replace(/\/+$/, '');
  }

  /**
   * Initialize the service with router and store
   */
  initialize(
    router: Router,
    store: NavigationStoreActions,
    showToast?: (message: string, type?: 'info' | 'error' | 'success') => void
  ): void {
    this.router = router;
    this.store = store;
    this.showToast = showToast || null;
  }

  /**
   * Set screen context for coordination with ScreenProvider
   * Requirements: 5.8, 5.9
   */
  setScreenContext(context: ScreenContextValue): void {
    this.screenContext = context;
  }

  /**
   * Set current screen
   */
  setCurrentScreen(screen: string | null): void {
    this.context.currentScreen = screen;
    this.store?.setCurrentScreen(screen);
  }

  /**
   * Get current screen
   * Requirements: 1.3
   */
  getCurrentScreen(): string | null {
    return this.context.currentScreen;
  }

  /**
   * Get navigation stack
   * Requirements: 1.7
   */
  getNavigationStack(): string[] {
    return [...this.context.navigationStack];
  }

  /**
   * Check if navigation is in progress
   * Requirements: 1.8
   */
  isNavigationInProgress(): boolean {
    return this.context.isNavigating;
  }


  // ============================================
  // Core Navigation Methods
  // Requirements: 1.2
  // ============================================

  /**
   * Navigate to episode detail screen
   * Requirements: 10.6 - Clear stack when navigating to new episode
   */
  async navigateToEpisode(
    episodeId: string,
    options?: { replace?: boolean; clearStack?: boolean }
  ): Promise<void> {
    // Clear navigation stack when navigating to a new episode
    // This prevents stale navigation history from previous episodes
    // Requirements: 10.6
    if (options?.clearStack !== false) {
      // Check if we're navigating to a different episode
      const currentEpisodeMatch = this.context.currentScreen?.match(/episode\/([^/]+)/);
      const currentEpisodeId = currentEpisodeMatch?.[1];
      
      if (currentEpisodeId && currentEpisodeId !== episodeId) {
        this.context.navigationStack = [];
        this.store?.clearStack();
        this.logNavigation('stack', 'cleared', `Navigating to new episode: ${episodeId}`);
      }
    }

    const route = `/(main)/episode/${episodeId}`;
    const action: NavigationAction = {
      id: generateActionId(),
      type: options?.replace ? 'replace' : 'push',
      route,
      params: { id: episodeId },
      priority: 'normal',
      timestamp: Date.now(),
    };
    await this.enqueueNavigation(action);
  }

  /**
   * Navigate to record voiceover screen
   */
  async navigateToRecord(episodeId: string): Promise<void> {
    const route = `/(main)/episode/${episodeId}/record`;
    const action: NavigationAction = {
      id: generateActionId(),
      type: 'push',
      route,
      params: { id: episodeId },
      priority: 'normal',
      timestamp: Date.now(),
    };
    await this.enqueueNavigation(action);
  }

  /**
   * Navigate to slots screen
   */
  async navigateToSlots(episodeId: string): Promise<void> {
    const route = `/(main)/episode/${episodeId}/slots`;
    const action: NavigationAction = {
      id: generateActionId(),
      type: 'push',
      route,
      params: { id: episodeId },
      priority: 'normal',
      timestamp: Date.now(),
    };
    await this.enqueueNavigation(action);
  }

  /**
   * Navigate to processing screen
   */
  async navigateToProcessing(episodeId: string): Promise<void> {
    const route = `/(main)/episode/${episodeId}/processing`;
    const action: NavigationAction = {
      id: generateActionId(),
      type: 'push',
      route,
      params: { id: episodeId },
      priority: 'normal',
      timestamp: Date.now(),
    };
    await this.enqueueNavigation(action);
  }

  /**
   * Navigate to preview screen
   */
  async navigateToPreview(episodeId: string): Promise<void> {
    const route = `/(main)/episode/${episodeId}/preview`;
    const action: NavigationAction = {
      id: generateActionId(),
      type: 'push',
      route,
      params: { id: episodeId },
      priority: 'normal',
      timestamp: Date.now(),
    };
    await this.enqueueNavigation(action);
  }

  /**
   * Generic navigate method for custom routes
   * Useful for sub-routes like slot upload/record screens
   */
  async navigate(route: string, options?: { replace?: boolean; priority?: 'high' | 'normal' | 'low' }): Promise<void> {
    const action: NavigationAction = {
      id: generateActionId(),
      type: options?.replace ? 'replace' : 'push',
      route,
      priority: options?.priority || 'normal',
      timestamp: Date.now(),
    };
    await this.enqueueNavigation(action);
  }

  /**
   * Navigate back
   * Requirements: 12.1-12.8
   */
  async navigateBack(episodeStatus?: string): Promise<void> {
    // Check if navigation is blocked
    if (this.screenContext && !this.screenContext.canNavigate) {
      this.logNavigation('back', 'blocked', `Navigation blocked: ${this.screenContext.blockedReason}`);
      if (this.showToast && this.screenContext.blockedReason) {
        this.showToast(this.screenContext.blockedReason, 'info');
      }
      return;
    }

    // Check for blocking state and show confirmation if needed
    // Requirements: 12.5 - Check if episode is in blocking state
    const isBlockingState = episodeStatus ? this.isBlockingStatus(episodeStatus) : false;
    const isUserActive = this.screenContext?.isUserActive || false;
    
    if (isBlockingState || isUserActive) {
      const confirmed = await this.showBackConfirmation();
      if (!confirmed) {
        return;
      }
    }

    // Requirements: 12.1, 12.2 - Check Navigation_Stack for previous screen
    const stack = this.getNavigationStack();
    
    if (stack.length > 0) {
      // Requirements: 12.2 - If stack has previous screen, navigate to it and pop from stack
      const previousScreen = stack[stack.length - 1];
      this.logNavigation('back', 'stack', `Navigating to previous screen: ${previousScreen}`);
      
      // Pop from stack before navigating (we're going back, so remove current screen)
      this.context.navigationStack.pop();
      this.store?.popFromStack();
      
      // Navigate to previous screen using replace (not push, since we're going back)
      const action: NavigationAction = {
        id: generateActionId(),
        type: 'replace',
        route: previousScreen,
        priority: 'high',
        timestamp: Date.now(),
      };
      await this.enqueueNavigation(action);
    } else {
      // Requirements: 12.2 - If stack is empty, use router.back() for native back behavior
      this.logNavigation('back', 'native', 'Stack empty, using native back');
      
      const action: NavigationAction = {
        id: generateActionId(),
        type: 'back',
        route: 'back',
        priority: 'high',
        timestamp: Date.now(),
      };
      await this.enqueueNavigation(action);
    }
  }

  /**
   * Check if episode status is a blocking state
   * Requirements: 12.5
   */
  private isBlockingStatus(status: string): boolean {
    const blockingStatuses = [
      'voiceover_uploaded',
      'voiceover_cleaning',
      'chunking_clips',
      'enriching_chunks',
      'matching',
      'rendering',
    ];
    return blockingStatuses.includes(status);
  }

  /**
   * Show confirmation dialog for back navigation during blocking state
   * Requirements: 12.5
   */
  private showBackConfirmation(): Promise<boolean> {
    return new Promise((resolve) => {
      Alert.alert(
        'Processing in progress',
        'Are you sure you want to leave? Your progress may be lost.',
        [
          { text: 'Stay', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Leave', style: 'destructive', onPress: () => resolve(true) },
        ]
      );
    });
  }


  // ============================================
  // Status-Based Navigation
  // Requirements: 2.3-2.8, 4.1-4.9
  // ============================================

  /**
   * Handle status change and determine if navigation is needed
   * Requirements: 4.1-4.9
   */
  async handleStatusChange(
    episodeId: string,
    oldStatus: string,
    newStatus: string
  ): Promise<void> {
    // Check if auto-navigation is appropriate
    if (!this.shouldAutoNavigate(oldStatus, newStatus, this.context.currentScreen || '')) {
      this.logNavigation('status_change', 'skipped', `No auto-navigation for ${oldStatus} -> ${newStatus}`);
      return;
    }

    // Check screen context
    if (this.screenContext?.isUserActive) {
      this.logNavigation('status_change', 'deferred', 'User is active');
      return;
    }

    if (this.screenContext && !this.screenContext.canNavigate) {
      this.logNavigation('status_change', 'blocked', this.screenContext.blockedReason || 'Navigation blocked');
      return;
    }

    // Determine target screen based on status
    const targetScreen = navigationRules.getNextScreen(this.context.currentScreen || '', newStatus);
    
    if (!targetScreen) {
      this.logNavigation('status_change', 'skipped', `No target screen for status ${newStatus}`);
      return;
    }

    // Navigate to target screen
    const route = targetScreen.replace('[id]', episodeId);
    const action: NavigationAction = {
      id: generateActionId(),
      type: 'replace',
      route,
      params: { id: episodeId },
      priority: 'high',
      timestamp: Date.now(),
    };

    await this.enqueueNavigation(action);
  }

  /**
   * Check if auto-navigation should occur for a status transition
   * Requirements: 2.4, 4.3
   */
  shouldAutoNavigate(
    fromStatus: string,
    toStatus: string,
    currentScreen: string
  ): boolean {
    // Use navigation rules to determine if auto-navigation is appropriate
    const shouldNavigate = navigationRules.shouldAutoNavigate(fromStatus, toStatus);
    
    if (!shouldNavigate) {
      return false;
    }

    // Check if user is on the expected screen for this transition
    const expectedScreen = navigationRules.getScreenForStatus(fromStatus);
    if (expectedScreen) {
      const normalizedExpected = expectedScreen.replace('/(main)/', '');
      const normalizedCurrent = currentScreen
        .replace('/(main)/', '')
        .replace(/episode\/[^/]+/g, 'episode/[id]');

      if (!normalizedCurrent.includes(normalizedExpected)) {
      // User is on a different screen, skip auto-navigation
        return false;
      }
    }

    return true;
  }

  // ============================================
  // Guard Navigation
  // Requirements: 6.1-6.10
  // ============================================

  /**
   * Check navigation guard and return result
   * Requirements: 6.1-6.3
   */
  guardNavigation(screen: string, episodeId: string, status: string): GuardResult {
    return checkNavigationGuard(screen, episodeId, status);
  }

  /**
   * Check if screen is accessible
   * Requirements: 6.1
   */
  checkAccess(screen: string, episodeId: string, status: string): boolean {
    const result = this.guardNavigation(screen, episodeId, status);
    return result.canAccess;
  }

  /**
   * Navigate with guard check
   * Requirements: 6.4, 6.5, 6.9
   */
  async navigateWithGuard(
    screen: string,
    episodeId: string,
    status: string
  ): Promise<boolean> {
    const guardResult = this.guardNavigation(screen, episodeId, status);

    if (!guardResult.canAccess) {
      // Show toast with explanation
      if (guardResult.explanation && this.showToast) {
        this.showToast(guardResult.explanation, 'info');
      }

      // Redirect to appropriate screen
      if (guardResult.redirectTarget) {
        await this.navigate(`/(main)/${guardResult.redirectTarget}`, { replace: true, priority: 'high' });
      }

      return false;
    }

    return true;
  }


  // ============================================
  // Queue Management
  // Requirements: 1.4, 1.5, 1.8, 1.9, 11.1-11.9
  // ============================================

  /**
   * Enqueue a navigation action
   * Requirements: 1.4, 11.1, 11.8, 11.9
   */
  async enqueueNavigation(action: NavigationAction): Promise<void> {
    if (action.type !== 'back') {
      const nextRouteKey = this.getRouteKey(action.route);
      const currentRouteKey = this.context.currentScreen
        ? this.getRouteKey(this.context.currentScreen)
        : null;

      if (currentRouteKey && currentRouteKey === nextRouteKey) {
        this.logNavigation(
          action.type,
          'skipped',
          `Route already active, skipping duplicate navigation: ${action.route}`
        );
        return;
      }

      const pending = this.context.pendingNavigation;
      if (pending && this.getRouteKey(pending.route) === nextRouteKey && pending.type === action.type) {
        this.logNavigation(
          action.type,
          'skipped',
          `Same route already pending, skipping duplicate navigation: ${action.route}`
        );
        return;
      }

      const existsInQueue = this.queue.some(
        (queued) => queued.type === action.type && this.getRouteKey(queued.route) === nextRouteKey
      );
      if (existsInQueue) {
        this.logNavigation(
          action.type,
          'skipped',
          `Route already queued, skipping duplicate navigation: ${action.route}`
        );
        return;
      }
    }

    // Track when action is queued for performance metrics
    // Requirements: 13.7
    this.actionQueueTimes.set(action.id, Date.now());

    // Check for navigation conflicts
    // Requirements: 13.3 - Log navigation conflicts when multiple actions attempt to execute
    if (this.context.isNavigating && this.context.pendingNavigation) {
      const conflict: NavigationConflict = {
        timestamp: Date.now(),
        conflictingActions: [this.context.pendingNavigation, action],
        reason: `Navigation in progress: ${this.context.pendingNavigation.route}, new action: ${action.route}`,
      };
      this.conflicts.push(conflict);
      this.metrics.conflicts++;
      
      // Keep only last 20 conflicts
      if (this.conflicts.length > 20) {
        this.conflicts.shift();
      }

      this.logNavigation(action.type, 'conflict', `Conflict detected: ${conflict.reason}`);
      
      if (__DEV__) {
        console.warn('[NavigationService] Navigation conflict detected', {
          currentAction: this.context.pendingNavigation,
          newAction: action,
          timestamp: conflict.timestamp,
        });
      }
    }

    // Check queue size limit
    // Requirements: 11.8, 11.9
    if (this.queue.length >= NavigationService.MAX_QUEUE_SIZE) {
      // Reject low-priority actions when queue is full
      if (action.priority === 'low') {
        // Requirements: 11.9 - Log warning when queue is full
        this.logNavigation(action.type, 'rejected', `Queue full (${this.queue.length}/${NavigationService.MAX_QUEUE_SIZE}), rejecting low-priority action: ${action.route}`);
        if (__DEV__) {
          console.warn('[NavigationService] Queue full, rejecting low-priority action', {
            route: action.route,
            priority: action.priority,
            queueSize: this.queue.length,
            maxSize: NavigationService.MAX_QUEUE_SIZE,
          });
        }
        return;
      }
      // Remove oldest low-priority action to make room for higher priority action
      const lowPriorityIndex = this.queue.findIndex(a => a.priority === 'low');
      if (lowPriorityIndex !== -1) {
        const removedAction = this.queue.splice(lowPriorityIndex, 1)[0];
        this.logNavigation(removedAction.type, 'removed', `Removed low-priority action to make room: ${removedAction.route}`);
      }
    }

    // Add to queue
    // Requirements: 11.1 - Add to queue if another navigation is in progress
    this.queue.push(action);
    this.logNavigation(action.type, 'queued', `Route: ${action.route}, Priority: ${action.priority}, Queue size: ${this.queue.length}`);

    // Process queue if not already processing
    if (!this.isProcessingQueue && !this.context.isNavigating) {
      await this.processQueue();
    }
  }

  /**
   * Process the navigation queue
   * Requirements: 1.5, 11.1-11.5
   */
  async processQueue(): Promise<void> {
    // Requirements: 11.1 - Don't process if another navigation is in progress
    if (this.isProcessingQueue || this.context.isNavigating) {
      return;
    }

    if (this.queue.length === 0) {
      return;
    }

    this.isProcessingQueue = true;

    try {
      // Requirements: 11.2, 11.3 - Sort by priority (high > normal > low), then by timestamp (FIFO)
      this.queue.sort((a, b) => {
        const priorityOrder = { high: 3, normal: 2, low: 1 };
        const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
        if (priorityDiff !== 0) return priorityDiff;
        // FIFO within same priority level
        return a.timestamp - b.timestamp;
      });

      // Get next action
      const action = this.queue.shift();
      if (!action) {
        this.isProcessingQueue = false;
        return;
      }

      // Requirements: 11.5 - Skip queued actions that have invalid conditions
      if (action.condition && !action.condition()) {
        this.logNavigation(action.type, 'skipped', `Condition not met for route: ${action.route}`);
        this.isProcessingQueue = false;
        // Process next action
        await this.processQueue();
        return;
      }

      // Check screen context before executing
      // Requirements: 11.1 - Check if navigation is allowed
      if (this.screenContext && !this.screenContext.canNavigate) {
        // Re-queue the action at the front to retry later
        this.queue.unshift(action);
        this.logNavigation(action.type, 'deferred', `Navigation blocked by screen context: ${this.screenContext.blockedReason || 'unknown reason'}`);
        this.isProcessingQueue = false;
        return;
      }

      // Requirements: 11.1, 11.4 - Execute navigation (sets isNavigating flag)
      await this.executeNavigation(action);

    } finally {
      this.isProcessingQueue = false;
    }

    // Requirements: 11.4 - Process next action after current completes (isNavigating becomes false)
    if (this.queue.length > 0) {
      await this.processQueue();
    }
  }

  /**
   * Execute a navigation action
   * Requirements: 1.5, 13.5, 13.7
   */
  private async executeNavigation(action: NavigationAction): Promise<void> {
    if (!this.router) {
      console.error('[NavigationService] Router not initialized');
      return;
    }

    this.context.isNavigating = true;
    this.store?.setIsNavigating(true);
    this.context.pendingNavigation = action;
    this.store?.setPendingNavigation(action);

    const startTime = Date.now();
    
    // Calculate queue wait time
    // Requirements: 13.7 - Track queue wait time
    const queueTime = this.actionQueueTimes.get(action.id);
    const queueWaitTime = queueTime ? startTime - queueTime : 0;
    this.actionQueueTimes.delete(action.id);

    // Update metrics
    this.metrics.totalNavigations++;

    try {
      switch (action.type) {
        case 'push':
          // Preserve the current route as the back target before pushing.
          // This keeps back navigation deterministic across episode sub-screens.
          if (this.context.currentScreen) {
            this.context.navigationStack.push(this.context.currentScreen);
            if (this.context.navigationStack.length > NavigationService.MAX_STACK_SIZE) {
              this.context.navigationStack.shift();
            }
            this.store?.pushToStack(this.context.currentScreen);
          }

          this.router.push(action.route as any);
          break;

        case 'replace':
          this.router.replace(action.route as any);
          // Replace doesn't add to stack
          break;

        case 'back':
          this.router.back();
          break;
      }

      // Update current screen
      if (action.type !== 'back') {
        this.context.currentScreen = action.route;
        this.store?.setCurrentScreen(action.route);
      }

      // Calculate navigation duration
      // Requirements: 13.7 - Track time to navigate
      const duration = Date.now() - startTime;
      
      // Update metrics for successful navigation
      this.metrics.successfulNavigations++;
      this.metrics.totalNavigationTime += duration;
      this.metrics.totalQueueWaitTime += queueWaitTime;
      this.updateAverageMetrics();

      // Log success
      this.logNavigation(action.type, 'success', `Route: ${action.route}, Duration: ${duration}ms, Queue wait: ${queueWaitTime}ms`);

      // Add to history with performance data
      // Requirements: 13.4, 13.7
      this.store?.addToHistory({
        type: action.type,
        route: action.route,
        timestamp: Date.now(),
        success: true,
        duration,
        queueWaitTime,
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      // Update metrics for failed navigation
      // Requirements: 13.5 - Track error rate and common failure patterns
      this.metrics.failedNavigations++;
      this.updateErrorTracking(errorMessage);
      this.updateAverageMetrics();

      // Log error with details
      // Requirements: 13.5 - Log navigation failures with route, params, and error message
      this.logNavigation(action.type, 'error', `Route: ${action.route}, Params: ${JSON.stringify(action.params)}, Error: ${errorMessage}`);

      if (__DEV__) {
        console.error('[NavigationService] Navigation error', {
          action,
          error: errorMessage,
          route: action.route,
          params: action.params,
          timestamp: Date.now(),
        });
      }

      // Add to history with error
      const duration = Date.now() - startTime;
      this.store?.addToHistory({
        type: action.type,
        route: action.route,
        timestamp: Date.now(),
        success: false,
        error: errorMessage,
        duration,
        queueWaitTime,
      });

      // Attempt recovery - navigate to safe fallback
      if (action.params?.id) {
        try {
          this.router.push(`/(main)/episode/${action.params.id}` as any);
        } catch {
          // Ignore recovery errors
        }
      }

    } finally {
      this.context.isNavigating = false;
      this.store?.setIsNavigating(false);
      this.context.pendingNavigation = null;
      this.store?.setPendingNavigation(null);
    }
  }

  /**
   * Clear the navigation queue
   * Requirements: 1.9, 11.6, 11.7
   */
  clearQueue(): void {
    const clearedCount = this.queue.length;
    const hasCurrentAction = this.context.isNavigating && this.context.pendingNavigation !== null;
    
    // Requirements: 11.7 - Cancel all queued actions except the currently executing one
    // The currently executing action is tracked in context.pendingNavigation and will complete
    // We only clear the queue, not the currently executing action
    this.queue = [];
    
    if (clearedCount > 0) {
      this.logNavigation('queue', 'cleared', `Cleared ${clearedCount} pending action(s)${hasCurrentAction ? ' (current action continues)' : ''}`);
      
      if (__DEV__) {
        console.log('[NavigationService] Queue cleared', {
          clearedCount,
          hasCurrentAction,
          currentAction: hasCurrentAction ? this.context.pendingNavigation : null,
        });
      }
    }
  }


  // ============================================
  // Flow Helpers
  // Requirements: 2.1, 2.2, 2.5, 2.6
  // ============================================

  /**
   * Get the next step in the current flow
   * Requirements: 2.5
   */
  getNextStep(episodeId: string, currentStatus: string): string | null {
    const nextScreen = navigationRules.getNextScreen(
      this.context.currentScreen || '',
      currentStatus
    );
    
    if (nextScreen) {
      return nextScreen.replace('[id]', episodeId);
    }
    
    return null;
  }

  /**
   * Navigate to the next step in the flow
   * Requirements: 2.6
   */
  async navigateToNextStep(episodeId: string, currentStatus: string): Promise<void> {
    const nextStep = this.getNextStep(episodeId, currentStatus);
    
    if (!nextStep) {
      this.logNavigation('flow', 'skipped', 'No next step available');
      return;
    }

    const action: NavigationAction = {
      id: generateActionId(),
      type: 'push',
      route: nextStep,
      params: { id: episodeId },
      priority: 'normal',
      timestamp: Date.now(),
    };

    await this.enqueueNavigation(action);
  }

  /**
   * Get flow for a given flow name
   * Requirements: 2.1
   */
  getFlow(flowName: FlowName): readonly string[] {
    return EPISODE_FLOWS[flowName];
  }

  // ============================================
  // Logging and Analytics
  // Requirements: 13.1-13.7
  // ============================================

  /**
   * Log navigation event
   * Requirements: 13.1-13.3
   */
  private logNavigation(
    action: string,
    status: 'queued' | 'success' | 'error' | 'skipped' | 'deferred' | 'blocked' | 'cleared' | 'conflict' | 'stack' | 'native' | 'rejected' | 'removed',
    details: string
  ): void {
    if (__DEV__) {
      const timestamp = new Date().toISOString();
      console.log(`[NavigationService] [${timestamp}] ${action.toUpperCase()} - ${status}: ${details}`);
    }
  }

  /**
   * Update error tracking for common failure patterns
   * Requirements: 13.5
   */
  private updateErrorTracking(errorMessage: string): void {
    const count = this.errorCounts.get(errorMessage) || 0;
    this.errorCounts.set(errorMessage, count + 1);
    
    // Update common errors list (keep top 10)
    this.metrics.commonErrors = Array.from(this.errorCounts.entries())
      .map(([error, count]) => ({ error, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }

  /**
   * Update average metrics
   * Requirements: 13.7
   */
  private updateAverageMetrics(): void {
    if (this.metrics.totalNavigations > 0) {
      this.metrics.averageNavigationTime = this.metrics.totalNavigationTime / this.metrics.totalNavigations;
      this.metrics.averageQueueWaitTime = this.metrics.totalQueueWaitTime / this.metrics.totalNavigations;
      this.metrics.errorRate = (this.metrics.failedNavigations / this.metrics.totalNavigations) * 100;
    }
  }

  /**
   * Get navigation history
   * Requirements: 13.4
   */
  getNavigationHistory(): NavigationEvent[] {
    return this.store?.getNavigationHistory() || [];
  }

  /**
   * Get performance metrics
   * Requirements: 13.7
   */
  getMetrics(): NavigationMetrics {
    return { ...this.metrics };
  }

  /**
   * Get navigation conflicts
   * Requirements: 13.3
   */
  getConflicts(): NavigationConflict[] {
    return [...this.conflicts];
  }

  /**
   * Reset metrics (for testing)
   */
  resetMetrics(): void {
    this.metrics = {
      totalNavigations: 0,
      successfulNavigations: 0,
      failedNavigations: 0,
      totalQueueWaitTime: 0,
      totalNavigationTime: 0,
      averageQueueWaitTime: 0,
      averageNavigationTime: 0,
      errorRate: 0,
      commonErrors: [],
      conflicts: 0,
    };
    this.conflicts = [];
    this.errorCounts.clear();
  }

  /**
   * Get queue status for debugging
   * Requirements: 13.6
   */
  getDebugInfo(): {
    currentScreen: string | null;
    stackSize: number;
    queueSize: number;
    isNavigating: boolean;
    pendingAction: NavigationAction | null;
    metrics: NavigationMetrics;
    recentConflicts: number;
  } {
    return {
      currentScreen: this.context.currentScreen,
      stackSize: this.context.navigationStack.length,
      queueSize: this.queue.length,
      isNavigating: this.context.isNavigating,
      pendingAction: this.context.pendingNavigation,
      metrics: this.getMetrics(),
      recentConflicts: this.conflicts.length,
    };
  }
}

// Singleton instance
let navigationServiceInstance: NavigationService | null = null;

/**
 * Get the singleton NavigationService instance
 */
export function getNavigationService(): NavigationService {
  if (!navigationServiceInstance) {
    navigationServiceInstance = new NavigationService();
  }
  return navigationServiceInstance;
}

/**
 * Reset the singleton (for testing)
 */
export function resetNavigationService(): void {
  navigationServiceInstance = null;
}

export default NavigationService;
