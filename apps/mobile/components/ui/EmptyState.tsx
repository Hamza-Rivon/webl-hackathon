import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { Card } from '@/components/ui/Card';
import { colors, typography, spacing } from '@/lib/theme';

export interface EmptyStateProps {
  emoji?: string;
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  variant?: 'default' | 'pastelBlue' | 'pastelYellow' | 'pastelGreen' | 'pastelPink' | 'pastelPurple' | 'pastelOrange';
  style?: ViewStyle;
}

export function EmptyState({
  emoji,
  icon,
  title,
  description,
  action,
  variant = 'default',
  style,
}: EmptyStateProps) {
  return (
    <Card variant={variant as any} style={[styles.card, style]}>
      {icon ? icon : emoji ? <Text style={styles.emoji}>{emoji}</Text> : null}
      <Text style={styles.title}>{title}</Text>
      {description ? <Text style={styles.description}>{description}</Text> : null}
      {action ? <View style={styles.action}>{action}</View> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: 'center',
    padding: spacing['2xl'],
  },
  emoji: {
    fontSize: 54,
    marginBottom: spacing.md,
  },
  title: {
    fontSize: typography.fontSize.lg,
    fontWeight: '800',
    color: colors.text.DEFAULT,
    textAlign: 'center',
  },
  description: {
    marginTop: spacing.sm,
    fontSize: typography.fontSize.base,
    color: colors.text.muted,
    textAlign: 'center',
    lineHeight: 22,
  },
  action: {
    marginTop: spacing.xl,
    alignSelf: 'stretch',
  },
});

export default EmptyState;
