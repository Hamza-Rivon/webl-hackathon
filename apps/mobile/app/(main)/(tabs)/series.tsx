import { useEffect, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@/components/ui/SymbolIcon';
import { useRouter } from 'expo-router';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import { Button, EmptyState, GlassCard, Screen, Skeleton } from '@/components/ui';
import { useSeries, type SeriesWithEpisodeCount } from '@/hooks/useSeries';
import { useTheme } from '@/contexts/ThemeContext';
import { borderRadius, spacing, typography } from '@/lib/theme';
import { trackPrimaryAction, trackScreenView } from '@/lib/analytics';

const CADENCE_LABELS: Record<string, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  biweekly: 'Bi-weekly',
  monthly: 'Monthly',
};

const CADENCE_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  daily: 'calendar-outline',
  weekly: 'today-outline',
  biweekly: 'calendar-number-outline',
  monthly: 'calendar-clear-outline',
};

function SeriesCard({
  item,
  index,
  isDark,
  onPress,
}: {
  item: SeriesWithEpisodeCount;
  index: number;
  isDark: boolean;
  onPress: () => void;
}) {
  const cadenceLabel = CADENCE_LABELS[item.cadence] || item.cadence;
  const cadenceIcon = CADENCE_ICONS[item.cadence] || 'calendar-outline';
  const episodeCount = item._count.episodes;

  return (
    <Animated.View
      entering={FadeInDown.delay(index * 60).duration(300)}
      layout={LinearTransition.springify()}
    >
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.seriesCard,
          {
            backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : '#FFFFFF',
            borderColor: isDark ? 'rgba(255,255,255,0.08)' : '#E2E8F0',
            shadowColor: isDark ? '#000' : '#17304E',
          },
          pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] },
        ]}
      >
        {/* Accent bar */}
        <View
          style={[
            styles.accentBar,
            { backgroundColor: isDark ? '#5CF6FF' : '#0EA5A8' },
          ]}
        />

        <View style={styles.cardContent}>
          {/* Header row */}
          <View style={styles.cardHeader}>
            <View style={styles.cardTitleWrap}>
              <Text
                style={[styles.seriesTitle, { color: isDark ? '#F1F5F9' : '#1E293B' }]}
                numberOfLines={1}
              >
                {item.name}
              </Text>
            </View>
            <Ionicons
              name="chevron-forward"
              size={16}
              color={isDark ? 'rgba(255,255,255,0.3)' : '#CBD5E1'}
            />
          </View>

          {/* Description */}
          {item.description ? (
            <Text
              style={[styles.description, { color: isDark ? 'rgba(255,255,255,0.6)' : '#64748B' }]}
              numberOfLines={2}
            >
              {item.description}
            </Text>
          ) : null}

          {/* Meta row */}
          <View style={styles.metaRow}>
            <View
              style={[
                styles.metaPill,
                {
                  backgroundColor: isDark ? 'rgba(92,246,255,0.1)' : 'rgba(14,165,168,0.08)',
                },
              ]}
            >
              <Ionicons
                name="film-outline"
                size={12}
                color={isDark ? '#5CF6FF' : '#0EA5A8'}
              />
              <Text style={[styles.metaPillText, { color: isDark ? '#5CF6FF' : '#0EA5A8' }]}>
                {episodeCount} {episodeCount === 1 ? 'episode' : 'episodes'}
              </Text>
            </View>
            <View
              style={[
                styles.metaPill,
                {
                  backgroundColor: isDark ? 'rgba(251,191,36,0.1)' : 'rgba(245,158,11,0.08)',
                },
              ]}
            >
              <Ionicons
                name={cadenceIcon}
                size={12}
                color={isDark ? '#FBBF24' : '#D97706'}
              />
              <Text style={[styles.metaPillText, { color: isDark ? '#FBBF24' : '#D97706' }]}>
                {cadenceLabel}
              </Text>
            </View>
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

export default function SeriesScreen() {
  const router = useRouter();
  const { colors, isDark } = useTheme();
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
      {/* Title */}
      <Animated.View entering={FadeInDown.duration(300)} style={styles.headerRow}>
        <View style={styles.headerTextWrap}>
          <Text style={[styles.title, { color: colors.text.DEFAULT }]}>Series</Text>
          <Text style={[styles.subtitle, { color: isDark ? 'rgba(255,255,255,0.5)' : '#64748B' }]}>
            Organize your content by theme and cadence
          </Text>
        </View>
        <Pressable
          onPress={() => {
            trackPrimaryAction('series_new');
            router.push('/(main)/series/new');
          }}
          style={({ pressed }) => [
            styles.addBtn,
            {
              backgroundColor: isDark ? '#5CF6FF' : '#0EA5A8',
              shadowColor: isDark ? '#5CF6FF' : '#0EA5A8',
            },
            pressed && { opacity: 0.85, transform: [{ scale: 0.95 }] },
          ]}
        >
          <Ionicons name="add" size={20} color={isDark ? '#0A0E14' : '#FFFFFF'} />
        </Pressable>
      </Animated.View>

      {/* Stats bar */}
      {!isLoading && sorted.length > 0 ? (
        <Animated.View entering={FadeInDown.delay(100).duration(250)} style={styles.statsRow}>
          <View
            style={[
              styles.statCard,
              {
                backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : '#F8FAFC',
                borderColor: isDark ? 'rgba(255,255,255,0.06)' : '#E2E8F0',
              },
            ]}
          >
            <Text style={[styles.statNumber, { color: isDark ? '#5CF6FF' : '#0EA5A8' }]}>
              {sorted.length}
            </Text>
            <Text style={[styles.statLabel, { color: isDark ? 'rgba(255,255,255,0.45)' : '#94A3B8' }]}>
              Series
            </Text>
          </View>
          <View
            style={[
              styles.statCard,
              {
                backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : '#F8FAFC',
                borderColor: isDark ? 'rgba(255,255,255,0.06)' : '#E2E8F0',
              },
            ]}
          >
            <Text style={[styles.statNumber, { color: isDark ? '#4ADE80' : '#16A34A' }]}>
              {sorted.reduce((sum, s) => sum + s._count.episodes, 0)}
            </Text>
            <Text style={[styles.statLabel, { color: isDark ? 'rgba(255,255,255,0.45)' : '#94A3B8' }]}>
              Total Episodes
            </Text>
          </View>
        </Animated.View>
      ) : null}

      {/* Error banner */}
      {isError ? (
        <GlassCard depth="subtle" glowColor={isDark ? '#FB7185' : '#C7354F'}>
          <View style={styles.errorRow}>
            <Ionicons name="warning-outline" size={18} color={isDark ? '#FB7185' : '#C7354F'} />
            <Text style={[styles.errorText, { color: isDark ? '#FB7185' : '#C7354F' }]}>
              Could not load series. Pull to refresh.
            </Text>
          </View>
        </GlassCard>
      ) : null}
    </View>
  );

  if (isLoading) {
    return (
      <Screen topInset>
        <View style={styles.content}>
          {header}
          <View style={styles.loadingStack}>
            <Skeleton height={100} radius="lg" />
            <Skeleton height={100} radius="lg" />
            <Skeleton height={100} radius="lg" />
          </View>
        </View>
      </Screen>
    );
  }

  if (sorted.length === 0) {
    return (
      <Screen topInset>
        <View style={styles.content}>
          {header}
          <Animated.View entering={FadeInDown.delay(150).duration(300)}>
            <EmptyState
              title="No series yet"
              description="Create your first series to organize episode themes and cadence."
              icon={<Ionicons name="albums-outline" size={46} color={isDark ? '#5CF6FF' : '#0EA5A8'} />}
              action={
                <Button onPress={() => router.push('/(main)/series/new')}>
                  Create Series
                </Button>
              }
            />
          </Animated.View>
        </View>
      </Screen>
    );
  }

  return (
    <Screen scroll={false} topInset>
      <FlashList
        data={sorted}
        keyExtractor={(item) => item.id}
        estimatedItemSize={120}
        ListHeaderComponent={header}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        renderItem={({ item, index }) => (
          <SeriesCard
            item={item}
            index={index}
            isDark={isDark}
            onPress={() => {
              trackPrimaryAction('series_open', { seriesId: item.id });
              router.push(`/(main)/series/${item.id}`);
            }}
          />
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing['5xl'],
  },
  headerWrap: {
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  headerTextWrap: {
    flex: 1,
  },
  title: {
    fontFamily: typography.fontFamily.heading,
    fontSize: typography.fontSize['2xl'],
    fontWeight: typography.fontWeight.bold as any,
  },
  subtitle: {
    marginTop: spacing.xs,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
  },
  addBtn: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  statsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  statCard: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1,
  },
  statNumber: {
    fontFamily: typography.fontFamily.heading,
    fontSize: typography.fontSize.xl,
    fontWeight: typography.fontWeight.bold as any,
  },
  statLabel: {
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.xs,
    marginTop: 2,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  errorText: {
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
    flex: 1,
  },
  loadingStack: {
    gap: spacing.md,
  },
  separator: {
    height: spacing.sm,
  },
  // Series card
  seriesCard: {
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    overflow: 'hidden',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  accentBar: {
    height: 3,
    width: '100%',
  },
  cardContent: {
    padding: spacing.lg,
    gap: spacing.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardTitleWrap: {
    flex: 1,
    marginRight: spacing.sm,
  },
  seriesTitle: {
    fontFamily: typography.fontFamily.heading,
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.semibold as any,
  },
  description: {
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
    lineHeight: 20,
  },
  metaRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  metaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: borderRadius.full,
  },
  metaPillText: {
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.medium as any,
  },
});
