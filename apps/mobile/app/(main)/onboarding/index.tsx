import { useEffect, useRef, useState } from 'react';
import { InteractionManager, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@/components/ui/SymbolIcon';
import { Button, Card, Screen, StickyActionBar } from '@/components/ui';
import { useApiClient } from '@/lib/api';
import { borderRadius, colors, spacing, typography } from '@/lib/theme';
import { useAuthStore } from '@/stores/auth';
import { useOnboardingStore } from '@/stores/onboarding';

// Royalty-free content creation illustration (Popsy - free for commercial use)
const HERO_IMAGE_URI =
  'https://illustrations.popsy.co/amber/content-creation.svg';

export default function OnboardingIntro() {
  const router = useRouter();
  const apiClient = useApiClient();
  const { setOnboarded } = useAuthStore();
  const { resetOnboarding } = useOnboardingStore();
  const [isSkipping, setIsSkipping] = useState(false);
  const [heroImageError, setHeroImageError] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const handleSkip = async () => {
    if (isSkipping) return;
    setIsSkipping(true);
    try {
      await apiClient.post('/users/complete-onboarding');
      // Mark onboarded so the _layout redirect stops enforcing onboarding.
      setOnboarded(true);
      // Defer navigation to the next frame so React can settle the store
      // update and the parent layout can re-render before we mutate the
      // navigation state — prevents the freeze / unresponsive-buttons bug.
      InteractionManager.runAfterInteractions(() => {
        if (mountedRef.current) {
          router.replace('/(main)/(tabs)/home');
        }
      });
    } catch {
      if (mountedRef.current) setIsSkipping(false);
    }
  };

  const floatY = useSharedValue(0);
  useEffect(() => {
    floatY.value = withRepeat(
      withSequence(
        withTiming(-6, { duration: 2000 }),
        withTiming(0, { duration: 2000 })
      ),
      -1,
      true
    );
  }, [floatY]);

  const heroAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: floatY.value }],
  }));

  return (
    <View style={styles.root}>
      <Screen contentContainerStyle={styles.content}>
        <Animated.View
          entering={FadeInDown.duration(320).springify().damping(18)}
        >
          <Text style={styles.kicker}>60-second setup</Text>
          <Text style={styles.title}>Get to your first publish-ready short faster</Text>
          <Text style={styles.subtitle}>
            Answer five quick questions so WEBL can pre-fill scripts, voice style, and clip guidance for every episode.
          </Text>
        </Animated.View>

        <Animated.View
          entering={FadeInDown.duration(320).delay(80).springify().damping(18)}
          style={styles.heroWrap}
        >
          <Card variant="elevated" style={styles.heroCard}>
            <Animated.View style={[styles.heroImageWrap, heroAnimatedStyle]}>
              {heroImageError ? (
                <View style={styles.heroFallback}>
                  <View style={styles.heroBarRow}>
                    <View style={[styles.heroBar, styles.heroBarShort]} />
                    <View style={[styles.heroBar, styles.heroBarMid]} />
                    <View style={[styles.heroBar, styles.heroBarTall]} />
                    <View style={[styles.heroBar, styles.heroBarShort]} />
                    <View style={[styles.heroBar, styles.heroBarTall]} />
                  </View>
                  <Text style={styles.heroFallbackLabel}>Your growth journey</Text>
                </View>
              ) : (
                <Image
                  source={{ uri: HERO_IMAGE_URI }}
                  style={styles.heroImage}
                  contentFit="contain"
                  onError={() => setHeroImageError(true)}
                />
              )}
            </Animated.View>
            <Text style={styles.chartCaption}>
              Plan quality compounds over time with consistent persona settings.
            </Text>
          </Card>
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(280).delay(160).springify().damping(18)}>
          <Card>
            <View style={styles.featureRow}>
              <View style={styles.featureIconWrap}>
                <Ionicons name="flame-outline" size={18} color={colors.primary.DEFAULT} />
              </View>
              <Text style={styles.featureText}>Stronger hook and script defaults</Text>
            </View>
            <View style={styles.featureRow}>
              <View style={styles.featureIconWrap}>
                <Ionicons name="layers-outline" size={18} color={colors.primary.DEFAULT} />
              </View>
              <Text style={styles.featureText}>Better template and slot recommendations</Text>
            </View>
            <View style={styles.featureRow}>
              <View style={styles.featureIconWrap}>
                <Ionicons name="rocket-outline" size={18} color={colors.primary.DEFAULT} />
              </View>
              <Text style={styles.featureText}>Faster path from script to final render</Text>
            </View>
          </Card>
        </Animated.View>
      </Screen>

      <StickyActionBar showQuickNav={false}>
        <Button
          size="lg"
          onPress={() => {
            resetOnboarding();
            router.push('/(main)/onboarding/niche');
          }}
        >
          Start 5-Step Setup
        </Button>
        <Button
          variant="ghost"
          onPress={handleSkip}
          loading={isSkipping}
          disabled={isSkipping}
        >
          Skip for now
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
    paddingTop: spacing.xl,
    paddingBottom: spacing['6xl'],
    gap: spacing.lg,
  },
  kicker: {
    color: colors.primary.DEFAULT,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.9,
  },
  title: {
    marginTop: spacing.xs,
    color: colors.text.DEFAULT,
    fontFamily: typography.fontFamily.heading,
    fontSize: typography.fontSize['3xl'],
    fontWeight: typography.fontWeight.bold,
    lineHeight: 40,
  },
  subtitle: {
    marginTop: spacing.sm,
    color: colors.text.muted,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.base,
    lineHeight: 24,
  },
  heroWrap: {
    marginVertical: spacing.xs,
  },
  heroCard: {
    gap: spacing.md,
    overflow: 'hidden',
  },
  heroImageWrap: {
    height: 160,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(14, 165, 168, 0.06)',
    borderRadius: borderRadius.md,
    overflow: 'hidden',
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  heroFallback: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  heroBarRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 12,
    height: 80,
  },
  heroBar: {
    width: 14,
    borderRadius: 7,
    backgroundColor: colors.primary.DEFAULT,
  },
  heroBarShort: {
    height: 28,
    opacity: 0.5,
  },
  heroBarMid: {
    height: 48,
    opacity: 0.8,
  },
  heroBarTall: {
    height: 64,
  },
  heroFallbackLabel: {
    fontSize: typography.fontSize.xs,
    color: colors.text.muted,
    fontWeight: typography.fontWeight.medium,
  },
  chartCaption: {
    color: colors.text.muted,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
    lineHeight: 20,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xs,
  },
  featureIconWrap: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.full,
    backgroundColor: 'rgba(14, 165, 168, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureText: {
    flex: 1,
    color: colors.text.DEFAULT,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.base,
  },
});
