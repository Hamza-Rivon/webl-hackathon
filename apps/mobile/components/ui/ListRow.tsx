import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@/components/ui/SymbolIcon';
import { colors, spacing, typography } from '@/lib/theme';
import { triggerHaptic } from '@/lib/haptics';

interface ListRowProps {
  icon?: React.ReactNode;
  title: string;
  subtitle?: string;
  value?: string;
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}

export function ListRow({ icon, title, subtitle, value, onPress, accessibilityLabel, accessibilityHint }: ListRowProps) {
  const content = (
    <View style={styles.row}>
      {icon ? <View style={styles.icon}>{icon}</View> : null}
      <View style={styles.textWrap}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {value ? <Text style={styles.value}>{value}</Text> : null}
      {onPress ? <Ionicons name="chevron-forward" size={16} color={colors.text.light} /> : null}
    </View>
  );

  if (!onPress) {
    return <View style={styles.container}>{content}</View>;
  }

  return (
    <Pressable
      style={({ pressed }) => [styles.container, pressed && styles.pressed]}
      onPress={() => {
        triggerHaptic('light');
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || title}
      accessibilityHint={accessibilityHint || subtitle}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  pressed: {
    opacity: 0.82,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  icon: {
    width: 24,
    alignItems: 'center',
  },
  textWrap: {
    flex: 1,
  },
  title: {
    color: colors.text.DEFAULT,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.medium,
  },
  subtitle: {
    marginTop: 2,
    color: colors.text.muted,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
  },
  value: {
    color: colors.text.light,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
  },
});

export default ListRow;
