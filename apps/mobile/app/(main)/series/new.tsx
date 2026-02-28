import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, Card, Input, Screen, Select, StickyActionBar, TextArea } from '@/components/ui';
import { useToast } from '@/components/ui/Toast';
import { useCreateSeries } from '@/hooks/useSeries';
import { useTemplates } from '@/hooks/useTemplates';
import { colors, spacing, typography } from '@/lib/theme';

const cadenceOptions = [
  { label: 'Daily', value: 'daily' },
  { label: 'Weekly', value: 'weekly' },
  { label: 'Bi-weekly', value: 'biweekly' },
  { label: 'Monthly', value: 'monthly' },
];

export default function NewSeriesScreen() {
  const router = useRouter();
  const { showToast } = useToast();

  const createSeries = useCreateSeries();
  const templatesQuery = useTemplates({ limit: 100 });

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [cadence, setCadence] = useState('weekly');
  const [templateId, setTemplateId] = useState('');
  const [nameError, setNameError] = useState<string | undefined>();

  const selectedTemplate = useMemo(
    () => templatesQuery.data?.find((template) => template.id === templateId) || null,
    [templateId, templatesQuery.data]
  );

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

  const onCreate = async () => {
    if (!validate()) return;

    try {
      await createSeries.mutateAsync({
        name: name.trim(),
        description: description.trim() || undefined,
        cadence: cadence as 'daily' | 'weekly' | 'biweekly' | 'monthly',
        templateId: templateId || undefined,
      });

      showToast({
        type: 'success',
        title: 'Series created',
        message: 'You can now create episodes inside this series.',
      });

      router.replace('/(main)/(tabs)/series');
    } catch (error) {
      showToast({
        type: 'error',
        title: 'Creation failed',
        message: error instanceof Error ? error.message : 'Could not create series.',
      });
    }
  };

  return (
    <View style={styles.root}>
      <Screen contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>Create Series</Text>
          <Text style={styles.subtitle}>Define cadence and defaults once, then launch episodes faster.</Text>
        </View>

        <Card>
          <Text style={styles.sectionTitle}>Series Profile</Text>
          <View style={styles.stack}>
            <Input
              label="Name"
              placeholder="Example: Growth Loops"
              value={name}
              onChangeText={setName}
              maxLength={100}
              error={nameError}
            />
            <TextArea
              label="Description"
              placeholder="What promise does this series deliver each episode?"
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

        <Card variant="pastelBlue">
          <Text style={styles.sectionTitle}>Preview</Text>
          <View style={styles.previewRow}>
            <Text style={styles.previewLabel}>Cadence</Text>
            <Text style={styles.previewValue}>{cadence}</Text>
          </View>
          <View style={styles.previewRow}>
            <Text style={styles.previewLabel}>Template</Text>
            <Text style={styles.previewValue}>{selectedTemplate?.name || 'No default template'}</Text>
          </View>
          <View style={styles.previewRow}>
            <Text style={styles.previewLabel}>Episodes</Text>
            <Text style={styles.previewValue}>Will use your series defaults</Text>
          </View>
        </Card>
      </Screen>

      <StickyActionBar>
        <Button variant="ghost" onPress={() => router.back()}>
          Cancel
        </Button>
        <Button onPress={onCreate} disabled={createSeries.isPending}>
          {createSeries.isPending ? 'Creating...' : 'Create Series'}
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
    paddingTop: spacing['2xl'],
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
  sectionTitle: {
    color: colors.text.DEFAULT,
    fontFamily: typography.fontFamily.heading,
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold,
    marginBottom: spacing.sm,
  },
  stack: {
    gap: spacing.md,
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  previewLabel: {
    color: colors.text.light,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  previewValue: {
    color: colors.text.DEFAULT,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
  },
});
