import { useEffect, useMemo, useRef, useState } from 'react';
import { InteractionManager, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@/components/ui/SymbolIcon';
import { useNavigation, useRouter } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Button, Card, Screen, StickyActionBar } from '@/components/ui';
import { useApiClient } from '@/lib/api';
import { triggerHaptic } from '@/lib/haptics';
import { colors, spacing, typography } from '@/lib/theme';
import { useAuthStore } from '@/stores/auth';
import { useOnboardingStore } from '@/stores/onboarding';

export default function OnboardingCompleteScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const apiClient = useApiClient();
  const { setOnboarded, setHasPersona } = useAuthStore();
  const { persona, choiceHistory, resetOnboarding } = useOnboardingStore();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const summary = useMemo(
    () => [
      { label: 'Niche', value: persona.niche || '-' },
      { label: 'Tone', value: persona.tone || '-' },
      { label: 'Platforms', value: persona.platforms.join(', ') || '-' },
      { label: 'Path choices', value: String(choiceHistory.length) },
    ],
    [choiceHistory.length, persona.niche, persona.platforms, persona.tone]
  );

  const handleFinish = async () => {
    setSaving(true);
    setError(null);

    try {
      await apiClient.post('/users/persona', {
        niche: persona.niche,
        subNiche: persona.subNiche,
        targetAudience: persona.targetAudience,
        audienceAge: persona.audienceAge,
        tone: persona.tone,
        platforms: persona.platforms,
        contentGoal: persona.contentGoal,
        postingFrequency: persona.postingFrequency,
      });

      await apiClient.post('/users/complete-onboarding');
      setOnboarded(true);
      setHasPersona(true);
      resetOnboarding();
      triggerHaptic('success');

      InteractionManager.runAfterInteractions(() => {
        if (mountedRef.current) {
          router.replace('/(main)/(tabs)/home');
        }
      });
    } catch (err: any) {
      triggerHaptic('error');
      if (mountedRef.current) {
        setError(err?.message || 'Could not complete onboarding.');
      }
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  };

  const handleBack = () => {
    if (navigation.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/(main)/(tabs)/home');
  };

  return (
    <View style={styles.root}>
      <Screen contentContainerStyle={styles.content}>
        <Animated.View entering={FadeInDown.duration(220)}>
          <Card variant="elevated">
            <View style={styles.titleRow}>
              <Ionicons name="checkmark-circle" size={24} color={colors.success} />
              <Text style={styles.title}>You are set up</Text>
            </View>
            <Text style={styles.subtitle}>Your defaults are saved. Next: create an episode, record voiceover, and upload clips.</Text>
          </Card>
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(240).delay(80)}>
          <Card>
            <Text style={styles.sectionTitle}>Your creator defaults</Text>
            <View style={styles.summaryGrid}>
              {summary.map((item) => (
                <View key={item.label} style={styles.summaryCard}>
                  <Text style={styles.summaryLabel}>{item.label}</Text>
                  <Text style={styles.summaryValue}>{item.value}</Text>
                </View>
              ))}
            </View>
          </Card>
        </Animated.View>

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </Screen>

      <StickyActionBar>
        <Button variant="ghost" onPress={handleBack}>
          Edit Answers
        </Button>
        <Button onPress={handleFinish} loading={saving} disabled={saving}>
          Save and Continue
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
    paddingBottom: spacing['6xl'],
    gap: spacing.md,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  title: {
    color: colors.text.DEFAULT,
    fontFamily: typography.fontFamily.heading,
    fontSize: typography.fontSize.xl,
    fontWeight: typography.fontWeight.bold,
  },
  subtitle: {
    marginTop: spacing.sm,
    color: colors.text.muted,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.base,
    lineHeight: 23,
  },
  sectionTitle: {
    color: colors.text.DEFAULT,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
    marginBottom: spacing.sm,
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  summaryCard: {
    width: '48%',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    backgroundColor: colors.panel,
    padding: spacing.sm,
  },
  summaryLabel: {
    color: colors.text.light,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  summaryValue: {
    marginTop: spacing.xs,
    color: colors.text.DEFAULT,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    textTransform: 'capitalize',
  },
  error: {
    color: colors.error,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
  },
});
