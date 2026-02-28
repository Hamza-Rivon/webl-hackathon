import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRouter } from 'expo-router';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import { Button, Card, Input, Screen, StickyActionBar } from '@/components/ui';
import { type AudienceAge, type ContentGoal, useOnboardingStore } from '@/stores/onboarding';
import { borderRadius, colors, spacing, typography } from '@/lib/theme';

const AGES: Array<{ value: AudienceAge; label: string }> = [
  { value: '13-17', label: '13-17' },
  { value: '18-24', label: '18-24' },
  { value: '25-34', label: '25-34' },
  { value: '35-44', label: '35-44' },
  { value: '45+', label: '45+' },
];

const GOALS: Array<{ value: ContentGoal; label: string }> = [
  { value: 'grow_audience', label: 'Grow Audience' },
  { value: 'monetize', label: 'Monetize' },
  { value: 'brand_awareness', label: 'Brand Awareness' },
  { value: 'community', label: 'Community' },
  { value: 'education', label: 'Education' },
];

export default function OnboardingAudienceScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { persona, setAudienceAge, setContentGoal, setTargetAudience, makeChoice } = useOnboardingStore();
  const handleBack = () => {
    if (navigation.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/(main)/(tabs)/home');
  };

  const selectedSummary = useMemo(() => {
    const parts = [persona.audienceAge, persona.contentGoal?.replace('_', ' '), persona.targetAudience]
      .filter(Boolean)
      .map((value) => String(value));
    return parts.length > 0 ? parts.join('  •  ') : 'Optional details for better recommendations';
  }, [persona.audienceAge, persona.contentGoal, persona.targetAudience]);

  return (
    <View style={styles.root}>
      <Screen contentContainerStyle={styles.content}>
        <Animated.View entering={FadeInDown.duration(220)}>
          <Text style={styles.kicker}>Step 2</Text>
          <Text style={styles.title}>Who should your content help?</Text>
          <Text style={styles.subtitle}>Optional, but this improves hook writing and call-to-action defaults.</Text>
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(230).delay(70)}>
          <Card variant="pastelGreen">
            <Text style={styles.summaryTitle}>Current targeting signal</Text>
            <Text style={styles.summaryText}>{selectedSummary}</Text>
          </Card>
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(240).delay(110)}>
          <Card>
            <Text style={styles.label}>Audience Age (Optional)</Text>
            <Animated.View layout={LinearTransition.springify()} style={styles.rowWrap}>
              {AGES.map((age) => {
                const active = persona.audienceAge === age.value;
                return (
                  <Button
                    key={age.value}
                    variant={active ? 'primary' : 'outline'}
                    size="sm"
                    style={styles.pill}
                    onPress={() => {
                      setAudienceAge(age.value);
                      makeChoice('audienceAge', age.value);
                    }}
                  >
                    {age.label}
                  </Button>
                );
              })}
            </Animated.View>
          </Card>
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(250).delay(150)}>
          <Card>
            <Text style={styles.label}>Primary Goal (Optional)</Text>
            <View style={styles.goalStack}>
              {GOALS.map((goal) => {
                const active = persona.contentGoal === goal.value;
                return (
                  <Button
                    key={goal.value}
                    variant={active ? 'primary' : 'outline'}
                    onPress={() => {
                      setContentGoal(goal.value);
                      makeChoice('contentGoal', goal.value);
                    }}
                  >
                    {goal.label}
                  </Button>
                );
              })}
            </View>
          </Card>
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(250).delay(190)}>
          <Input
            label="Describe your ideal viewer"
            placeholder="Example: busy founders who need short, practical growth tips"
            value={persona.targetAudience || ''}
            onChangeText={setTargetAudience}
          />
        </Animated.View>
      </Screen>

      <StickyActionBar>
        <Button variant="ghost" onPress={handleBack}>
          Back
        </Button>
        <Button onPress={() => router.push('/(main)/onboarding/tone')}>
          Continue
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
  kicker: {
    color: colors.primary.DEFAULT,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  title: {
    marginTop: spacing.xs,
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
  summaryTitle: {
    color: colors.text.light,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  summaryText: {
    marginTop: spacing.xs,
    color: colors.text.DEFAULT,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
    lineHeight: 20,
    textTransform: 'capitalize',
  },
  label: {
    marginBottom: spacing.sm,
    color: colors.text.DEFAULT,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
  },
  rowWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  pill: {
    width: 'auto',
    minWidth: 72,
    borderRadius: borderRadius.full,
  },
  goalStack: {
    gap: spacing.sm,
  },
});
