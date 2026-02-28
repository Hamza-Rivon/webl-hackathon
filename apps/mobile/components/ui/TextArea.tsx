import React, { forwardRef, useMemo, useState } from 'react';
import {
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

export interface TextAreaProps extends Omit<TextInputProps, 'style'> {
  label?: string;
  error?: string;
  helperText?: string;
  disabled?: boolean;
  containerStyle?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
  minLines?: number;
}

export const TextArea = forwardRef<TextInput, TextAreaProps>(
  (
    {
      label,
      error,
      helperText,
      disabled = false,
      containerStyle,
      inputStyle,
      minLines = 6,
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
        <View style={[styles.shell, { borderColor, opacity: disabled ? 0.65 : 1 }]}> 
          <TextInput
            ref={ref}
            editable={!disabled}
            multiline
            numberOfLines={minLines}
            textAlignVertical="top"
            placeholderTextColor={colors.text.light}
            style={[styles.input, inputStyle]}
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
        </View>
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        {!error && helperText ? <Text style={styles.helperText}>{helperText}</Text> : null}
      </View>
    );
  }
);

TextArea.displayName = 'TextArea';

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
  shell: {
    borderWidth: 1,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.panel,
    minHeight: 140,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  input: {
    color: colors.text.DEFAULT,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.base,
    lineHeight: 24,
    minHeight: 120,
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
});

export default TextArea;
