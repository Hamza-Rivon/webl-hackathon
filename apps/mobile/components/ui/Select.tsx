/**
 * Neobrutalist Select Component
 *
 * A dropdown select component with bold borders and offset shadows
 * following the neobrutalist soft pop design style.
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  Pressable,
  Modal,
  FlatList,
  StyleSheet,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  FadeIn,
  FadeOut,
} from 'react-native-reanimated';
import { colors, typography, spacing, borderRadius } from '../../lib/theme';
import { triggerHaptic } from '../../lib/haptics';

export interface SelectOption {
  label: string;
  value: string;
  disabled?: boolean;
}

export interface SelectProps {
  /** Select label */
  label?: string;
  /** Placeholder text */
  placeholder?: string;
  /** Options to display */
  options: SelectOption[];
  /** Currently selected value */
  value?: string;
  /** Change handler */
  onChange?: (value: string) => void;
  /** Error message */
  error?: string;
  /** Disabled state */
  disabled?: boolean;
  /** Enable haptic feedback */
  haptic?: boolean;
}

export function Select({
  label,
  placeholder = 'Select an option',
  options,
  value,
  onChange,
  error,
  disabled = false,
  haptic = true,
}: SelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const pressed = useSharedValue(0);

  const selectedOption = options.find((opt) => opt.value === value);

  const animatedStyle = useAnimatedStyle(() => {
    const isPressed = pressed.value === 1;
    return {
      transform: [
        { translateX: isPressed ? 2 : 0 },
        { translateY: isPressed ? 2 : 0 },
      ],
      shadowOffset: {
        width: isPressed ? 2 : 4,
        height: isPressed ? 2 : 4,
      },
    };
  });

  const handlePressIn = () => {
    if (!disabled) {
      pressed.value = withSpring(1, { damping: 15, stiffness: 400 });
    }
  };

  const handlePressOut = () => {
    pressed.value = withSpring(0, { damping: 15, stiffness: 400 });
  };

  const handleOpen = () => {
    if (!disabled) {
      if (haptic) triggerHaptic('light');
      setIsOpen(true);
    }
  };

  const handleSelect = (option: SelectOption) => {
    if (!option.disabled) {
      if (haptic) triggerHaptic('selection');
      onChange?.(option.value);
      setIsOpen(false);
    }
  };

  return (
    <View style={styles.container}>
      {label && (
        <Text style={[styles.label, error && styles.labelError]}>{label}</Text>
      )}
      <Animated.View style={animatedStyle}>
        <Pressable
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          onPress={handleOpen}
          disabled={disabled}
          style={[
            styles.select,
            error && styles.selectError,
            disabled && styles.disabled,
          ]}
          accessibilityRole="combobox"
          accessibilityState={{ disabled, expanded: isOpen }}
        >
          <Text
            style={[
              styles.selectText,
              !selectedOption && styles.placeholder,
            ]}
            numberOfLines={1}
          >
            {selectedOption?.label || placeholder}
          </Text>
          <Text style={styles.chevron}>▼</Text>
        </Pressable>
      </Animated.View>
      {error && <Text style={styles.errorText}>{error}</Text>}

      <Modal
        visible={isOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setIsOpen(false)}
      >
        <Pressable
          style={styles.overlay}
          onPress={() => setIsOpen(false)}
        >
          <Animated.View
            entering={FadeIn.duration(200)}
            exiting={FadeOut.duration(150)}
            style={styles.dropdown}
          >
            <FlatList
              data={options}
              keyExtractor={(item) => item.value}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => handleSelect(item)}
                  disabled={item.disabled}
                  style={[
                    styles.option,
                    item.value === value && styles.optionSelected,
                    item.disabled && styles.optionDisabled,
                  ]}
                >
                  <Text
                    style={[
                      styles.optionText,
                      item.value === value && styles.optionTextSelected,
                      item.disabled && styles.optionTextDisabled,
                    ]}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              )}
              style={styles.optionsList}
            />
          </Animated.View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  label: {
    fontSize: typography.fontSize.sm,
    fontWeight: '600',
    color: colors.text.DEFAULT,
    marginBottom: spacing.sm,
  },
  labelError: {
    color: colors.error,
  },
  select: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    shadowColor: '#000000',
    shadowOpacity: 1,
    shadowRadius: 0,
    elevation: 4,
  },
  selectError: {
    borderColor: colors.error,
  },
  disabled: {
    backgroundColor: colors.background,
    opacity: 0.6,
  },
  selectText: {
    flex: 1,
    fontSize: typography.fontSize.base,
    color: colors.text.DEFAULT,
  },
  placeholder: {
    color: colors.text.muted,
  },
  chevron: {
    fontSize: 12,
    color: colors.text.muted,
    marginLeft: spacing.sm,
  },
  errorText: {
    fontSize: typography.fontSize.sm,
    color: colors.error,
    marginTop: spacing.xs,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  dropdown: {
    width: '100%',
    maxHeight: 300,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: borderRadius.lg,
    shadowColor: '#000000',
    shadowOffset: { width: 6, height: 6 },
    shadowOpacity: 1,
    shadowRadius: 0,
    elevation: 6,
  },
  optionsList: {
    padding: spacing.sm,
  },
  option: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.sm,
  },
  optionSelected: {
    backgroundColor: colors.primary.DEFAULT,
  },
  optionDisabled: {
    opacity: 0.5,
  },
  optionText: {
    fontSize: typography.fontSize.base,
    color: colors.text.DEFAULT,
  },
  optionTextSelected: {
    color: colors.surface,
    fontWeight: '600',
  },
  optionTextDisabled: {
    color: colors.text.muted,
  },
});

export default Select;
