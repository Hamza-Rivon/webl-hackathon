import React from 'react';
import {
  Pressable,
  StyleProp,
  StyleSheet,
  View,
  ViewProps,
  ViewStyle,
} from 'react-native';
import { borderRadius, colors, spacing, elevation, surfaceLevels } from '@/lib/theme';
import { triggerHaptic } from '@/lib/haptics';

export type CardVariant =
  | 'default'
  | 'elevated'
  | 'pastelPink'
  | 'pastelBlue'
  | 'pastelGreen'
  | 'pastelYellow'
  | 'pastelPurple'
  | 'pastelOrange';

export interface CardProps extends Omit<ViewProps, 'style'> {
  variant?: CardVariant;
  pressable?: boolean;
  onPress?: () => void;
  haptic?: boolean;
  padding?: keyof typeof spacing | number;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

const variantMap: Record<CardVariant, ViewStyle> = {
  default: { backgroundColor: surfaceLevels.floating },
  elevated: { backgroundColor: surfaceLevels.raised },
  pastelPink: { backgroundColor: colors.pastel.pink },
  pastelBlue: { backgroundColor: colors.pastel.blue },
  pastelGreen: { backgroundColor: colors.pastel.green },
  pastelYellow: { backgroundColor: colors.pastel.yellow },
  pastelPurple: { backgroundColor: colors.pastel.purple },
  pastelOrange: { backgroundColor: colors.pastel.orange },
};

function createCardStyle(variant: CardVariant, padding: keyof typeof spacing | number): StyleProp<ViewStyle> {
  const value = typeof padding === 'number' ? padding : spacing[padding];

  return [
    styles.base,
    variantMap[variant],
    { padding: value },
    variant === 'elevated' ? styles.elevated : styles.defaultShadow,
  ];
}

export function Card({
  variant = 'default',
  pressable = false,
  onPress,
  haptic = true,
  padding = 'lg',
  children,
  style,
  ...props
}: CardProps) {
  const composed = [createCardStyle(variant, padding), style];

  if (pressable) {
    return (
      <Pressable
        style={({ pressed }) => [composed, pressed && styles.pressed]}
        onPress={() => {
          if (haptic) triggerHaptic('light');
          onPress?.();
        }}
        accessibilityRole="button"
        {...props}
      >
        {children}
      </Pressable>
    );
  }

  return (
    <View style={composed} {...props}>
      {children}
    </View>
  );
}

export function CardHeader({ children, style, ...props }: ViewProps) {
  return (
    <View style={[styles.header, style]} {...props}>
      {children}
    </View>
  );
}

export function CardContent({ children, style, ...props }: ViewProps) {
  return (
    <View style={[styles.content, style]} {...props}>
      {children}
    </View>
  );
}

export function CardFooter({ children, style, ...props }: ViewProps) {
  return (
    <View style={[styles.footer, style]} {...props}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  defaultShadow: {
    ...elevation.low,
  },
  elevated: {
    ...elevation.medium,
  },
  pressed: {
    transform: [{ scale: 0.985 }],
  },
  header: {
    marginBottom: spacing.md,
  },
  content: {
    width: '100%',
  },
  footer: {
    marginTop: spacing.md,
    flexDirection: 'row',
    gap: spacing.sm,
  },
});

export default Card;
