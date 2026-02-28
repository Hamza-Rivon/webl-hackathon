/**
 * Neobrutalist Modal Component
 *
 * A modal dialog component with bold borders and offset shadows
 * following the neobrutalist soft pop design style.
 */

import React from 'react';
import {
  View,
  Text,
  Pressable,
  Modal as RNModal,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import Animated, { FadeIn, FadeOut, SlideInDown, SlideOutDown } from 'react-native-reanimated';
import { colors, typography, spacing, borderRadius } from '../../lib/theme';
import { triggerHaptic } from '../../lib/haptics';

export interface ModalProps {
  /** Whether the modal is visible */
  visible: boolean;
  /** Close handler */
  onClose: () => void;
  /** Modal title */
  title?: string;
  /** Modal content */
  children: React.ReactNode;
  /** Show close button */
  showCloseButton?: boolean;
  /** Close on backdrop press */
  closeOnBackdrop?: boolean;
  /** Enable haptic feedback */
  haptic?: boolean;
  /** Modal size */
  size?: 'sm' | 'md' | 'lg' | 'full';
}

const sizeStyles = {
  sm: { maxWidth: 320 },
  md: { maxWidth: 400 },
  lg: { maxWidth: 500 },
  full: { maxWidth: '95%' as const },
};

export function Modal({
  visible,
  onClose,
  title,
  children,
  showCloseButton = true,
  closeOnBackdrop = true,
  haptic = true,
  size = 'md',
}: ModalProps) {
  const handleClose = () => {
    if (haptic) triggerHaptic('light');
    onClose();
  };

  const handleBackdropPress = () => {
    if (closeOnBackdrop) {
      handleClose();
    }
  };

  return (
    <RNModal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={handleClose}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <Animated.View
          entering={FadeIn.duration(100)}
          exiting={FadeOut.duration(100)}
          style={styles.overlay}
        >
          <Pressable
            style={styles.backdrop}
            onPress={handleBackdropPress}
          />
          <Animated.View
            entering={SlideInDown.duration(150)}
            exiting={SlideOutDown.duration(150)}
            style={[styles.modal, sizeStyles[size]]}
          >
            {(title || showCloseButton) && (
              <View style={styles.header}>
                {title && <Text style={styles.title}>{title}</Text>}
                {showCloseButton && (
                  <Pressable
                    onPress={handleClose}
                    style={styles.closeButton}
                    hitSlop={8}
                    accessibilityLabel="Close modal"
                    accessibilityRole="button"
                  >
                    <Text style={styles.closeText}>✕</Text>
                  </Pressable>
                )}
              </View>
            )}
            <ScrollView
              style={styles.content}
              showsVerticalScrollIndicator={false}
            >
              {children}
            </ScrollView>
          </Animated.View>
        </Animated.View>
      </KeyboardAvoidingView>
    </RNModal>
  );
}

/**
 * Modal Footer Component
 */
export function ModalFooter({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: object;
}) {
  return <View style={[styles.footer, style]}>{children}</View>;
}

/**
 * Confirmation Modal
 */
export interface ConfirmModalProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'default' | 'danger';
  disabled?: boolean;
}

export function ConfirmModal({
  visible,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'default',
  disabled = false,
}: ConfirmModalProps) {
  const handleConfirm = () => {
    if (disabled) return;
    triggerHaptic(variant === 'danger' ? 'warning' : 'success');
    onConfirm();
    onClose();
  };

  return (
    <Modal visible={visible} onClose={onClose} title={title} size="sm">
      <Text style={styles.message}>{message}</Text>
      <ModalFooter>
        <Pressable
          onPress={onClose}
          style={styles.cancelButton}
          accessibilityRole="button"
        >
          <Text style={styles.cancelButtonText}>{cancelText}</Text>
        </Pressable>
        <Pressable
          onPress={handleConfirm}
          disabled={disabled}
          style={[
            styles.confirmButton,
            variant === 'danger' && styles.confirmButtonDanger,
            disabled && styles.confirmButtonDisabled,
          ]}
          accessibilityRole="button"
          accessibilityState={{ disabled }}
        >
          <Text style={[styles.confirmButtonText, disabled && styles.confirmButtonTextDisabled]}>
            {confirmText}
          </Text>
        </Pressable>
      </ModalFooter>
    </Modal>
  );
}

const styles = StyleSheet.create({
  keyboardView: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modal: {
    width: '90%',
    maxHeight: '80%',
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: borderRadius.xl,
    shadowColor: '#000000',
    shadowOffset: { width: 8, height: 8 },
    shadowOpacity: 1,
    shadowRadius: 0,
    elevation: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 2,
    borderBottomColor: colors.border,
  },
  title: {
    flex: 1,
    fontSize: typography.fontSize.xl,
    fontWeight: '700',
    color: colors.text.DEFAULT,
  },
  closeButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.background,
  },
  closeText: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text.DEFAULT,
  },
  content: {
    padding: spacing.lg,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.md,
    marginTop: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 2,
    borderTopColor: colors.border,
  },
  message: {
    fontSize: typography.fontSize.base,
    color: colors.text.DEFAULT,
    lineHeight: 24,
  },
  cancelButton: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surface,
  },
  cancelButtonText: {
    fontSize: typography.fontSize.base,
    fontWeight: '600',
    color: colors.text.DEFAULT,
  },
  confirmButton: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    backgroundColor: colors.primary.DEFAULT,
    shadowColor: '#000000',
    shadowOffset: { width: 4, height: 4 },
    shadowOpacity: 1,
    shadowRadius: 0,
    elevation: 4,
  },
  confirmButtonDanger: {
    backgroundColor: colors.error,
  },
  confirmButtonDisabled: {
    opacity: 0.5,
  },
  confirmButtonText: {
    fontSize: typography.fontSize.base,
    fontWeight: '600',
    color: colors.surface,
  },
  confirmButtonTextDisabled: {
    opacity: 0.7,
  },
});

export default Modal;
