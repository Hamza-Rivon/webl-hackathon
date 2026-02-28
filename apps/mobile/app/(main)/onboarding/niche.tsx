import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@/components/ui/SymbolIcon';
import { useNavigation, useRouter } from 'expo-router';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import { Button, Card, Screen, StickyActionBar } from '@/components/ui';
import { type Niche, useOnboardingStore } from '@/stores/onboarding';
import { borderRadius, colors, spacing, typography } from '@/lib/theme';

const NICHES: Array<{ value: Niche; label: string; icon: keyof typeof Ionicons.glyphMap }> = [
  { value: 'fitness', label: 'Fitness & Health', icon: 'barbell-outline' },
  { value: 'business', label: 'Business & Finance', icon: 'briefcase-outline' },
  { value: 'lifestyle', label: 'Lifestyle', icon: 'sunny-outline' },
  { value: 'tech', label: 'Tech & Innovation', icon: 'hardware-chip-outline' },
  { value: 'beauty', label: 'Beauty & Fashion', icon: 'color-palette-outline' },
  { value: 'food', label: 'Food & Cooking', icon: 'restaurant-outline' },
  { value: 'travel', label: 'Travel', icon: 'airplane-outline' },
  { value: 'education', label: 'Education', icon: 'school-outline' },
  { value: 'entertainment', label: 'Entertainment', icon: 'film-outline' },
  { value: 'gaming', label: 'Gaming', icon: 'game-controller-outline' },
];

export default function OnboardingNicheScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { persona, setNiche, makeChoice } = useOnboardingStore();
  const selected = useMemo(() => persona.niche, [persona.niche]);
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
          <Text style={styles.kicker}>Step 1</Text>
          <Text style={styles.title}>What do you create most often?</Text>
          <Text style={styles.subtitle}>We use this to rank templates and script structures that match your content.</Text>
        </Animated.View>

        <Animated.View layout={LinearTransition.springify()} style={styles.grid}>
          {NICHES.map((niche, index) => {
            const active = niche.value === selected;
            return (
              <Animated.View
                key={niche.value}
                entering={FadeInDown.duration(240).delay(index * 35)}
                layout={LinearTransition.springify()}
                style={styles.choiceWrap}
              >
                <Pressable
                  onPress={() => {
                    setNiche(niche.value);
                    makeChoice('niche', niche.value);
                  }}
                  style={[styles.choice, active && styles.choiceActive]}
                >
                  <View style={[styles.iconWrap, active && styles.iconWrapActive]}>
                    <Ionicons
                      name={niche.icon}
                      size={18}
                      color={active ? colors.primary.DEFAULT : colors.text.muted}
                    />
                  </View>
                  <Text style={[styles.choiceLabel, active && styles.choiceLabelActive]}>{niche.label}</Text>
                </Pressable>
              </Animated.View>
            );
          })}
        </Animated.View>

        <Card variant="pastelBlue">
          <Text style={styles.helperText}>Tip: pick your main niche now. You can refine it later from profile.</Text>
        </Card>
      </Screen>

      <StickyActionBar>
        <Button variant="ghost" onPress={handleBack}>
          Back
        </Button>
        <Button disabled={!selected} onPress={() => router.push('/(main)/onboarding/audience')}>
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
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  choiceWrap: {
    width: '48%',
  },
  choice: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surface,
    padding: spacing.md,
    gap: spacing.sm,
    minHeight: 90,
  },
  choiceActive: {
    borderColor: colors.primary.DEFAULT,
    backgroundColor: colors.panel,
  },
  iconWrap: {
    width: 32,
    height: 32,
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
  choiceLabel: {
    color: colors.text.DEFAULT,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
  },
  choiceLabelActive: {
    color: colors.primary.DEFAULT,
  },
  helperText: {
    color: colors.text.muted,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
    lineHeight: 20,
  },
});
