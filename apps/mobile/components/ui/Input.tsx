import React, { forwardRef, useMemo, useState } from 'react';
import {
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import { borderRadius, colors, spacing, typography } from '@/lib/theme';

export interface InputProps extends Omit<TextInputProps, 'style'> {
  label?: string;
  error?: string;
  helperText?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  disabled?: boolean;
  containerStyle?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
  accessibilityHint?: string;
}

export const Input = forwardRef<TextInput, InputProps>(
  (
    {
      label,
      error,
      helperText,
      leftIcon,
      rightIcon,
      disabled = false,
      containerStyle,
      inputStyle,
      accessibilityHint,
      onFocus,
      onBlur,
      ...props
    },
    ref
  ) => {
    const [focused, setFocused] = useState(false);

    const borderColor = useMemo(() => {
      if (error) return colors.error;
      if (focused) return colors.primary.DEFAULT;
      return colors.border;
    }, [error, focused]);

    return (
      <View style={containerStyle}>
        {label ? <Text style={[styles.label, error && styles.labelError]}>{label}</Text> : null}
        <View
          style={[
            styles.inputShell,
            {
              borderColor,
              opacity: disabled ? 0.65 : 1,
            },
          ]}
        >
          {leftIcon ? <View style={styles.iconLeft}>{leftIcon}</View> : null}
          <TextInput
            ref={ref}
            editable={!disabled}
            placeholderTextColor={colors.text.light}
            style={[styles.input, inputStyle]}
            accessibilityLabel={label || props.placeholder || 'Input field'}
            accessibilityHint={accessibilityHint || helperText}
            accessibilityState={{ disabled }}
            onFocus={(event) => {
              setFocused(true);
              onFocus?.(event);
            }}
            onBlur={(event) => {
              setFocused(false);
              onBlur?.(event);
            }}
            {...props}
          />
          {rightIcon ? <View style={styles.iconRight}>{rightIcon}</View> : null}
        </View>
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        {!error && helperText ? <Text style={styles.helperText}>{helperText}</Text> : null}
      </View>
    );
  }
);

Input.displayName = 'Input';

export interface PasswordInputProps extends Omit<InputProps, 'secureTextEntry' | 'rightIcon'> {
  showToggle?: boolean;
}

export const PasswordInput = forwardRef<TextInput, PasswordInputProps>(
  ({ showToggle = true, ...props }, ref) => {
    const [showPassword, setShowPassword] = useState(false);

    return (
      <Input
        ref={ref}
        secureTextEntry={!showPassword}
        rightIcon={
          showToggle ? (
            <Pressable onPress={() => setShowPassword((value) => !value)} hitSlop={8}>
              <Text style={styles.toggleText}>{showPassword ? 'Hide' : 'Show'}</Text>
            </Pressable>
          ) : null
        }
        {...props}
      />
    );
  }
);

PasswordInput.displayName = 'PasswordInput';

const styles = StyleSheet.create({
  label: {
    color: colors.text.muted,
    marginBottom: spacing.sm,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
  },
  labelError: {
    color: colors.error,
  },
  inputShell: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.panel,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    color: colors.text.DEFAULT,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.base,
    paddingVertical: spacing.md,
  },
  iconLeft: {
    marginRight: spacing.sm,
  },
  iconRight: {
    marginLeft: spacing.sm,
  },
  errorText: {
    marginTop: spacing.xs,
    color: colors.error,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
  },
  helperText: {
    marginTop: spacing.xs,
    color: colors.text.light,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
  },
  toggleText: {
    color: colors.primary.light,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
  },
});

export default Input;
