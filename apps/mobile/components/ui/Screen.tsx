import React from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ScrollViewProps,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import { Edge, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/contexts/ThemeContext';
import { spacing } from '@/lib/theme';

interface ScreenProps {
  children: React.ReactNode;
  scroll?: boolean;
  contentContainerStyle?: ScrollViewProps['contentContainerStyle'];
  style?: ViewStyle;
  keyboardOffset?: number;
  topInset?: boolean;
}

export function Screen({
  children,
  scroll = true,
  contentContainerStyle,
  style,
  keyboardOffset = 0,
  topInset = true,
}: ScreenProps) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const flattenedContentStyle = StyleSheet.flatten(contentContainerStyle) || {};
  const resolvedPaddingBottom = Math.max(
    Number(flattenedContentStyle.paddingBottom || 0),
    insets.bottom + spacing.xl
  );
  const resolvedContentStyle: ScrollViewProps['contentContainerStyle'] = [
    contentContainerStyle,
    { paddingBottom: resolvedPaddingBottom },
  ];

  const bg = { backgroundColor: colors.background };

  const body = scroll ? (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={resolvedContentStyle}
      contentInsetAdjustmentBehavior={topInset ? 'automatic' : 'never'}
      automaticallyAdjustKeyboardInsets
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.flex, style]}>{children}</View>
  );
  const safeEdges: Edge[] = topInset ? ['top', 'left', 'right', 'bottom'] : ['left', 'right', 'bottom'];

  return (
    <SafeAreaView edges={safeEdges} style={[styles.safe, bg, style]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={keyboardOffset}
      >
        {body}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
});

export default Screen;
