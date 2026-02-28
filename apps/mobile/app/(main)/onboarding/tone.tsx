import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@/components/ui/SymbolIcon';
import { useNavigation, useRouter } from 'expo-router';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import { Button, Card, Screen, StickyActionBar } from '@/components/ui';
import { type Tone, useOnboardingStore } from '@/stores/onboarding';
import { borderRadius, colors, spacing, typography } from '@/lib/theme';

const TONES: Array<{
  value: Tone;
  label: string;
  hint: string;
  icon: keyof typeof Ionicons.glyphMap;
}> = [
  { value: 'aggressive', label: 'Bold', hint: 'High energy and direct hooks', icon: 'flash-outline' },
  { value: 'calm', label: 'Calm', hint: 'Soft pacing and reflective delivery', icon: 'moon-outline' },
  { value: 'educational', label: 'Educational', hint: 'Clear and structured teaching', icon: 'school-outline' },
  { value: 'motivational', label: 'Motivational', hint: 'Positive and action oriented', icon: 'rocket-outline' },
  { value: 'humorous', label: 'Humorous', hint: 'Light and highly relatable', icon: 'happy-outline' },
];

export default function OnboardingToneScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { persona, setTone, makeChoice } = useOnboardingStore();
  const selected = useMemo(() => persona.tone, [persona.tone]);
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
          <Text style={styles.kicker}>Step 3</Text>
          <Text style={styles.title}>How should your videos sound?</Text>
          <Text style={styles.subtitle}>Tone controls narration rhythm, pacing, and voiceover defaults.</Text>
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(230).delay(70)}>
          <Card variant="pastelPurple">
            <Text style={styles.previewLabel}>Selected tone</Text>
            <Text style={styles.previewValue}>{selected ? selected : 'No tone selected yet'}</Text>
          </Card>
        </Animated.View>

        <Animated.View layout={LinearTransition.springify()} style={styles.stack}>
          {TONES.map((tone, index) => {
            const active = selected === tone.value;
            return (
              <Animated.View key={tone.value} entering={FadeInDown.duration(240).delay(120 + index * 30)}>
                <Card
                  pressable
                  onPress={() => {
                    setTone(tone.value);
                    makeChoice('tone', tone.value);
                  }}
                  style={[styles.toneCard, active && styles.toneCardActive]}
                >
                  <View style={styles.toneRow}>
                    <View style={[styles.iconWrap, active && styles.iconWrapActive]}>
                      <Ionicons name={tone.icon} size={18} color={active ? colors.primary.DEFAULT : colors.text.muted} />
                    </View>
                    <View style={styles.toneTextWrap}>
                      <Text style={[styles.toneLabel, active && styles.toneLabelActive]}>{tone.label}</Text>
                      <Text style={styles.toneHint}>{tone.hint}</Text>
                    </View>
                    {active ? <Ionicons name="checkmark-circle" size={18} color={colors.primary.DEFAULT} /> : null}
                  </View>
                </Card>
              </Animated.View>
            );
          })}
        </Animated.View>
      </Screen>

      <StickyActionBar>
        <Button variant="ghost" onPress={handleBack}>
          Back
        </Button>
        <Button disabled={!selected} onPress={() => router.push('/(main)/onboarding/platform')}>
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
  previewLabel: {
    color: colors.text.light,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  previewValue: {
    marginTop: spacing.xs,
    color: colors.text.DEFAULT,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.medium,
    textTransform: 'capitalize',
  },
  stack: {
    gap: spacing.sm,
  },
  toneCard: {
    backgroundColor: colors.surface,
  },
  toneCardActive: {
    borderColor: colors.primary.DEFAULT,
    backgroundColor: colors.panel,
  },
  toneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.panel,
  },
  iconWrapActive: {
    borderColor: colors.primary.DEFAULT,
  },
  toneTextWrap: {
    flex: 1,
  },
  toneLabel: {
    color: colors.text.DEFAULT,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
  },
  toneLabelActive: {
    color: colors.primary.DEFAULT,
  },
  toneHint: {
    marginTop: 2,
    color: colors.text.muted,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
  },
});
