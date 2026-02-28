import React from 'react';
import { Pressable, StyleSheet, ViewStyle } from 'react-native';
import { colors, borderRadius, shadows } from '@/lib/theme';
import { triggerHaptic } from '@/lib/haptics';

interface IconButtonProps {
  icon: React.ReactNode;
  onPress: () => void;
  accessibilityLabel: string;
  disabled?: boolean;
  style?: ViewStyle;
}

export function IconButton({
  icon,
  onPress,
  accessibilityLabel,
  disabled = false,
  style,
}: IconButtonProps) {
  return (
    <Pressable
      onPress={() => {
        if (disabled) return;
        triggerHaptic('light');
        onPress();
      }}
      style={({ pressed }) => [
        styles.base,
        pressed && !disabled && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
    >
      {icon}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    height: 44,
    width: 44,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
    justifyContent: 'center',
    alignItems: 'center',
    ...shadows.sm,
  },
  pressed: {
    transform: [{ scale: 0.96 }],
  },
  disabled: {
    opacity: 0.45,
  },
});

export default IconButton;
