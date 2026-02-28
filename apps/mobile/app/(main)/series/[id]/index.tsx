import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@/components/ui/SymbolIcon';
import { Button, Card, ConfirmModal, Screen, StickyActionBar } from '@/components/ui';
import { useToast } from '@/components/ui/Toast';
import { useDeleteSeries, useSeriesDetail, seriesKeys } from '@/hooks/useSeries';
import { STATUS_LABELS } from '@/lib/pipeline';
import { getStatusTone, colors, spacing, typography, borderRadius } from '@/lib/theme';

function formatDate(value: string) {
  try {
    return new Date(value).toLocaleDateString();
  } catch {
    return value;
  }
}

export default function SeriesDetailScreen() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const seriesQuery = useSeriesDetail(id);
  const deleteSeries = useDeleteSeries();

  const [deleteVisible, setDeleteVisible] = useState(false);

  const series = seriesQuery.data;

  const episodes = useMemo(() => {
    if (!series?.episodes?.length) return [];
    return [...series.episodes].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  }, [series?.episodes]);

  const onRefresh = async () => {
    await queryClient.invalidateQueries({ queryKey: seriesKeys.detail(id) });
  };

  const onDelete = async () => {
    try {
      await deleteSeries.mutateAsync(id);
      showToast({ type: 'success', title: 'Series deleted', message: 'The series has been removed.' });
      router.replace('/(main)/(tabs)/series');
    } catch (error) {
      showToast({
        type: 'error',
        title: 'Delete failed',
        message: error instanceof Error ? error.message : 'Could not delete this series.',
      });
    } finally {
      setDeleteVisible(false);
    }
  };

  if (seriesQuery.isLoading) {
    return (
      <Screen contentContainerStyle={styles.content} topInset={false}>
        <Text style={styles.muted}>Loading series...</Text>
      </Screen>
    );
  }

  if (!series) {
    return (
      <Screen contentContainerStyle={styles.content} topInset={false}>
        <Text style={styles.title}>Series not found</Text>
        <Text style={styles.muted}>This series may have been deleted.</Text>
        <Button variant="outline" onPress={() => router.back()}>
          Go Back
        </Button>
      </Screen>
    );
  }

  return (
    <View style={styles.root}>
      <Screen contentContainerStyle={styles.content} scroll topInset={false}>
        <View style={styles.header}>
          <Text style={styles.title}>{series.name}</Text>
          <Text style={styles.subtitle}>{series.description || 'No description yet.'}</Text>
        </View>

        <Card>
          <Text style={styles.sectionTitle}>Series Settings</Text>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Cadence</Text>
            <Text style={styles.metaValue}>{series.cadence}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Episodes</Text>
            <Text style={styles.metaValue}>{episodes.length}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Created</Text>
            <Text style={styles.metaValue}>{formatDate(series.createdAt)}</Text>
          </View>
        </Card>

        <Card>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Episodes</Text>
            <Button
              size="sm"
              style={styles.smallAction}
              onPress={() =>
                router.push({
                  pathname: '/(main)/episode/new',
                  params: { seriesId: id },
                })
              }
            >
              New Episode
            </Button>
          </View>

          {episodes.length === 0 ? (
            <Text style={styles.muted}>No episodes yet.</Text>
          ) : (
            <View style={styles.stack}>
              {episodes.map((episode) => {
                const statusLabel = STATUS_LABELS[episode.status as keyof typeof STATUS_LABELS] || episode.status;
                const dotColor = getStatusTone(episode.status);
                return (
                  <Card
                    key={episode.id}
                    variant="elevated"
                    padding="md"
                    pressable
                    onPress={() => router.push(`/(main)/episode/${episode.id}`)}
                  >
                    <View style={styles.episodeRow}>
                      <View style={[styles.statusDot, { backgroundColor: dotColor }]} />
                      <View style={styles.episodeMeta}>
                        <Text style={styles.episodeTitle} numberOfLines={1}>
                          {episode.title}
                        </Text>
                        <Text style={styles.episodeDate}>{formatDate(episode.createdAt)}</Text>
                      </View>
                      <Text style={[styles.statusPill, { borderColor: dotColor, color: dotColor }]}>{statusLabel}</Text>
                    </View>
                  </Card>
                );
              })}
            </View>
          )}
        </Card>

        <Card variant="pastelOrange">
          <Text style={styles.sectionTitle}>Danger Zone</Text>
          <Text style={styles.muted}>Deleting a series removes its structure for future episode creation.</Text>
          <View style={styles.stackTop}>
            <Button variant="outline" onPress={onRefresh}>
              Refresh
            </Button>
            <Button variant="danger" onPress={() => setDeleteVisible(true)}>
              Delete Series
            </Button>
          </View>
        </Card>
      </Screen>

      <StickyActionBar>
        <Button variant="ghost" onPress={() => router.back()} leftIcon={<Ionicons name="arrow-back" size={18} color={colors.text.DEFAULT} />}>
          Back
        </Button>
        <Button variant="outline" onPress={() => router.push(`/(main)/series/${id}/edit`)}>
          Edit
        </Button>
      </StickyActionBar>

      <ConfirmModal
        visible={deleteVisible}
        onClose={() => setDeleteVisible(false)}
        onConfirm={onDelete}
        title="Delete series?"
        message={`Delete "${series.name}" and remove its planning structure from the app.`}
        confirmText="Delete"
        cancelText="Cancel"
        variant="danger"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing['4xl'],
    gap: spacing.md,
  },
  header: {
    gap: spacing.xs,
  },
  title: {
    color: colors.text.DEFAULT,
    fontFamily: typography.fontFamily.heading,
    fontSize: typography.fontSize.xl,
    fontWeight: typography.fontWeight.bold,
  },
  subtitle: {
    color: colors.text.muted,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
    lineHeight: 20,
  },
  sectionTitle: {
    color: colors.text.DEFAULT,
    fontFamily: typography.fontFamily.heading,
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold,
    marginBottom: spacing.sm,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  smallAction: {
    width: 'auto',
    minWidth: 128,
  },
  muted: {
    color: colors.text.light,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
    lineHeight: 20,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  metaLabel: {
    color: colors.text.light,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  metaValue: {
    color: colors.text.DEFAULT,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
  },
  stack: {
    gap: spacing.sm,
  },
  stackTop: {
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  episodeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  episodeMeta: {
    flex: 1,
    gap: 2,
  },
  episodeTitle: {
    color: colors.text.DEFAULT,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
  },
  episodeDate: {
    color: colors.text.light,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.xs,
  },
  statusPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.primary.DEFAULT,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
});
