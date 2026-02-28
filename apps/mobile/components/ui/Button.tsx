import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  PressableProps,
  StyleProp,
  StyleSheet,
  Text,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { colors, borderRadius, spacing, typography, opacity, shadows } from '@/lib/theme';
import { triggerHaptic } from '@/lib/haptics';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<PressableProps, 'style'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: React.ReactNode;
  loading?: boolean;
  disabled?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  haptic?: boolean;
  className?: string;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  fullWidth?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}

const variantMap: Record<ButtonVariant, { backgroundColor: string; borderColor: string; textColor: string }> = {
  primary: {
    backgroundColor: colors.primary.DEFAULT,
    borderColor: colors.primary.dark,
    textColor: colors.text.inverse,
  },
  secondary: {
    backgroundColor: colors.secondary.DEFAULT,
    borderColor: colors.secondary.dark,
    textColor: colors.text.inverse,
  },
  outline: {
    backgroundColor: '#F5F9FF',
    borderColor: '#B9C9DC',
    textColor: colors.text.DEFAULT,
  },
  ghost: {
    backgroundColor: '#EEF4FF',
    borderColor: '#D6E3F2',
    textColor: colors.text.DEFAULT,
  },
  danger: {
    backgroundColor: colors.error,
    borderColor: '#A72840',
    textColor: colors.text.inverse,
  },
};

const sizeMap: Record<ButtonSize, { minHeight: number; paddingX: number; fontSize: number }> = {
  sm: { minHeight: 44, paddingX: spacing.md, fontSize: typography.fontSize.sm },
  md: { minHeight: 48, paddingX: spacing.lg, fontSize: typography.fontSize.base },
  lg: { minHeight: 54, paddingX: spacing.xl, fontSize: typography.fontSize.lg },
};

function renderContent(children: React.ReactNode, textStyle: StyleProp<TextStyle>) {
  if (typeof children === 'string' || typeof children === 'number') {
    return <Text style={textStyle}>{children}</Text>;
  }

  if (Array.isArray(children) && children.every((item) => item == null || typeof item === 'string' || typeof item === 'number')) {
    return <Text style={textStyle}>{children}</Text>;
  }

  return children;
}

export function Button({
  variant = 'primary',
  size = 'md',
  children,
  loading = false,
  disabled = false,
  leftIcon,
  rightIcon,
  haptic = true,
  onPress,
  style,
  textStyle,
  fullWidth = true,
  accessibilityLabel,
  accessibilityHint,
  ...props
}: ButtonProps) {
  const token = variantMap[variant];
  const sizeToken = sizeMap[size];
  const isDisabled = disabled || loading;

  const scaleValue = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scaleValue.value }],
  }));

  const handlePressIn = () => {
    if (!isDisabled) {
      scaleValue.value = withSpring(0.97, { damping: 15, stiffness: 400 });
    }
  };

  const handlePressOut = () => {
    if (!isDisabled) {
      scaleValue.value = withSpring(1, { damping: 12, stiffness: 300 });
    }
  };

  const handlePress = (event: any) => {
    if (haptic && !isDisabled) {
      triggerHaptic('light');
    }
    // Subtle bounce on press
    scaleValue.value = withSequence(
      withTiming(0.96, { duration: 60 }),
      withSpring(1, { damping: 10, stiffness: 350 })
    );
    onPress?.(event);
  };

  return (
    <Animated.View style={[animatedStyle, fullWidth && styles.fullWidth, style]}>
      <Pressable
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        disabled={isDisabled}
        style={[
          styles.base,
          fullWidth && styles.fullWidth,
          {
            minHeight: sizeToken.minHeight,
            paddingHorizontal: sizeToken.paddingX,
            backgroundColor: token.backgroundColor,
            borderColor: token.borderColor,
            opacity: isDisabled ? opacity.disabled : 1,
          },
          styles.shadow,
        ]}
        accessibilityRole="button"
        accessibilityState={{ disabled: isDisabled }}
        accessibilityLabel={
          accessibilityLabel ||
          (typeof children === 'string' || typeof children === 'number' ? String(children) : undefined)
        }
        accessibilityHint={accessibilityHint}
        {...props}
      >
        {loading ? (
          <ActivityIndicator color={token.textColor} />
        ) : (
          <View style={styles.content}>
            {leftIcon ? <View style={styles.iconLeft}>{leftIcon}</View> : null}
            {children != null ? renderContent(children, [styles.text, { color: token.textColor, fontSize: sizeToken.fontSize }, textStyle]) : null}
            {rightIcon ? <View style={styles.iconRight}>{rightIcon}</View> : null}
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderWidth: 1,
    borderRadius: borderRadius.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullWidth: {
    width: '100%',
  },
  shadow: {
    ...shadows.sm,
  },
  pressed: {
    shadowOpacity: 0.02,
    elevation: 0,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    fontFamily: typography.fontFamily.body,
    fontWeight: typography.fontWeight.semibold,
    letterSpacing: 0.2,
  },
  iconLeft: {
    marginRight: spacing.sm,
  },
  iconRight: {
    marginLeft: spacing.sm,
  },
});

export default Button;
