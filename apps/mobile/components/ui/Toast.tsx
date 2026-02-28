/**
 * Neobrutalist Toast Component
 *
 * A toast notification component with bold borders and offset shadows
 * following the neobrutalist soft pop design style.
 */

import React, { createContext, useContext, useState, useCallback } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Animated, {
  FadeInUp,
  FadeOutUp,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { colors, typography, spacing, borderRadius } from '../../lib/theme';
import { triggerHaptic } from '../../lib/haptics';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastData {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
}

interface ToastContextValue {
  toasts: ToastData[];
  showToast: (toast: Omit<ToastData, 'id'>) => void;
  hideToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/**
 * Toast Provider - Wrap your app with this to enable toasts
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastData[]>([]);

  const showToast = useCallback((toast: Omit<ToastData, 'id'>) => {
    const id = Math.random().toString(36).substring(7);
    const newToast: ToastData = { ...toast, id };

    // Trigger haptic based on type
    const hapticMap: Record<ToastType, 'success' | 'error' | 'warning' | 'light'> = {
      success: 'success',
      error: 'error',
      warning: 'warning',
      info: 'light',
    };
    triggerHaptic(hapticMap[toast.type]);

    setToasts((prev) => [...prev, newToast]);

    // Auto dismiss
    const duration = toast.duration ?? 4000;
    if (duration > 0) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, duration);
    }
  }, []);

  const hideToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, showToast, hideToast }}>
      {children}
      <ToastContainer />
    </ToastContext.Provider>
  );
}

/**
 * Hook to use toast functionality
 */
export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}

/**
 * Toast Container - Renders all active toasts
 */
function ToastContainer() {
  const { toasts, hideToast } = useToast();

  return (
    <View style={styles.container} pointerEvents="box-none">
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onDismiss={() => hideToast(toast.id)} />
      ))}
    </View>
  );
}

/**
 * Individual Toast Component
 */
interface ToastProps {
  toast: ToastData;
  onDismiss: () => void;
}

const typeStyles: Record<ToastType, { backgroundColor: string; icon: string }> = {
  success: { backgroundColor: colors.success, icon: '✓' },
  error: { backgroundColor: colors.error, icon: '✕' },
  warning: { backgroundColor: colors.warning, icon: '!' },
  info: { backgroundColor: colors.info, icon: 'i' },
};

function Toast({ toast, onDismiss }: ToastProps) {
  const pressed = useSharedValue(0);
  const typeStyle = typeStyles[toast.type] || typeStyles.info;

  const animatedStyle = useAnimatedStyle(() => {
    const isPressed = pressed.value === 1;
    return {
      transform: [
        { scale: isPressed ? 0.98 : 1 },
      ],
    };
  });

  const handlePressIn = () => {
    pressed.value = withSpring(1, { damping: 15, stiffness: 400 });
  };

  const handlePressOut = () => {
    pressed.value = withSpring(0, { damping: 15, stiffness: 400 });
  };

  return (
    <Animated.View
      entering={FadeInUp.springify().damping(15)}
      exiting={FadeOutUp.duration(200)}
      style={[styles.toast, animatedStyle]}
    >
      <Pressable
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onPress={onDismiss}
        style={styles.toastContent}
      >
        <View
          style={[styles.iconContainer, { backgroundColor: typeStyle.backgroundColor }]}
        >
          <Text style={styles.icon}>{typeStyle.icon}</Text>
        </View>
        <View style={styles.textContainer}>
          <Text style={styles.title}>{toast.title}</Text>
          {toast.message && (
            <Text style={styles.message} numberOfLines={2}>
              {toast.message}
            </Text>
          )}
        </View>
        <Pressable
          onPress={onDismiss}
          hitSlop={8}
          style={styles.dismissButton}
          accessibilityLabel="Dismiss notification"
          accessibilityRole="button"
        >
          <Text style={styles.dismissText}>✕</Text>
        </Pressable>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 60,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 9999,
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  toast: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: borderRadius.lg,
    shadowColor: '#000000',
    shadowOffset: { width: 4, height: 4 },
    shadowOpacity: 1,
    shadowRadius: 0,
    elevation: 4,
  },
  toastContent: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    gap: spacing.md,
  },
  iconContainer: {
    width: 32,
    height: 32,
    borderRadius: borderRadius.sm,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.surface,
  },
  textContainer: {
    flex: 1,
  },
  title: {
    fontSize: typography.fontSize.base,
    fontWeight: '600',
    color: colors.text.DEFAULT,
  },
  message: {
    fontSize: typography.fontSize.sm,
    color: colors.text.muted,
    marginTop: 2,
  },
  dismissButton: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dismissText: {
    fontSize: 14,
    color: colors.text.muted,
    fontWeight: '600',
  },
});

export default Toast;
