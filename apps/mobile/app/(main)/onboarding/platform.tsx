import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRouter } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Button, Card, Screen, StickyActionBar } from '@/components/ui';
import { type Platform, useOnboardingStore } from '@/stores/onboarding';
import { colors, spacing, typography } from '@/lib/theme';

const PLATFORMS: Array<{ value: Platform; label: string; hint: string }> = [
  { value: 'tiktok', label: 'TikTok', hint: 'Trend-first and short punchy pacing' },
  { value: 'reels', label: 'Instagram Reels', hint: 'Lifestyle and social discoverability' },
  { value: 'shorts', label: 'YouTube Shorts', hint: 'Search and evergreen distribution' },
];

export default function OnboardingPlatformScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { persona, togglePlatform, makeChoice } = useOnboardingStore();
  const selectedCount = useMemo(() => persona.platforms.length, [persona.platforms]);
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
          <Text style={styles.kicker}>Step 4</Text>
          <Text style={styles.title}>Where will you publish first?</Text>
          <Text style={styles.subtitle}>Pick one or more platforms so WEBL can apply the right edit format defaults.</Text>
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(240).delay(60)}>
          <Card variant="pastelYellow">
            <Text style={styles.counterLabel}>Selected</Text>
            <Text style={styles.counterValue}>{selectedCount} platform(s)</Text>
          </Card>
        </Animated.View>

        <View style={styles.stack}>
          {PLATFORMS.map((platform, index) => {
            const active = persona.platforms.includes(platform.value);
            return (
              <Animated.View key={platform.value} entering={FadeInDown.duration(250).delay(120 + index * 40)}>
                <Card
                  pressable
                  onPress={() => {
                    togglePlatform(platform.value);
                    makeChoice('platform', platform.value);
                  }}
                  style={[styles.platformCard, active && styles.platformCardActive]}
                >
                  <Text style={[styles.platformTitle, active && styles.platformTitleActive]}>{platform.label}</Text>
                  <Text style={styles.platformHint}>{platform.hint}</Text>
                  <Text style={[styles.tag, active && styles.tagActive]}>{active ? 'Selected' : 'Tap to select'}</Text>
                </Card>
              </Animated.View>
            );
          })}
        </View>
      </Screen>

      <StickyActionBar>
        <Button variant="ghost" onPress={handleBack}>
          Back
        </Button>
        <Button disabled={selectedCount === 0} onPress={() => router.push('/(main)/onboarding/complete')}>
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
  counterLabel: {
    color: colors.text.light,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  counterValue: {
    marginTop: spacing.xs,
    color: colors.text.DEFAULT,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold,
  },
  stack: {
    gap: spacing.sm,
  },
  platformCard: {
    backgroundColor: colors.surface,
  },
  platformCardActive: {
    borderColor: colors.primary.DEFAULT,
    backgroundColor: colors.panel,
  },
  platformTitle: {
    color: colors.text.DEFAULT,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
  },
  platformTitleActive: {
    color: colors.primary.DEFAULT,
  },
  platformHint: {
    marginTop: spacing.xs,
    color: colors.text.muted,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
  },
  tag: {
    marginTop: spacing.sm,
    color: colors.text.light,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  tagActive: {
    color: colors.primary.DEFAULT,
  },
});
