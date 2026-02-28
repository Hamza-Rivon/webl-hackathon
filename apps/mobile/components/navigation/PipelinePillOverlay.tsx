import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@/components/ui/SymbolIcon';
import { useActivityEpisodes, flattenActivityEpisodePages } from '@/hooks/useActivity';
import { triggerHaptic } from '@/lib/haptics';
import { borderRadius, colors, shadows, spacing, typography } from '@/lib/theme';
import { useNotificationStore } from '@/stores/notifications';

function formatJobLabel(type: string) {
  return type.replaceAll('_', ' ');
}

export function PipelinePillOverlay() {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const shouldHideOverlay =
    pathname?.includes('/(main)/jobs') ||
    pathname?.includes('/(tabs)/jobs') ||
    pathname?.includes('/(tabs)/activity') ||
    pathname?.includes('/jobs') ||
    pathname?.includes('/activity') ||
    pathname?.includes('/(main)/notifications') ||
    pathname?.includes('/onboarding');
  const episodesQuery = useActivityEpisodes({
    mode: 'active',
    limit: 8,
    enabled: !shouldHideOverlay,
  });
  const unreadNotifications = useNotificationStore((state) => state.unreadCount);

  const [expanded, setExpanded] = useState(false);
  const episodes = useMemo(
    () => flattenActivityEpisodePages(episodesQuery.data),
    [episodesQuery.data]
  );

  const counts = useMemo(() => {
    return episodes.reduce(
      (acc, episode) => {
        acc.active += episode.counts.active + episode.counts.pending;
        acc.failed += episode.counts.failed;
        return acc;
      },
      { active: 0, failed: 0 }
    );
  }, [episodes]);

  if (counts.active === 0 && counts.failed === 0) {
    return null;
  }

  if (shouldHideOverlay) {
    return null;
  }

  const leadEpisode = episodes[0];
  const leadLabel = leadEpisode?.latestJob?.type
    ? formatJobLabel(leadEpisode.latestJob.type)
    : leadEpisode?.title || 'Activity';

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.container,
        {
          bottom: Math.max(insets.bottom + 106, pathname?.includes('/episode/') ? 146 : 120),
        },
      ]}
    >
      <View style={styles.shell}>
        <Pressable
          style={styles.pill}
          onPress={() => {
            triggerHaptic('light');
            setExpanded((current) => !current);
          }}
          accessibilityRole="button"
          accessibilityLabel="Open pipeline command center"
        >
          <View style={styles.leftCluster}>
            <View style={[styles.dot, counts.failed > 0 ? styles.dotError : styles.dotActive]} />
            <Text style={styles.count}>{counts.active} active</Text>
            <Text style={styles.separator}>•</Text>
            <Text style={[styles.count, counts.failed > 0 && styles.failedCount]}>{counts.failed} failed</Text>
          </View>
          <Text numberOfLines={1} style={styles.label}>{leadLabel}</Text>
          {unreadNotifications > 0 ? (
            <View style={styles.notificationBadge}>
              <Text style={styles.notificationBadgeText}>{unreadNotifications > 99 ? '99+' : unreadNotifications}</Text>
            </View>
          ) : null}
          <Ionicons name={expanded ? 'chevron-down' : 'chevron-forward'} size={14} color={colors.text.light} />
        </Pressable>

        {expanded ? (
          <View style={styles.expandedPanel}>
            <Pressable
              style={styles.quickAction}
              onPress={() => {
                triggerHaptic('selection');
                router.push('/(main)/jobs');
                setExpanded(false);
              }}
            >
              <Ionicons name="pulse-outline" size={14} color={colors.text.DEFAULT} />
              <Text style={styles.quickActionText}>Open Activity</Text>
            </Pressable>
            <Pressable
              style={styles.quickAction}
              onPress={() => {
                triggerHaptic('selection');
                if (leadEpisode?.episodeId) {
                  router.push(`/(main)/episode/${leadEpisode.episodeId}`);
                }
                setExpanded(false);
              }}
              disabled={!leadEpisode?.episodeId}
            >
              <Ionicons name="film-outline" size={14} color={colors.text.DEFAULT} />
              <Text style={styles.quickActionText}>Open Lead Episode</Text>
            </Pressable>
            <Pressable
              style={styles.quickAction}
              onPress={() => {
                triggerHaptic('selection');
                router.push('/(main)/notifications' as never);
                setExpanded(false);
              }}
            >
              <Ionicons name="notifications-outline" size={14} color={colors.text.DEFAULT} />
              <Text style={styles.quickActionText}>Notifications</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    right: spacing.lg,
    left: spacing.lg,
    alignItems: 'flex-end',
  },
  shell: {
    width: '100%',
    alignItems: 'flex-end',
    gap: spacing.xs,
  },
  pill: {
    width: '100%',
    minHeight: 44,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panelAlt,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    ...shadows.md,
  },
  leftCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  separator: {
    color: colors.text.light,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.xs,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: borderRadius.full,
  },
  dotActive: {
    backgroundColor: colors.primary.DEFAULT,
  },
  dotError: {
    backgroundColor: colors.error,
  },
  count: {
    color: colors.text.DEFAULT,
    fontFamily: typography.fontFamily.mono,
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold,
  },
  failedCount: {
    color: colors.error,
  },
  label: {
    flex: 1,
    color: colors.text.muted,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.xs,
    textTransform: 'capitalize',
  },
  expandedPanel: {
    width: '100%',
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.sm,
    gap: spacing.xs,
    ...shadows.md,
  },
  quickAction: {
    minHeight: 36,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  quickActionText: {
    color: colors.text.DEFAULT,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
  },
  notificationBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 999,
    backgroundColor: colors.error,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  notificationBadgeText: {
    color: colors.text.inverse,
    fontFamily: typography.fontFamily.mono,
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.bold,
  },
});

export default PipelinePillOverlay;
