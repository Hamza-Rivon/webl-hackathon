/* eslint-disable max-lines */
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { usePathname, useRouter } from 'expo-router';
import { Ionicons } from '@/components/ui/SymbolIcon';
import {
  Button,
  Card,
  ConnectionBadge,
  EmptyState,
  Screen,
  Skeleton,
} from '@/components/ui';
import {
  flattenActivityEpisodePages,
  useActivityEpisodes,
  type ActivityEpisodeSummary,
} from '@/hooks/useActivity';
import { useActivityRealtime } from '@/hooks/useActivityRealtime';
import { useJobs } from '@/hooks/useJobProgress';
import { colors, spacing, typography, borderRadius } from '@/lib/theme';
import { groupJobsByPhase } from '@/lib/pipeline';
import { trackScreenView } from '@/lib/analytics';

function formatStatus(value: string): string {
  return value.replaceAll('_', ' ');
}

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString();
}

function priorityLabel(priority: ActivityEpisodeSummary['priority']) {
  if (priority === 'needs_attention') return 'Needs Action';
  if (priority === 'in_progress') return 'Processing';
  if (priority === 'needs_input') return 'Needs Input';
  if (priority === 'recently_completed') return 'Recent';
  return 'History';
}

function priorityColor(priority: ActivityEpisodeSummary['priority']) {
  if (priority === 'needs_attention') return colors.error;
  if (priority === 'in_progress') return colors.primary.DEFAULT;
  if (priority === 'needs_input') return colors.warning;
  if (priority === 'recently_completed') return colors.success;
  return colors.text.muted;
}

function sectionLabel(priority: ActivityEpisodeSummary['priority']) {
  if (priority === 'needs_attention') return 'Needs Attention';
  if (priority === 'in_progress') return 'In Progress';
  if (priority === 'needs_input') return 'Waiting For Input';
  if (priority === 'recently_completed') return 'Recently Completed';
  return 'History';
}

function phaseStatusLabel(phase: { status: string; latestJob: any; activeCount: number; failedCount: number }): string {
  if (phase.status === 'done') return 'Complete';
  if (phase.status === 'error') return `Failed`;
  if (phase.status === 'active') return `Processing${phase.latestJob ? ` ${phase.latestJob.progress}%` : ''}`;
  return '—';
}

function EpisodeCard({
  item,
  expanded,
  onToggle,
  onOpen,
}: {
  item: ActivityEpisodeSummary;
  expanded: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const jobsQuery = useJobs(
    { episodeId: item.episodeId },
    { enabled: expanded, staleTime: 20_000 }
  );

  const phaseSummaries = useMemo(
    () => (jobsQuery.data ? groupJobsByPhase(jobsQuery.data).filter((p) => p.totalJobs > 0) : []),
    [jobsQuery.data]
  );

  const failedTotal = item.counts.failed;
  const activeTotal = item.counts.active;

  return (
    <Card variant={item.priority === 'needs_attention' ? 'pastelPink' : item.priority === 'in_progress' ? 'pastelBlue' : 'default'}>
      <Pressable onPress={onToggle} style={styles.episodeHeader}>
        <View style={styles.episodeHeaderTextWrap}>
          <Text style={styles.episodeTitle}>{item.title}</Text>
          <Text style={styles.episodeMeta}>{formatStatus(item.status)} · {formatTimestamp(item.updatedAt)}</Text>
          {(failedTotal > 0 || activeTotal > 0) ? (
            <View style={styles.countRow}>
              {failedTotal > 0 ? (
                <Text style={[styles.countChip, styles.countChipError]}>{failedTotal} failed</Text>
              ) : null}
              {activeTotal > 0 ? (
                <Text style={[styles.countChip, styles.countChipActive]}>{activeTotal} active</Text>
              ) : null}
            </View>
          ) : null}
        </View>

        <View style={styles.headerRightWrap}>
          <Text style={[styles.priorityBadge, { borderColor: priorityColor(item.priority), color: priorityColor(item.priority) }]}>
            {priorityLabel(item.priority)}
          </Text>
          <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={colors.text.light} />
        </View>
      </Pressable>

      <View style={styles.episodeActionRow}>
        <Button variant="ghost" size="sm" onPress={onOpen} style={styles.actionBtn}>Open Episode</Button>
      </View>

      {expanded ? (
        <View style={styles.expandedWrap}>
          {jobsQuery.isLoading ? (
            <View style={styles.phaseLoadingStack}>
              <Skeleton height={28} radius="sm" />
              <Skeleton height={28} radius="sm" />
              <Skeleton height={28} radius="sm" />
            </View>
          ) : jobsQuery.isError ? (
            <Text style={styles.phaseHintText}>Unable to load jobs.</Text>
          ) : phaseSummaries.length === 0 ? (
            <Text style={styles.phaseHintText}>No pipeline jobs yet.</Text>
          ) : (
            <View style={styles.phaseSummaryWrap}>
              {phaseSummaries.map((phase) => (
                <View key={phase.phase} style={styles.phaseRow}>
                  <View style={[styles.phaseDot, { backgroundColor: phase.status === 'idle' ? colors.border : phase.color }]} />
                  <Text style={styles.phaseLabel}>{phase.label}</Text>
                  <Text style={[
                    styles.phaseStatusText,
                    phase.status === 'done' && styles.phaseStatusDone,
                    phase.status === 'error' && styles.phaseStatusError,
                    phase.status === 'active' && styles.phaseStatusActive,
                  ]}>
                    {phaseStatusLabel(phase)}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>
      ) : null}
    </Card>
  );
}

type Row =
  | { kind: 'section'; id: string; title: string }
  | { kind: 'episode'; id: string; item: ActivityEpisodeSummary };

export default function JobsScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const isFocused =
    pathname === '/jobs' ||
    pathname === '/activity' ||
    pathname.includes('/(tabs)/jobs') ||
    pathname.includes('/(tabs)/activity');
  const episodesQuery = useActivityEpisodes({ mode: 'active', limit: 12, enabled: isFocused });

  const items = useMemo(() => flattenActivityEpisodePages(episodesQuery.data), [episodesQuery.data]);
  const [expandedEpisodeIds, setExpandedEpisodeIds] = useState<Set<string>>(new Set());

  const realtime = useActivityRealtime({
    enabled: isFocused,
    episodeIds: [...expandedEpisodeIds],
  });

  // Show "Live" when data is loaded (REST works), regardless of WebSocket state.
  // Only show "Syncing" during initial load before data arrives.
  // WebSocket is a nice-to-have for real-time updates, not required for basic display.
  const hasData = !episodesQuery.isLoading && items.length > 0;
  const dataLoaded = !episodesQuery.isLoading;

  const connectionBadgeStatus: 'online' | 'syncing' | 'offline' =
    realtime.connectionState === 'connected'
      ? 'online'
      : dataLoaded
        ? 'online'   // REST data loaded — show online even without WebSocket
        : 'syncing';  // Still loading initial data

  const connectionBadgeLabel =
    realtime.connectionState === 'connected'
      ? 'Live'
      : dataLoaded
        ? 'Online'
        : 'Loading';

  useEffect(() => {
    trackScreenView('jobs');
  }, []);

  const rows = useMemo<Row[]>(() => {
    if (items.length === 0) return [];

    const grouped: Record<ActivityEpisodeSummary['priority'], ActivityEpisodeSummary[]> = {
      needs_attention: [],
      in_progress: [],
      needs_input: [],
      recently_completed: [],
      history: [],
    };

    items.forEach((item) => {
      grouped[item.priority].push(item);
    });

    const order: ActivityEpisodeSummary['priority'][] = [
      'needs_attention',
      'in_progress',
      'needs_input',
      'recently_completed',
      'history',
    ];

    const next: Row[] = [];
    order.forEach((priority) => {
      const sectionItems = grouped[priority];
      if (sectionItems.length === 0) return;

      next.push({
        kind: 'section',
        id: `section:${priority}`,
        title: sectionLabel(priority),
      });

      sectionItems.forEach((item) => {
        next.push({
          kind: 'episode',
          id: item.episodeId,
          item,
        });
      });
    });

    return next;
  }, [items]);

  const renderHeader = (
    <View style={styles.headerWrap}>
      <View style={styles.headerRow}>
        <View style={styles.pageHeaderText}>
          <Text style={styles.title}>Activity</Text>
          <Text style={styles.subtitle}>Grouped by episode, showing only what matters now.</Text>
        </View>
        <ConnectionBadge status={connectionBadgeStatus} label={connectionBadgeLabel} />
      </View>

      {episodesQuery.isLoading ? (
        <View style={styles.loadingStack}>
          <Skeleton height={126} radius="lg" />
          <Skeleton height={126} radius="lg" />
        </View>
      ) : null}
    </View>
  );

  if (!episodesQuery.isLoading && items.length === 0) {
    return (
      <Screen contentContainerStyle={styles.content}>
        {renderHeader}
        <EmptyState
          title="All clear"
          description="No episodes currently need attention. Create or process an episode to see pipeline activity here."
          icon={<Ionicons name="checkmark-circle-outline" size={46} color={colors.success} />}
          action={<Button onPress={() => router.push('/(main)/episode/new')}>Create Episode</Button>}
        />
      </Screen>
    );
  }

  return (
    <Screen scroll={false}>
      <FlashList
        data={rows}
        extraData={expandedEpisodeIds}
        keyExtractor={(row) => row.id}
        contentContainerStyle={styles.content}
        ListHeaderComponent={renderHeader}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        showsVerticalScrollIndicator={false}
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (episodesQuery.hasNextPage && !episodesQuery.isFetchingNextPage) {
            void episodesQuery.fetchNextPage();
          }
        }}
        renderItem={({ item }) => {
          if (item.kind === 'section') {
            return <Text style={styles.sectionTitle}>{item.title}</Text>;
          }

          const expanded = expandedEpisodeIds.has(item.item.episodeId);

          return (
            <EpisodeCard
              item={item.item}
              expanded={expanded}
              onToggle={() => {
                setExpandedEpisodeIds((current) => {
                  const next = new Set(current);
                  if (next.has(item.item.episodeId)) {
                    next.delete(item.item.episodeId);
                  } else {
                    next.add(item.item.episodeId);
                  }
                  return next;
                });
              }}
              onOpen={() => router.push(`/(main)/episode/${item.item.episodeId}`)}
            />
          );
        }}
        ListFooterComponent={
          episodesQuery.hasNextPage ? (
            <View style={styles.footerLoadWrap}>
              <Button
                variant="ghost"
                onPress={() => void episodesQuery.fetchNextPage()}
                loading={episodesQuery.isFetchingNextPage}
                disabled={episodesQuery.isFetchingNextPage}
              >
                Load More Episodes
              </Button>
            </View>
          ) : null
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing['4xl'],
    gap: spacing.md,
  },
  headerWrap: {
    marginBottom: spacing.md,
    gap: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  pageHeaderText: {
    flex: 1,
    paddingRight: spacing.xs,
  },
  title: {
    color: colors.text.DEFAULT,
    fontFamily: typography.fontFamily.heading,
    fontSize: typography.fontSize['2xl'],
    fontWeight: typography.fontWeight.bold,
  },
  subtitle: {
    marginTop: spacing.xs,
    color: colors.text.muted,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.base,
  },
  sectionTitle: {
    color: colors.text.DEFAULT,
    fontFamily: typography.fontFamily.heading,
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold,
    marginTop: spacing.xs,
  },
  separator: {
    height: spacing.sm,
  },
  loadingStack: {
    gap: spacing.sm,
  },
  episodeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  episodeHeaderTextWrap: {
    flex: 1,
    gap: spacing.xs,
  },
  episodeTitle: {
    color: colors.text.DEFAULT,
    fontFamily: typography.fontFamily.heading,
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold,
  },
  episodeMeta: {
    color: colors.text.muted,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
    textTransform: 'capitalize',
  },
  countRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  countChip: {
    borderWidth: 1,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    fontFamily: typography.fontFamily.mono,
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold,
    borderColor: colors.border,
    color: colors.text.light,
  },
  countChipError: {
    borderColor: colors.error,
    color: colors.error,
  },
  countChipActive: {
    borderColor: colors.primary.DEFAULT,
    color: colors.primary.DEFAULT,
  },
  headerRightWrap: {
    alignItems: 'flex-end',
    gap: spacing.xs,
  },
  priorityBadge: {
    borderWidth: 1,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    fontFamily: typography.fontFamily.mono,
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold,
  },
  episodeActionRow: {
    flexDirection: 'row',
    marginTop: spacing.sm,
  },
  actionBtn: {
    width: 'auto',
  },
  expandedWrap: {
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  // Phase summary styles
  phaseSummaryWrap: {
    gap: spacing.xs,
  },
  phaseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 6,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.md,
    backgroundColor: 'rgba(255,255,255,0.5)',
  },
  phaseDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  phaseLabel: {
    flex: 1,
    color: colors.text.DEFAULT,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
  },
  phaseStatusText: {
    color: colors.text.muted,
    fontFamily: typography.fontFamily.mono,
    fontSize: typography.fontSize.xs,
  },
  phaseStatusDone: {
    color: '#0A9F6A',
  },
  phaseStatusError: {
    color: colors.error,
    fontWeight: typography.fontWeight.bold,
  },
  phaseStatusActive: {
    color: colors.primary.DEFAULT,
    fontWeight: typography.fontWeight.semibold,
  },
  phaseLoadingStack: {
    gap: spacing.xs,
  },
  phaseHintText: {
    color: colors.text.muted,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
  },
  footerLoadWrap: {
    marginTop: spacing.md,
    marginBottom: spacing.md,
    alignItems: 'flex-start',
  },
});
