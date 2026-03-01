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
import { useTheme } from '@/contexts/ThemeContext';
import { triggerHaptic } from '@/lib/haptics';

export type CardVariant =
  | 'default'
  | 'elevated'
  | 'glass'
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
  const { colors: tc, isDark } = useTheme();
  const paddingValue = typeof padding === 'number' ? padding : spacing[padding];

  const variantStyle: ViewStyle =
    variant === 'glass'
      ? {
          backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.85)',
          borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)',
        }
      : variant === 'elevated'
        ? { backgroundColor: tc.panel }
        : variant === 'default'
          ? { backgroundColor: tc.surface }
          : { backgroundColor: tc.pastel[variant.replace('pastel', '').toLowerCase() as keyof typeof tc.pastel] || tc.surface };

  const composed: StyleProp<ViewStyle> = [
    styles.base,
    { borderColor: tc.border, padding: paddingValue },
    variantStyle,
    variant === 'elevated' ? styles.elevated : styles.defaultShadow,
    variant === 'glass' && styles.glass,
    style,
  ];

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
  glass: {
    borderWidth: 1,
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
