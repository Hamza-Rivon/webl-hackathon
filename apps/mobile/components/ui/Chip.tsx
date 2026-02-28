import React from 'react';
import { Pressable, Text, View, StyleSheet, ViewStyle } from 'react-native';
import { colors, typography, spacing, borderRadius, shadows } from '@/lib/theme';
import { triggerHaptic } from '@/lib/haptics';

export type ChipVariant = 'surface' | 'primary' | 'outline';
export type ChipSize = 'sm' | 'md';

export interface ChipProps {
  label: string;
  emoji?: string;
  selected?: boolean;
  disabled?: boolean;
  variant?: ChipVariant;
  size?: ChipSize;
  onPress?: () => void;
  style?: ViewStyle;
}

export function Chip({
  label,
  emoji,
  selected = false,
  disabled = false,
  variant = 'surface',
  size = 'md',
  onPress,
  style,
}: ChipProps) {
  const paddingY = size === 'sm' ? spacing.xs : spacing.sm;
  const paddingX = size === 'sm' ? spacing.sm : spacing.md;

  const resolvedVariant: ChipVariant = selected ? 'primary' : variant;

  return (
    <Pressable
      onPress={() => {
        if (disabled) return;
        triggerHaptic('light');
        onPress?.();
      }}
      accessibilityRole="button"
      accessibilityState={{ disabled, selected }}
      style={({ pressed }) => [
        styles.base,
        {
          paddingVertical: paddingY,
          paddingHorizontal: paddingX,
          opacity: disabled ? 0.5 : 1,
          transform: [{ translateX: pressed ? 1 : 0 }, { translateY: pressed ? 1 : 0 }],
        },
        resolvedVariant === 'surface' && styles.surface,
        resolvedVariant === 'outline' && styles.outline,
        resolvedVariant === 'primary' && styles.primary,
        !disabled && resolvedVariant !== 'surface' && styles.shadow,
        style,
      ]}
    >
      <View style={styles.content}>
        {emoji ? <Text style={styles.emoji}>{emoji}</Text> : null}
        <Text
          style={[
            styles.label,
            resolvedVariant === 'primary' && styles.labelPrimary,
          ]}
          numberOfLines={1}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderWidth: 2,
    borderRadius: borderRadius.full,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  emoji: {
    fontSize: 14,
  },
  label: {
    fontSize: typography.fontSize.sm,
    fontWeight: '600',
    color: colors.text.DEFAULT,
  },
  labelPrimary: {
    color: colors.surface,
  },
  surface: {
    backgroundColor: colors.background,
  },
  outline: {
    backgroundColor: colors.surface,
  },
  primary: {
    backgroundColor: colors.primary.DEFAULT,
    borderColor: colors.border,
  },
  shadow: {
    ...shadows.sm,
  },
});

export default Chip;
