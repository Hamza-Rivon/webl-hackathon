/**
 * Haptic Feedback Utility
 *
 * Provides haptic feedback for interactive components using expo-haptics.
 * Wraps expo-haptics with a simple API for common feedback patterns.
 */

import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

export type HapticType =
  | 'light'
  | 'medium'
  | 'heavy'
  | 'rigid'
  | 'soft'
  | 'selection'
  | 'success'
  | 'warning'
  | 'error';

export type HapticActionType =
  | 'navigation'
  | 'success'
  | 'warning'
  | 'destructive'
  | 'selection'
  | 'emphasis';

/**
 * Trigger haptic feedback
 *
 * @param type - The type of haptic feedback to trigger
 */
export async function triggerHaptic(type: HapticType = 'light'): Promise<void> {
  // Haptics only work on native platforms
  if (Platform.OS === 'web') {
    return;
  }

  try {
    switch (type) {
      case 'light':
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        break;
      case 'medium':
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        break;
      case 'heavy':
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        break;
      case 'rigid':
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid);
        break;
      case 'soft':
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft);
        break;
      case 'selection':
        await Haptics.selectionAsync();
        break;
      case 'success':
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        break;
      case 'warning':
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        break;
      case 'error':
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        break;
      default:
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  } catch (error) {
    // Silently fail if haptics are not available
    console.warn('Haptic feedback not available:', error);
  }
}

/**
 * Hook for haptic feedback with memoized trigger function
 */
export function useHaptics() {
  return {
    light: () => triggerHaptic('light'),
    medium: () => triggerHaptic('medium'),
    heavy: () => triggerHaptic('heavy'),
    rigid: () => triggerHaptic('rigid'),
    soft: () => triggerHaptic('soft'),
    selection: () => triggerHaptic('selection'),
    success: () => triggerHaptic('success'),
    warning: () => triggerHaptic('warning'),
    error: () => triggerHaptic('error'),
  };
}

export async function triggerActionHaptic(action: HapticActionType): Promise<void> {
  if (action === 'navigation') {
    await triggerHaptic('light');
    return;
  }
  if (action === 'success') {
    await triggerHaptic('success');
    return;
  }
  if (action === 'warning') {
    await triggerHaptic('warning');
    return;
  }
  if (action === 'destructive') {
    await triggerHaptic('error');
    return;
  }
  if (action === 'selection') {
    await triggerHaptic('selection');
    return;
  }
  await triggerHaptic('medium');
}

export default triggerHaptic;
