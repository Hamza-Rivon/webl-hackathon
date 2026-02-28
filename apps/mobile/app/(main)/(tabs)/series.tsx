import { useEffect, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@/components/ui/SymbolIcon';
import { useRouter } from 'expo-router';
import { Button, Card, EmptyState, Screen, Skeleton } from '@/components/ui';
import { useSeries } from '@/hooks/useSeries';
import { colors, spacing, typography } from '@/lib/theme';
import { trackPrimaryAction, trackScreenView } from '@/lib/analytics';

export default function SeriesScreen() {
  const router = useRouter();
  const { data, isLoading, isError } = useSeries();

  useEffect(() => {
    trackScreenView('series_tab');
  }, []);

  const sorted = useMemo(
    () => [...(data || [])].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    [data]
  );

  const header = (
    <View style={styles.headerWrap}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.title}>Series</Text>
          <Text style={styles.subtitle}>Organize recurring content themes and cadence.</Text>
        </View>
        <Button
          size="sm"
          fullWidth={false}
          leftIcon={<Ionicons name="add" size={16} color={colors.text.inverse} />}
          onPress={() => {
            trackPrimaryAction('series_new');
            router.push('/(main)/series/new');
          }}
          style={styles.createBtn}
        >
          New
        </Button>
      </View>

      {isError ? (
        <Card variant="pastelOrange">
          <Text style={styles.warningText}>Could not load series. Pull to refresh and retry.</Text>
        </Card>
      ) : null}

      {isLoading ? (
        <View style={styles.loadingStack}>
          <Skeleton height={90} radius="lg" />
          <Skeleton height={90} radius="lg" />
          <Skeleton height={90} radius="lg" />
        </View>
      ) : null}
    </View>
  );

  return (
    <Screen scroll={false}>
      {isLoading ? (
        <View style={styles.content}>{header}</View>
      ) : sorted.length === 0 ? (
        <View style={[styles.content, styles.emptyWrap]}>
          {header}
          <EmptyState
            title="No series yet"
            description="Create your first series to organize episode themes and cadence."
            icon={<Ionicons name="albums-outline" size={46} color={colors.primary.DEFAULT} />}
            action={<Button onPress={() => router.push('/(main)/series/new')}>Create Series</Button>}
          />
        </View>
      ) : (
        <FlashList
          data={sorted}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={header}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <Card
              key={item.id}
              pressable
              onPress={() => {
                trackPrimaryAction('series_open', { seriesId: item.id });
                router.push(`/(main)/series/${item.id}`);
              }}
            >
              <View style={styles.seriesRow}>
                <View style={styles.seriesTextWrap}>
                  <Text style={styles.seriesTitle}>{item.name}</Text>
                  <Text style={styles.metaText}>{item._count.episodes} episodes · {item.cadence}</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.text.light} />
              </View>
              {item.description ? <Text style={styles.description}>{item.description}</Text> : null}
            </Card>
          )}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing['3xl'],
    paddingBottom: spacing['4xl'],
    gap: spacing.md,
  },
  headerWrap: {
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
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
  createBtn: {
    minWidth: 80,
  },
  seriesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  seriesTextWrap: {
    flex: 1,
    marginRight: spacing.sm,
  },
  seriesTitle: {
    color: colors.text.DEFAULT,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.semibold,
  },
  metaText: {
    color: colors.text.light,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
  },
  description: {
    marginTop: spacing.sm,
    color: colors.text.muted,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.base,
    lineHeight: 22,
  },
  separator: {
    height: spacing.sm,
  },
  warningText: {
    color: colors.warning,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
  },
  loadingStack: {
    gap: spacing.sm,
  },
  emptyWrap: {
    gap: spacing.md,
  },
});
