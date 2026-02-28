import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button, Card, Progress, Screen, StickyActionBar } from '@/components/ui';
import { useTemplate } from '@/hooks/useTemplates';
import { colors, spacing, typography } from '@/lib/theme';

function formatDuration(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

function formatRate(value: number | null) {
  if (value === null || Number.isNaN(value)) return 'N/A';
  return `${Math.round(value * 100)}%`;
}

function normalizeBeatLabel(value: string) {
  return value.replaceAll('_', ' ');
}

export default function TemplateDetailScreen() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const templateQuery = useTemplate(id);
  const [showFullScript, setShowFullScript] = useState(false);

  const template = templateQuery.data;

  const beats = useMemo(() => template?.scriptStructure?.beats || [], [template?.scriptStructure?.beats]);
  const totalBeatDuration = useMemo(() => beats.reduce((sum, beat) => sum + beat.duration, 0), [beats]);

  if (templateQuery.isLoading) {
    return (
      <Screen contentContainerStyle={styles.content}>
        <Text style={styles.muted}>Loading template...</Text>
      </Screen>
    );
  }

  if (!template) {
    return (
      <Screen contentContainerStyle={styles.content}>
        <Text style={styles.title}>Template not found</Text>
        <Text style={styles.muted}>This template may have been removed.</Text>
        <Button variant="outline" onPress={() => router.back()}>
          Go Back
        </Button>
      </Screen>
    );
  }

  const scriptText = template.canonicalScript || '';
  const captionStyle =
    typeof template.editingRecipe.captionStyle === 'string'
      ? template.editingRecipe.captionStyle
      : template.editingRecipe.captionStyle?.animation || 'custom';

  return (
    <View style={styles.root}>
      <Screen contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>{template.name}</Text>
          <Text style={styles.subtitle}>{template.description || 'Production-ready format with tuned pacing.'}</Text>
          <View style={styles.metaRow}>
            <Text style={styles.badge}>{template.platform}</Text>
            <Text style={styles.badge}>{formatDuration(template.durationTarget)}</Text>
            {template.niche ? <Text style={styles.badge}>{template.niche}</Text> : null}
          </View>
        </View>

        <Card>
          <Text style={styles.sectionTitle}>Performance Snapshot</Text>
          <View style={styles.kpiGrid}>
            <View style={styles.kpiCard}>
              <Text style={styles.kpiValue}>{template.viewCount.toLocaleString()}</Text>
              <Text style={styles.kpiLabel}>Views</Text>
            </View>
            <View style={styles.kpiCard}>
              <Text style={styles.kpiValue}>{formatRate(template.retentionRate)}</Text>
              <Text style={styles.kpiLabel}>Retention</Text>
            </View>
            <View style={styles.kpiCard}>
              <Text style={styles.kpiValue}>{formatRate(template.saveRate)}</Text>
              <Text style={styles.kpiLabel}>Save Rate</Text>
            </View>
          </View>
        </Card>

        <Card>
          <Text style={styles.sectionTitle}>Beat Structure</Text>
          <Text style={styles.muted}>{beats.length} beats • planned {formatDuration(totalBeatDuration)}</Text>
          <View style={styles.stackTop}>
            {beats.map((beat, index) => {
              const normalizedDuration = totalBeatDuration > 0 ? (beat.duration / totalBeatDuration) * 100 : 0;
              return (
                <View key={`${beat.type}_${index}`} style={styles.beatItem}>
                  <View style={styles.beatHeader}>
                    <Text style={styles.beatLabel}>{normalizeBeatLabel(beat.type)}</Text>
                    <Text style={styles.beatDuration}>{formatDuration(beat.duration)}</Text>
                  </View>
                  <Progress value={normalizedDuration} size="sm" />
                  <Text style={styles.beatDescription}>{beat.description}</Text>
                </View>
              );
            })}
          </View>
        </Card>

        <Card>
          <Text style={styles.sectionTitle}>Script Example</Text>
          <Text numberOfLines={showFullScript ? undefined : 8} style={styles.scriptText}>
            {scriptText || 'No canonical script supplied for this template.'}
          </Text>
          {scriptText.length > 250 ? (
            <View style={styles.stackTop}>
              <Button variant="ghost" onPress={() => setShowFullScript((current) => !current)}>
                {showFullScript ? 'Show Less' : 'Show Full Script'}
              </Button>
            </View>
          ) : null}
        </Card>

        <Card variant="pastelBlue">
          <Text style={styles.sectionTitle}>Editing Recipe</Text>
          <View style={styles.metaRowBetween}>
            <Text style={styles.metaKey}>Cut rhythm</Text>
            <Text style={styles.metaValue}>{template.editingRecipe.cutRhythm}</Text>
          </View>
          <View style={styles.metaRowBetween}>
            <Text style={styles.metaKey}>Caption style</Text>
            <Text style={styles.metaValue}>{captionStyle}</Text>
          </View>
          <View style={styles.metaRowBetween}>
            <Text style={styles.metaKey}>Music</Text>
            <Text style={styles.metaValue}>{template.editingRecipe.musicType}</Text>
          </View>
        </Card>
      </Screen>

      <StickyActionBar>
        <Button variant="ghost" onPress={() => router.back()}>
          Back
        </Button>
        <Button
          onPress={() =>
            router.push({
              pathname: '/(main)/episode/new',
              params: { templateId: template.id },
            })
          }
        >
          Use Template
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
    lineHeight: 22,
  },
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    color: colors.primary.DEFAULT,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
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
  metaRow: {
    marginTop: spacing.sm,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  kpiGrid: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  kpiCard: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: spacing.md,
    padding: spacing.sm,
    backgroundColor: colors.panel,
    gap: 2,
  },
  kpiValue: {
    color: colors.text.DEFAULT,
    fontFamily: typography.fontFamily.mono,
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold,
  },
  kpiLabel: {
    color: colors.text.light,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  stackTop: {
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  beatItem: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: spacing.md,
    padding: spacing.sm,
    gap: spacing.xs,
  },
  beatHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  beatLabel: {
    color: colors.text.DEFAULT,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    textTransform: 'capitalize',
  },
  beatDuration: {
    color: colors.text.light,
    fontFamily: typography.fontFamily.mono,
    fontSize: typography.fontSize.xs,
  },
  beatDescription: {
    color: colors.text.muted,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
    lineHeight: 20,
  },
  scriptText: {
    color: colors.text.muted,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.base,
    lineHeight: 22,
  },
  metaRowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  metaKey: {
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
    textTransform: 'capitalize',
  },
});
