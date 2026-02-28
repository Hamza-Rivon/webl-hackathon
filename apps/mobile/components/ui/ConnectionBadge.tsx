import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography, borderRadius } from '@/lib/theme';

interface ConnectionBadgeProps {
  connected?: boolean;
  label?: string;
  status?: 'online' | 'syncing' | 'offline';
}

export function ConnectionBadge({ connected = false, label, status }: ConnectionBadgeProps) {
  const tone = status || (connected ? 'online' : 'offline');

  return (
    <View
      style={[
        styles.badge,
        tone === 'online'
          ? styles.badgeOnline
          : tone === 'syncing'
            ? styles.badgeSyncing
            : styles.badgeOffline,
      ]}
    >
      <View
        style={[
          styles.dot,
          tone === 'online'
            ? styles.dotOnline
            : tone === 'syncing'
              ? styles.dotSyncing
              : styles.dotOffline,
        ]}
      />
      <Text numberOfLines={1} style={styles.text}>
        {label || (tone === 'online' ? 'Live updates' : tone === 'syncing' ? 'Syncing' : 'Offline')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    maxWidth: '100%',
    gap: spacing.xs,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
  },
  badgeOnline: {
    borderColor: '#2A6A52',
    backgroundColor: '#10251D',
  },
  badgeOffline: {
    borderColor: '#6A4D2A',
    backgroundColor: '#2A2113',
  },
  badgeSyncing: {
    borderColor: '#2B5C7A',
    backgroundColor: '#132432',
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 999,
  },
  dotOnline: {
    backgroundColor: colors.success,
  },
  dotOffline: {
    backgroundColor: colors.warning,
  },
  dotSyncing: {
    backgroundColor: '#5EB8F2',
  },
  text: {
    color: '#ECFFF7',
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold,
    letterSpacing: 0.2,
    flexShrink: 1,
  },
});

export default ConnectionBadge;
