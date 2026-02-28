import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@/components/ui/SymbolIcon';
import { useRouter } from 'expo-router';
import { Button, Card, EmptyState, Input, Screen, Skeleton } from '@/components/ui';
import { useDebounce, useSearchTemplates, useTemplates } from '@/hooks';
import { colors, spacing, typography } from '@/lib/theme';
import { trackPrimaryAction, trackScreenView } from '@/lib/analytics';

const PLATFORM_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'tiktok', label: 'TikTok' },
  { key: 'reels', label: 'Reels' },
  { key: 'shorts', label: 'Shorts' },
] as const;

export default function TemplatesScreen() {
  const router = useRouter();
  const [platform, setPlatform] = useState<(typeof PLATFORM_FILTERS)[number]['key']>('all');
  const [query, setQuery] = useState('');

  useEffect(() => {
    trackScreenView('templates_tab');
  }, []);

  const debounced = useDebounce(query, 300);

  const list = useTemplates({ platform: platform === 'all' ? undefined : platform });
  const search = useSearchTemplates(debounced);

  const templates = useMemo(() => {
    if (debounced.trim().length >= 2) {
      return search.data || [];
    }
    return list.data || [];
  }, [debounced, list.data, search.data]);

  const loading = debounced.trim().length >= 2 ? search.isLoading : list.isLoading;
  const isError = debounced.trim().length >= 2 ? search.isError : list.isError;

  const header = (
    <View style={styles.headerWrap}>
      <Text style={styles.title}>Templates</Text>
      <Text style={styles.subtitle}>Choose a structure and launch faster.</Text>

      <Input
        placeholder="Search templates"
        value={query}
        onChangeText={setQuery}
        leftIcon={<Ionicons name="search-outline" size={16} color={colors.text.light} />}
      />

      <View style={styles.filterRow}>
        {PLATFORM_FILTERS.map((item) => (
          <Button
            key={item.key}
            variant={platform === item.key ? 'primary' : 'outline'}
            size="sm"
            onPress={() => {
              trackPrimaryAction('templates_filter_platform', { platform: item.key });
              setPlatform(item.key);
            }}
            style={styles.filterButton}
          >
            {item.label}
          </Button>
        ))}
      </View>

      {isError ? (
        <Card variant="pastelOrange">
          <Text style={styles.warningText}>Could not load templates. Pull to refresh and retry.</Text>
        </Card>
      ) : null}

      {loading ? (
        <View style={styles.loadingStack}>
          <Skeleton height={84} radius="lg" />
          <Skeleton height={84} radius="lg" />
          <Skeleton height={84} radius="lg" />
        </View>
      ) : null}
    </View>
  );

  return (
    <Screen scroll={false}>
      {loading ? (
        <View style={styles.content}>{header}</View>
      ) : templates.length === 0 ? (
        <View style={[styles.content, styles.emptyWrap]}>
          {header}
          <EmptyState
            title="No templates found"
            description="Try a different platform or search query."
            icon={<Ionicons name="grid-outline" size={46} color={colors.primary.DEFAULT} />}
          />
        </View>
      ) : (
        <FlashList
          data={templates}
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
                trackPrimaryAction('templates_open_detail', { templateId: item.id });
                router.push(`/(main)/templates/${item.id}`);
              }}
            >
              <View style={styles.row}>
                <View style={styles.rowText}>
                  <Text style={styles.templateName}>{item.name}</Text>
                  <Text style={styles.metaText}>{item.platform} · {item.durationTarget}s</Text>
                  {item.description ? (
                    <Text style={styles.templateDescription} numberOfLines={2}>
                      {item.description}
                    </Text>
                  ) : null}
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.text.light} />
              </View>
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
  title: {
    color: colors.text.DEFAULT,
    fontFamily: typography.fontFamily.heading,
    fontSize: typography.fontSize['2xl'],
    fontWeight: typography.fontWeight.bold,
  },
  subtitle: {
    color: colors.text.muted,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.base,
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  filterButton: {
    width: 'auto',
    minWidth: 86,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  rowText: {
    flex: 1,
  },
  templateName: {
    color: colors.text.DEFAULT,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.semibold,
  },
  metaText: {
    marginTop: 2,
    color: colors.text.light,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
    textTransform: 'capitalize',
  },
  templateDescription: {
    marginTop: spacing.sm,
    color: colors.text.muted,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.base,
    lineHeight: 21,
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
