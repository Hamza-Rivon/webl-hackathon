import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@/components/ui/SymbolIcon';
import { Button, Card, Input, Screen, StickyActionBar } from '@/components/ui';
import { useCreateEpisode } from '@/hooks/useEpisodes';
import { useSeries } from '@/hooks/useSeries';
import { useTemplates } from '@/hooks/useTemplates';
import { colors, spacing, typography } from '@/lib/theme';

const ALLOWED_TEMPLATE_NAME_KEYS = new Set(['arollcleanthenbroll', 'purebroll60s']);

function normalizeTemplateNameKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export default function NewEpisodeScreen() {
  const params = useLocalSearchParams<{
    seriesId?: string;
    templateId?: string;
  }>();
  const router = useRouter();
  const createEpisode = useCreateEpisode();

  const { data: series } = useSeries();
  const { data: templates } = useTemplates({ limit: 100 });

  const [title, setTitle] = useState('');
  const [seriesId, setSeriesId] = useState<string>(params.seriesId || '');
  const [templateId, setTemplateId] = useState<string>(params.templateId || '');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (params.seriesId) {
      setSeriesId(params.seriesId);
    }
  }, [params.seriesId]);

  useEffect(() => {
    if (params.templateId) {
      setTemplateId(params.templateId);
    }
  }, [params.templateId]);

  const allowedTemplates = useMemo(() => {
    const filtered = (templates ?? []).filter((item) =>
      ALLOWED_TEMPLATE_NAME_KEYS.has(normalizeTemplateNameKey(item.name))
    );

    const order = ['arollcleanthenbroll', 'purebroll60s'];
    return filtered.sort((a, b) => {
      const aIndex = order.indexOf(normalizeTemplateNameKey(a.name));
      const bIndex = order.indexOf(normalizeTemplateNameKey(b.name));
      return aIndex - bIndex;
    });
  }, [templates]);

  useEffect(() => {
    if (!templateId) return;
    const stillAllowed = allowedTemplates.some((item) => item.id === templateId);
    if (!stillAllowed) {
      setTemplateId('');
    }
  }, [allowedTemplates, templateId]);

  const selectedSeries = useMemo(() => series?.find((item) => item.id === seriesId), [series, seriesId]);
  const selectedTemplate = useMemo(
    () => allowedTemplates.find((item) => item.id === templateId),
    [templateId, allowedTemplates]
  );

  const onSubmit = async () => {
    if (!title.trim()) {
      setError('Title is required.');
      return;
    }
    if (!templateId) {
      setError('Choose one template to continue.');
      return;
    }

    setError(null);

    try {
      const episode = await createEpisode.mutateAsync({
        title: title.trim(),
        seriesId: seriesId || undefined,
        templateId,
      });

      router.replace(`/(main)/episode/${episode.id}`);
    } catch (err: any) {
      setError(err?.message || 'Could not create episode.');
    }
  };

  return (
    <View style={styles.root}>
      <Screen contentContainerStyle={styles.content} topInset={false}>
        <View style={styles.header}>
          <Text style={styles.title}>Create Episode</Text>
          <Text style={styles.subtitle}>Set a title and select one production template to continue.</Text>
        </View>

        <Card>
          <Input
            label="Episode Title"
            placeholder="Example: 3 Hooks That Improve Retention"
            value={title}
            onChangeText={setTitle}
          />
        </Card>

        <Card>
          <Text style={styles.sectionLabel}>Series (optional)</Text>
          <View style={styles.choiceList}>
            <Button
              variant={!seriesId ? 'primary' : 'outline'}
              size="sm"
              onPress={() => setSeriesId('')}
              style={styles.pill}
            >
              Standalone
            </Button>
            {(series || []).slice(0, 8).map((item) => (
              <Button
                key={item.id}
                variant={seriesId === item.id ? 'primary' : 'outline'}
                size="sm"
                onPress={() => setSeriesId(item.id)}
                style={styles.pill}
              >
                {item.name}
              </Button>
            ))}
          </View>
        </Card>

        <Card>
          <Text style={styles.sectionLabel}>Template (required)</Text>
          <View style={styles.choiceList}>
            {allowedTemplates.map((item) => (
              <Button
                key={item.id}
                variant={templateId === item.id ? 'primary' : 'outline'}
                size="sm"
                onPress={() => setTemplateId(item.id)}
                style={styles.pill}
              >
                {item.name}
              </Button>
            ))}
          </View>
        </Card>

        <Card variant="pastelBlue">
          <View style={styles.summaryRow}>
            <Ionicons name="list-outline" size={16} color={colors.text.muted} />
            <Text style={styles.summaryText}>Series: {selectedSeries?.name || 'Standalone'}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Ionicons name="grid-outline" size={16} color={colors.text.muted} />
            <Text style={styles.summaryText}>Template: {selectedTemplate?.name || 'Not selected'}</Text>
          </View>
        </Card>

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </Screen>

      <StickyActionBar>
        <Button variant="ghost" onPress={() => router.back()}>
          Cancel
        </Button>
        <Button
          onPress={onSubmit}
          loading={createEpisode.isPending}
          disabled={createEpisode.isPending || !templateId}
        >
          Create Episode
        </Button>
      </StickyActionBar>
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
    fontSize: typography.fontSize['2xl'],
    fontWeight: typography.fontWeight.bold,
  },
  subtitle: {
    color: colors.text.muted,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.base,
  },
  sectionLabel: {
    marginBottom: spacing.sm,
    color: colors.text.DEFAULT,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
  },
  choiceList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  pill: {
    width: 'auto',
    minWidth: 94,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  summaryText: {
    color: colors.text.DEFAULT,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
  },
  error: {
    color: colors.error,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
  },
});
