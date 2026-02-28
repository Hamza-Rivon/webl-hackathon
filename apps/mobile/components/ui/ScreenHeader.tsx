import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, typography, spacing } from '@/lib/theme';

export interface ScreenHeaderProps {
  title: string;
  subtitle?: string;
  left?: React.ReactNode;
  right?: React.ReactNode;
  bordered?: boolean;
  style?: ViewStyle;
}

export function ScreenHeader({
  title,
  subtitle,
  left,
  right,
  bordered = false,
  style,
}: ScreenHeaderProps) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.container,
        { paddingTop: Math.max(insets.top, 14) + spacing.sm },
        bordered && styles.bordered,
        style,
      ]}
    >
      <View style={styles.row}>
        <View style={styles.side}>{left}</View>
        <View style={styles.center}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={styles.subtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        <View style={[styles.side, styles.sideRight]}>{right}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    backgroundColor: colors.surface,
  },
  bordered: {
    borderBottomWidth: 2,
    borderBottomColor: colors.border,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  side: {
    width: 56,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  sideRight: {
    alignItems: 'flex-end',
  },
  center: {
    flex: 1,
    alignItems: 'center',
  },
  title: {
    fontSize: typography.fontSize['2xl'],
    fontWeight: '800',
    color: colors.text.DEFAULT,
  },
  subtitle: {
    marginTop: spacing.xs,
    fontSize: typography.fontSize.sm,
    color: colors.text.muted,
    fontWeight: '600',
  },
});

export default ScreenHeader;
