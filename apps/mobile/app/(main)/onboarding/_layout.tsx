import { useEffect, useMemo, useRef } from 'react';
import { Stack, useNavigation, useRouter, useSegments } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  FadeInDown,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { IconButton } from '@/components/ui';
import { Ionicons } from '@/components/ui/SymbolIcon';
import { useApiClient } from '@/lib/api';
import { colors, motion, spacing, typography } from '@/lib/theme';
import { type Niche, type PersonaData, type Platform, type Tone, useOnboardingStore } from '@/stores/onboarding';

const VALID_NICHES = new Set<Niche>([
  'fitness',
  'business',
  'lifestyle',
  'tech',
  'beauty',
  'food',
  'travel',
  'education',
  'entertainment',
  'gaming',
]);
const VALID_TONES = new Set<Tone>(['aggressive', 'calm', 'educational', 'motivational', 'humorous']);
const VALID_PLATFORMS = new Set<Platform>(['tiktok', 'reels', 'shorts']);

interface ProfileResponse {
  personaData?: {
    niche?: string | null;
    subNiche?: string | null;
    targetAudience?: string | null;
    tone?: string | null;
    platforms?: string[] | null;
  } | null;
}

function mapPlatforms(input: string[] | null | undefined): Platform[] {
  if (!input?.length) return [];
  if (input.includes('all')) return ['tiktok', 'reels', 'shorts'];
  return input.filter((value): value is Platform => VALID_PLATFORMS.has(value as Platform));
}

function routeToStep(route: string): number {
  switch (route) {
    case 'index':
    case 'niche':
      return 0;
    case 'audience':
      return 1;
    case 'tone':
      return 2;
    case 'platform':
      return 3;
    case 'complete':
      return 4;
    default:
      return 0;
  }
}

const STEP_LABELS = ['Niche', 'Audience', 'Tone', 'Platform', 'Review'] as const;

function useHydrateOnboardingPersona(
  apiClient: ReturnType<typeof useApiClient>,
  persona: PersonaData,
  hydrateFromPersona: (persona: Partial<PersonaData>) => void
) {
  const hydratedRef = useRef(false);

  useEffect(() => {
    if (hydratedRef.current) return;
    const hasLocalDraft = !!persona.niche || !!persona.tone || persona.platforms.length > 0 || !!persona.targetAudience;
    if (hasLocalDraft) return;

    hydratedRef.current = true;
    let active = true;

    async function hydrate() {
      try {
        const response = await apiClient.get('/users/profile');
        if (!active) return;
        const profile = response.data as ProfileResponse;
        const serverPersona = profile.personaData;
        if (!serverPersona) return;

        const niche = serverPersona.niche && VALID_NICHES.has(serverPersona.niche as Niche)
          ? (serverPersona.niche as Niche)
          : undefined;
        const tone = serverPersona.tone && VALID_TONES.has(serverPersona.tone as Tone)
          ? (serverPersona.tone as Tone)
          : undefined;

        hydrateFromPersona({
          niche,
          tone,
          subNiche: serverPersona.subNiche || undefined,
          targetAudience: serverPersona.targetAudience || undefined,
          platforms: mapPlatforms(serverPersona.platforms),
        });
      } catch {
        // Best-effort hydration only.
      }
    }

    void hydrate();
    return () => {
      active = false;
    };
  }, [apiClient, hydrateFromPersona, persona.niche, persona.platforms.length, persona.targetAudience, persona.tone]);
}

export default function OnboardingLayout() {
  const segments = useSegments();
  const router = useRouter();
  const navigation = useNavigation();
  const apiClient = useApiClient();
  const insets = useSafeAreaInsets();
  const { setCurrentStep, persona, hydrateFromPersona } = useOnboardingStore();

  const progressValue = useSharedValue(20);
  const pulseA = useSharedValue(0);
  const pulseB = useSharedValue(1);
  useHydrateOnboardingPersona(apiClient, persona, hydrateFromPersona);

  const current = useMemo(() => {
    const route = segments[segments.length - 1] || 'index';
    return routeToStep(route);
  }, [segments]);

  const progress = useMemo(() => ((current + 1) / 5) * 100, [current]);
  const screenTitle = useMemo(() => {
    if (current === 4) return 'Confirm your defaults';
    return 'Build your creator setup';
  }, [current]);

  const progressStyle = useAnimatedStyle(() => ({
    width: `${progressValue.value}%`,
  }));
  const orbAStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(pulseA.value, [0, 1], [0.88, 1.08]) }],
    opacity: interpolate(pulseA.value, [0, 1], [0.18, 0.35]),
  }));
  const orbBStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(pulseB.value, [0, 1], [0.84, 1.15]) }],
    opacity: interpolate(pulseB.value, [0, 1], [0.12, 0.26]),
  }));

  useEffect(() => {
    setCurrentStep(current);
  }, [current, setCurrentStep]);

  useEffect(() => {
    progressValue.value = withTiming(progress, { duration: motion.duration.base });
  }, [progress, progressValue]);

  useEffect(() => {
    pulseA.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 2400, easing: Easing.inOut(Easing.cubic) }),
        withTiming(0, { duration: 2400, easing: Easing.inOut(Easing.cubic) })
      ),
      -1,
      false
    );
    pulseB.value = withRepeat(
      withSequence(
        withTiming(0, { duration: 2800, easing: Easing.inOut(Easing.cubic) }),
        withTiming(1, { duration: 2800, easing: Easing.inOut(Easing.cubic) })
      ),
      -1,
      false
    );
  }, [pulseA, pulseB]);

  const handleBack = () => {
    if (navigation.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/(main)/(tabs)/home');
  };

  return (
    <View style={styles.container}>
      <View pointerEvents="none" style={styles.ambientWrap}>
        <Animated.View style={[styles.ambientOrbA, orbAStyle]} />
        <Animated.View style={[styles.ambientOrbB, orbBStyle]} />
      </View>
      <View style={[styles.header, { paddingTop: Math.max(insets.top, spacing.sm) }]}>
        <View style={styles.topRow}>
          <IconButton
            icon={<Ionicons name="arrow-back" size={18} color={colors.text.DEFAULT} />}
            accessibilityLabel="Go back"
            onPress={handleBack}
          />
          <View style={styles.headlineWrap}>
            <Animated.Text entering={FadeInDown.duration(220)} style={styles.headline}>
              {screenTitle}
            </Animated.Text>
            <Text style={styles.meta}>Step {current + 1} of 5</Text>
          </View>
        </View>

        <View style={styles.track}>
          <Animated.View style={[styles.fill, progressStyle]} />
        </View>
        <View style={styles.stepRail}>
          {STEP_LABELS.map((label, index) => {
            const active = current === index;
            const complete = current > index;
            return (
              <View key={label} style={styles.stepItem}>
                <View
                  style={[
                    styles.stepDot,
                    active && styles.stepDotActive,
                    complete && styles.stepDotComplete,
                  ]}
                />
                <Text style={[styles.stepText, (active || complete) && styles.stepTextActive]}>{label}</Text>
              </View>
            );
          })}
        </View>
      </View>

      <Stack
        screenOptions={{
          headerShown: false,
          animation: 'slide_from_right',
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="niche" />
        <Stack.Screen name="audience" />
        <Stack.Screen name="tone" />
        <Stack.Screen name="platform" />
        <Stack.Screen name="complete" />
      </Stack>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  ambientWrap: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  ambientOrbA: {
    position: 'absolute',
    width: 280,
    height: 280,
    borderRadius: 999,
    top: -130,
    right: -70,
    backgroundColor: '#87D9B0',
  },
  ambientOrbB: {
    position: 'absolute',
    width: 230,
    height: 230,
    borderRadius: 999,
    bottom: 80,
    left: -120,
    backgroundColor: '#C9D9FF',
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    gap: spacing.md,
    backgroundColor: colors.background,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  headlineWrap: {
    flex: 1,
  },
  headline: {
    color: colors.text.DEFAULT,
    fontFamily: typography.fontFamily.heading,
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold,
  },
  meta: {
    marginTop: 2,
    color: colors.text.light,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.xs,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  track: {
    height: 8,
    borderRadius: 999,
    backgroundColor: colors.panelAlt,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  fill: {
    height: '100%',
    backgroundColor: colors.primary.DEFAULT,
  },
  stepRail: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  stepItem: {
    alignItems: 'center',
    gap: 4,
    flex: 1,
  },
  stepDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: colors.border,
  },
  stepDotActive: {
    width: 10,
    height: 10,
    backgroundColor: colors.primary.DEFAULT,
  },
  stepDotComplete: {
    backgroundColor: '#2EAB72',
  },
  stepText: {
    color: colors.text.light,
    fontFamily: typography.fontFamily.body,
    fontSize: 10,
    fontWeight: typography.fontWeight.medium,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  stepTextActive: {
    color: colors.text.DEFAULT,
  },
});
