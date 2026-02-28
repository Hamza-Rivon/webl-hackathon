import { useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Card, Input, Screen, Select, StickyActionBar, TextArea } from '@/components/ui';
import { useToast } from '@/components/ui/Toast';
import { seriesKeys, useSeriesDetail, useUpdateSeries } from '@/hooks/useSeries';
import { useTemplates } from '@/hooks/useTemplates';
import { colors, spacing, typography } from '@/lib/theme';

const cadenceOptions = [
  { label: 'Daily', value: 'daily' },
  { label: 'Weekly', value: 'weekly' },
  { label: 'Bi-weekly', value: 'biweekly' },
  { label: 'Monthly', value: 'monthly' },
];

export default function EditSeriesScreen() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const seriesQuery = useSeriesDetail(id);
  const templatesQuery = useTemplates({ limit: 100 });
  const updateSeries = useUpdateSeries();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [cadence, setCadence] = useState('weekly');
  const [templateId, setTemplateId] = useState('');
  const [nameError, setNameError] = useState<string | undefined>();

  useEffect(() => {
    const series = seriesQuery.data;
    if (!series) return;

    setName(series.name);
    setDescription(series.description || '');
    setCadence(series.cadence);
    setTemplateId(series.templateId || '');
  }, [seriesQuery.data]);

  const hasChanges = useMemo(() => {
    const series = seriesQuery.data;
    if (!series) return false;

    return (
      name !== series.name ||
      description !== (series.description || '') ||
      cadence !== series.cadence ||
      templateId !== (series.templateId || '')
    );
  }, [cadence, description, name, seriesQuery.data, templateId]);

  const templateOptions = useMemo(
    () => [
      { label: 'No default template', value: '' },
      ...(templatesQuery.data?.map((template) => ({
        label: `${template.name} (${template.platform})`,
        value: template.id,
      })) || []),
    ],
    [templatesQuery.data]
  );

  const validate = () => {
    if (!name.trim()) {
      setNameError('Series name is required.');
      return false;
    }

    if (name.trim().length < 2) {
      setNameError('Use at least 2 characters.');
      return false;
    }

    setNameError(undefined);
    return true;
  };

  const onSave = async () => {
    if (!validate() || !hasChanges) return;

    try {
      await updateSeries.mutateAsync({
        id,
        data: {
          name: name.trim(),
          description: description.trim() || undefined,
          cadence: cadence as 'daily' | 'weekly' | 'biweekly' | 'monthly',
          templateId: templateId || undefined,
        },
      });

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: seriesKeys.detail(id) }),
        queryClient.invalidateQueries({ queryKey: seriesKeys.lists() }),
      ]);

      showToast({ type: 'success', title: 'Series updated', message: 'Changes are now live.' });
      router.replace(`/(main)/series/${id}`);
    } catch (error) {
      showToast({
        type: 'error',
        title: 'Update failed',
        message: error instanceof Error ? error.message : 'Could not save changes.',
      });
    }
  };

  const onCancel = () => {
    if (!hasChanges || updateSeries.isPending) {
      router.back();
      return;
    }

    Alert.alert('Discard changes?', 'Your unsaved edits will be lost.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => router.back() },
    ]);
  };

  if (seriesQuery.isLoading) {
    return (
      <Screen contentContainerStyle={styles.content} topInset={false}>
        <Text style={styles.muted}>Loading series settings...</Text>
      </Screen>
    );
  }

  if (!seriesQuery.data) {
    return (
      <Screen contentContainerStyle={styles.content} topInset={false}>
        <Text style={styles.title}>Series not found</Text>
        <Text style={styles.muted}>This series may have been deleted.</Text>
      </Screen>
    );
  }

  return (
    <View style={styles.root}>
      <Screen contentContainerStyle={styles.content} topInset={false}>
        <View style={styles.header}>
          <Text style={styles.title}>Edit Series</Text>
          <Text style={styles.subtitle}>Update cadence, naming, and template defaults.</Text>
        </View>

        <Card>
          <Text style={styles.sectionTitle}>Series Profile</Text>
          <View style={styles.stack}>
            <Input
              label="Name"
              placeholder="Series name"
              value={name}
              onChangeText={setName}
              maxLength={100}
              error={nameError}
            />
            <TextArea
              label="Description"
              placeholder="Describe your content arc"
              value={description}
              onChangeText={setDescription}
              maxLength={500}
              minLines={4}
              helperText={`${description.length}/500`}
            />
            <Select label="Cadence" options={cadenceOptions} value={cadence} onChange={setCadence} />
            <Select
              label="Default template"
              options={templateOptions}
              value={templateId}
              onChange={setTemplateId}
              placeholder={templatesQuery.isLoading ? 'Loading templates...' : 'Choose a template'}
              disabled={templatesQuery.isLoading}
            />
          </View>
        </Card>

        {!hasChanges ? <Text style={styles.muted}>No unsaved changes.</Text> : null}
      </Screen>

      <StickyActionBar>
        <Button variant="ghost" onPress={onCancel}>
          Cancel
        </Button>
        <Button onPress={onSave} disabled={!hasChanges || updateSeries.isPending}>
          {updateSeries.isPending ? 'Saving...' : 'Save Changes'}
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
    fontSize: typography.fontSize.xl,
    fontWeight: typography.fontWeight.bold,
  },
  subtitle: {
    color: colors.text.muted,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
  },
  sectionTitle: {
    color: colors.text.DEFAULT,
    fontFamily: typography.fontFamily.heading,
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold,
    marginBottom: spacing.sm,
  },
  muted: {
    color: colors.text.light,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
    lineHeight: 20,
  },
  stack: {
    gap: spacing.md,
  },
});
