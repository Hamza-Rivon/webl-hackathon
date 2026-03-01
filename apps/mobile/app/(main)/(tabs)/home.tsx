import React, { useEffect, useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { useUser } from '@clerk/clerk-expo';
import { useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@/components/ui/SymbolIcon';
import { Skeleton } from '@/components/ui';
import { HeroCarousel } from '@/components/home/HeroCarousel';
import { CinematicStoriesRail } from '@/components/stories/CinematicStoriesRail';
import { SeriesRow } from '@/components/home/SeriesRow';
import { QuickStats } from '@/components/home/QuickStats';
import { PipelineWidget } from '@/components/home/PipelineWidget';
import { useEpisodes, episodeKeys } from '@/hooks/useEpisodes';
import type { EpisodeWithSeries } from '@/hooks/useEpisodes';
import { useSeries, seriesKeys } from '@/hooks/useSeries';
import { useJobs } from '@/hooks/useJobProgress';
import { useHomeRealtimeUpdates } from '@/hooks/useRealtimeUpdates';
import { colors, typography, spacing, borderRadius } from '@/lib/theme';
import { useTheme } from '@/contexts/ThemeContext';
import { sortJobsByPipelineOrder } from '@/lib/pipeline';
import { trackPrimaryAction, trackScreenView } from '@/lib/analytics';
import { useNotificationStore } from '@/stores/notifications';
import { useAuthStore } from '@/stores/auth';
import { triggerHaptic } from '@/lib/haptics';

type EnrichedEpisode = EpisodeWithSeries & {
  muxFinalPlaybackId?: string | null;
  muxPlaybackUrl?: string | null;
  thumbnailUrl?: string | null;
  finalVideoUrl?: string | null;
};

function getGreeting(name: string) {
  const hour = new Date().getHours();
  const prefix = hour < 12 ? 'Morning' : hour < 18 ? 'Afternoon' : 'Evening';
  return `Good ${prefix}, ${name}`;
}

export default function HomeScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const isFocused = pathname === '/home' || pathname === '/';
  const queryClient = useQueryClient();
  const { user } = useUser();
  const unreadNotifications = useNotificationStore((state) => state.unreadCount);
  const hasPersona = useAuthStore((state) => state.hasPersona);
  const { isDark: isDarkMode, toggle: toggleTheme } = useTheme();
  const t = isDarkMode ? darkTheme : lightTheme;

  const { data: episodes, isLoading: episodesLoading } = useEpisodes();
  const { data: series } = useSeries();
  const { data: jobs } = useJobs({ status: 'processing' }, { enabled: isFocused });

  useHomeRealtimeUpdates(isFocused);

  useEffect(() => {
    trackScreenView('home');
  }, []);

  const allEpisodes = useMemo(() => (episodes || []) as EnrichedEpisode[], [episodes]);
  const activeJobs = useMemo(() => sortJobsByPipelineOrder(jobs || []).slice(0, 4), [jobs]);

  const heroEpisodes = useMemo(
    () =>
      allEpisodes
        .filter((ep) => ep.status === 'ready' || ep.status === 'published')
        .slice(0, 5),
    [allEpisodes]
  );

  const readyCount = useMemo(
    () => allEpisodes.filter((ep) => ep.status === 'ready' || ep.status === 'published').length,
    [allEpisodes]
  );
  const processingCount = useMemo(
    () =>
      allEpisodes.filter(
        (ep) =>
          ep.status !== 'ready' &&
          ep.status !== 'published' &&
          ep.status !== 'draft' &&
          ep.status !== 'failed'
      ).length,
    [allEpisodes]
  );
  const draftCount = useMemo(
    () => allEpisodes.filter((ep) => ep.status === 'draft').length,
    [allEpisodes]
  );

  const seriesGrouped = useMemo(() => {
    const groups = new Map<string, { name: string; episodes: EnrichedEpisode[] }>();
    for (const ep of allEpisodes) {
      if (!ep.seriesId || !ep.series?.name) continue;
      if (!groups.has(ep.seriesId)) {
        groups.set(ep.seriesId, { name: ep.series.name, episodes: [] });
      }
      groups.get(ep.seriesId)!.episodes.push(ep);
    }
    return Array.from(groups.values())
      .filter((g) => g.episodes.length > 0)
      .sort((a, b) => {
        const aLatest = Math.max(...a.episodes.map((e) => new Date(e.updatedAt).getTime()));
        const bLatest = Math.max(...b.episodes.map((e) => new Date(e.updatedAt).getTime()));
        return bLatest - aLatest;
      });
  }, [allEpisodes]);

  const standaloneEpisodes = useMemo(
    () => allEpisodes.filter((ep) => !ep.seriesId).slice(0, 10),
    [allEpisodes]
  );

  const recentlyUpdated = useMemo(
    () => [...allEpisodes].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()).slice(0, 10),
    [allEpisodes]
  );

  const heroName = user?.firstName || 'Creator';

  const handleOpenEpisode = (id: string) => {
    trackPrimaryAction('home_open_episode', { episodeId: id });
    router.push(`/(main)/episode/${id}`);
  };

  const handlePlayEpisode = (id: string) => {
    trackPrimaryAction('home_play_episode', { episodeId: id });
    router.push(`/(main)/episode/${id}/preview`);
  };

  const refreshAll = async () => {
    trackPrimaryAction('home_refresh');
    triggerHaptic('medium');
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: episodeKeys.all }),
      queryClient.invalidateQueries({ queryKey: seriesKeys.all }),
    ]);
  };

  if (episodesLoading) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top, backgroundColor: t.bg }]}>
        <View style={styles.loadingContainer}>
          <Skeleton height={420} radius="xl" />
          <View style={styles.loadingRow}>
            <Skeleton height={80} width="30%" radius="lg" />
            <Skeleton height={80} width="30%" radius="lg" />
            <Skeleton height={80} width="30%" radius="lg" />
          </View>
          <Skeleton height={200} radius="lg" />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: t.bg }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + 120 },
        ]}
      >
        {/* Top navigation bar */}
        <Animated.View
          entering={FadeIn.duration(300)}
          style={[styles.navBar, { paddingTop: insets.top + spacing.sm }]}
        >
          <View style={styles.navLeft}>
            <Text style={[styles.logo, { color: t.accent }]}>WEBL</Text>
          </View>
          <View style={styles.navRight}>
            <Pressable
              onPress={() => {
                triggerHaptic('light');
                toggleTheme();
              }}
              style={[styles.navIconBtn, { backgroundColor: t.toggleBg }]}
            >
              <Ionicons name={isDarkMode ? 'sunny-outline' : 'moon-outline'} size={18} color={t.toggleIcon} />
            </Pressable>
            <Pressable
              onPress={() => {
                triggerHaptic('light');
                router.push('/(main)/episode/new');
              }}
              style={[styles.navIconBtn, { backgroundColor: t.iconButtonBg }]}
            >
              <Ionicons name="add-circle" size={24} color={t.accent} />
            </Pressable>
            <Pressable
              onPress={() => router.push('/(main)/notifications' as never)}
              style={[styles.navIconBtn, { backgroundColor: t.iconButtonBg }]}
            >
              <Ionicons name="notifications-outline" size={22} color={t.text} />
              {unreadNotifications > 0 ? (
                <View style={styles.notifDot}>
                  <Text style={styles.notifCount}>
                    {unreadNotifications > 9 ? '9+' : unreadNotifications}
                  </Text>
                </View>
              ) : null}
            </Pressable>
            <Pressable
              onPress={() => void refreshAll()}
              style={[styles.navIconBtn, { backgroundColor: t.iconButtonBg }]}
            >
              <Ionicons name="refresh-outline" size={20} color={t.textMuted} />
            </Pressable>
          </View>
        </Animated.View>

        {/* Greeting */}
        <Animated.View entering={FadeInDown.delay(100).duration(350)} style={styles.greetingSection}>
          <Text style={[styles.greeting, { color: t.text }]}>{getGreeting(heroName)}</Text>
          <Text style={[styles.greetingSub, { color: t.textMuted }]}>
            {allEpisodes.length > 0
              ? `${readyCount} videos ready · ${allEpisodes.length} total episodes`
              : 'Start creating your first video episode'}
          </Text>
        </Animated.View>

        {/* Onboarding banner */}
        {!hasPersona ? (
          <Animated.View entering={FadeInDown.delay(150).duration(300)}>
            <Pressable
              onPress={() => router.push('/(main)/onboarding' as never)}
              style={({ pressed }) => [
                styles.onboardBanner,
                {
                  backgroundColor: t.bannerCardBg,
                  borderColor: t.bannerBorder,
                },
                pressed && styles.bannerPressed,
              ]}
            >
              <LinearGradient
                colors={[t.bannerGradientStart, t.bannerGradientEnd]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.onboardGradient}
              />
              <Ionicons name="sparkles" size={18} color="#F59E0B" />
              <View style={styles.onboardTextWrap}>
                <Text style={[styles.onboardTitle, { color: t.bannerTitle }]}>Complete Your Setup</Text>
                <Text style={[styles.onboardSub, { color: t.bannerSub }]}>5-step setup for smarter defaults</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={t.bannerSub} />
            </Pressable>
          </Animated.View>
        ) : null}

        {/* Hero Carousel */}
        {heroEpisodes.length > 0 ? (
          <HeroCarousel
            episodes={heroEpisodes}
            onPlay={handlePlayEpisode}
            onOpen={handleOpenEpisode}
          />
        ) : null}

        {/* Stories */}
        <CinematicStoriesRail
          episodes={allEpisodes}
          onOpenEpisode={handleOpenEpisode}
          themeMode={isDarkMode ? 'dark' : 'light'}
        />

        {/* Quick Stats */}
        <QuickStats
          themeMode={isDarkMode ? 'dark' : 'light'}
          stats={[
            {
              value: readyCount,
              label: 'Ready',
              icon: 'checkmark-circle',
              color: '#22C55E',
              onPress: () => router.push('/(main)/(tabs)/feed'),
            },
            {
              value: processingCount,
              label: 'Processing',
              icon: 'hourglass',
              color: '#F59E0B',
              onPress: () => router.push('/(main)/(tabs)/jobs'),
            },
            {
              value: draftCount,
              label: 'Drafts',
              icon: 'document-text',
              color: '#5CF6FF',
            },
            {
              value: series?.length || 0,
              label: 'Series',
              icon: 'layers',
              color: '#A78BFA',
              onPress: () => router.push('/(main)/(tabs)/series'),
            },
          ]}
        />

        {/* Active Pipeline */}
        {activeJobs.length > 0 ? (
          <PipelineWidget
            jobs={activeJobs}
            onPress={() => router.push('/(main)/(tabs)/jobs')}
            themeMode={isDarkMode ? 'dark' : 'light'}
          />
        ) : null}

        {/* Recently Updated */}
        {recentlyUpdated.length > 0 ? (
          <SeriesRow
            title="Recently Updated"
            subtitle="Continue where you left off"
            episodes={recentlyUpdated}
            onPressEpisode={handleOpenEpisode}
            variant="wide"
            themeMode={isDarkMode ? 'dark' : 'light'}
          />
        ) : null}

        {/* Series-based rows */}
        {seriesGrouped.map((group) => (
          <SeriesRow
            key={group.name}
            title={group.name}
            subtitle={`${group.episodes.length} episode${group.episodes.length !== 1 ? 's' : ''}`}
            episodes={group.episodes}
            onPressEpisode={handleOpenEpisode}
            themeMode={isDarkMode ? 'dark' : 'light'}
            onPressSeeAll={() => {
              const seriesId = group.episodes[0]?.seriesId;
              if (seriesId) router.push(`/(main)/series/${seriesId}` as never);
            }}
          />
        ))}

        {/* Standalone episodes */}
        {standaloneEpisodes.length > 0 ? (
          <SeriesRow
            title="Standalone Episodes"
            subtitle="Not part of any series"
            episodes={standaloneEpisodes}
            onPressEpisode={handleOpenEpisode}
            themeMode={isDarkMode ? 'dark' : 'light'}
          />
        ) : null}

        {/* Quick Actions */}
        <Animated.View entering={FadeIn.delay(300).duration(300)} style={styles.quickActions}>
          <Pressable
            onPress={() => {
              triggerHaptic('medium');
              trackPrimaryAction('home_new_episode');
              router.push('/(main)/episode/new');
            }}
            style={({ pressed }) => [styles.actionCard, styles.actionCardPrimary, pressed && styles.actionPressed]}
          >
            <View style={styles.actionIconWrap}>
              <Ionicons name="add-circle" size={28} color="#000" />
            </View>
            <Text style={styles.actionTitle}>New Episode</Text>
            <Text style={styles.actionSubPrimary}>Create from scratch</Text>
          </Pressable>

          <Pressable
            onPress={() => {
              triggerHaptic('light');
              trackPrimaryAction('home_new_series');
              router.push('/(main)/series/new');
            }}
            style={({ pressed }) => [
              styles.actionCard,
              {
                backgroundColor: t.actionCardBg,
                borderColor: t.actionCardBorder,
              },
              pressed && styles.actionPressed,
            ]}
          >
            <View style={[styles.actionIconWrap, styles.actionIconAlt, { backgroundColor: t.actionIconAltBg }]}>
              <Ionicons name="layers" size={24} color="#A78BFA" />
            </View>
            <Text style={[styles.actionTitleAlt, { color: t.actionTitle }]}>New Series</Text>
            <Text style={[styles.actionSub, { color: t.actionSub }]}>Group episodes</Text>
          </Pressable>

          <Pressable
            onPress={() => {
              triggerHaptic('light');
              trackPrimaryAction('home_browse_templates');
              router.push('/(main)/(tabs)/templates');
            }}
            style={({ pressed }) => [
              styles.actionCard,
              {
                backgroundColor: t.actionCardBg,
                borderColor: t.actionCardBorder,
              },
              pressed && styles.actionPressed,
            ]}
          >
            <View style={[styles.actionIconWrap, styles.actionIconAlt, { backgroundColor: t.actionIconAltBg }]}>
              <Ionicons name="grid" size={24} color="#F59E0B" />
            </View>
            <Text style={[styles.actionTitleAlt, { color: t.actionTitle }]}>Templates</Text>
            <Text style={[styles.actionSub, { color: t.actionSub }]}>Browse presets</Text>
          </Pressable>
        </Animated.View>

        {/* Empty state for new users */}
        {allEpisodes.length === 0 ? (
          <Animated.View entering={FadeInDown.delay(200).duration(400)} style={styles.emptyHero}>
            <View style={[styles.emptyIconWrap, { backgroundColor: t.emptyIconBg }]}>
              <Ionicons name="videocam" size={48} color="#5CF6FF" />
            </View>
            <Text style={[styles.emptyTitle, { color: t.emptyTitle }]}>Welcome to WEBL</Text>
            <Text style={[styles.emptyDesc, { color: t.emptyDesc }]}>
              Your AI-powered video studio. Create episodes, build series, and publish
              production-quality content.
            </Text>
            <Pressable
              onPress={() => router.push('/(main)/episode/new')}
              style={({ pressed }) => [styles.emptyBtn, pressed && styles.actionPressed]}
            >
              <Ionicons name="add" size={18} color="#000" />
              <Text style={styles.emptyBtnText}>Create Your First Episode</Text>
            </Pressable>
          </Animated.View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const darkTheme = {
  bg: '#0A0E14',
  text: '#FFFFFF',
  textMuted: 'rgba(255,255,255,0.62)',
  accent: '#5CF6FF',
  toggleBg: 'rgba(255,255,255,0.08)',
  toggleIcon: '#F59E0B',
  iconButtonBg: 'rgba(255,255,255,0.05)',
  bannerCardBg: 'rgba(255,255,255,0.03)',
  bannerGradientStart: 'rgba(92,246,255,0.12)',
  bannerGradientEnd: 'rgba(245,158,11,0.08)',
  bannerBorder: 'rgba(245,158,11,0.25)',
  bannerTitle: '#FFFFFF',
  bannerSub: 'rgba(255,255,255,0.72)',
  actionCardBg: 'rgba(255,255,255,0.05)',
  actionCardBorder: 'rgba(255,255,255,0.08)',
  actionIconAltBg: 'rgba(255,255,255,0.1)',
  actionTitle: '#FFFFFF',
  actionSub: 'rgba(255,255,255,0.74)',
  emptyIconBg: 'rgba(92,246,255,0.1)',
  emptyTitle: '#FFFFFF',
  emptyDesc: 'rgba(255,255,255,0.72)',
};

const lightTheme = {
  bg: '#FFFFFF',
  text: colors.text.DEFAULT,
  textMuted: colors.text.muted,
  accent: colors.primary.DEFAULT,
  toggleBg: 'rgba(16,35,61,0.06)',
  toggleIcon: colors.text.DEFAULT,
  iconButtonBg: 'rgba(16,35,61,0.04)',
  bannerCardBg: '#F8F9FA',
  bannerGradientStart: 'rgba(14,165,168,0.08)',
  bannerGradientEnd: 'rgba(245,158,11,0.08)',
  bannerBorder: 'rgba(16,35,61,0.08)',
  bannerTitle: colors.text.DEFAULT,
  bannerSub: colors.text.muted,
  actionCardBg: '#F8F9FA',
  actionCardBorder: 'rgba(0,0,0,0.06)',
  actionIconAltBg: '#F1F3F5',
  actionTitle: colors.text.DEFAULT,
  actionSub: colors.text.muted,
  emptyIconBg: 'rgba(14,165,168,0.1)',
  emptyTitle: colors.text.DEFAULT,
  emptyDesc: colors.text.muted,
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#0A0E14',
  },
  scrollContent: {
    gap: 0,
  },
  loadingContainer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing['3xl'],
    gap: spacing.lg,
  },
  loadingRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },

  // Nav bar
  navBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  navLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  logo: {
    color: '#5CF6FF',
    fontSize: 22,
    fontFamily: typography.fontFamily.heading,
    fontWeight: typography.fontWeight.extrabold,
    letterSpacing: 3,
  },
  navRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  navIconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notifDot: {
    position: 'absolute',
    top: 4,
    right: 4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#C7354F',
    alignItems: 'center',
    justifyContent: 'center',
  },
  notifCount: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '800',
  },

  // Greeting
  greetingSection: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  greeting: {
    color: '#FFFFFF',
    fontSize: typography.fontSize['2xl'],
    fontFamily: typography.fontFamily.heading,
    fontWeight: typography.fontWeight.bold,
  },
  greetingSub: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily.body,
    marginTop: 4,
  },

  // Onboarding
  onboardBanner: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.25)',
    padding: spacing.md,
    overflow: 'hidden',
  },
  bannerPressed: {
    opacity: 0.85,
  },
  onboardGradient: {
    ...StyleSheet.absoluteFillObject,
  },
  onboardTextWrap: {
    flex: 1,
  },
  onboardTitle: {
    color: '#FFFFFF',
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily.heading,
    fontWeight: typography.fontWeight.bold,
  },
  onboardSub: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily.body,
  },

  // Quick Actions
  quickActions: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
    marginBottom: spacing.xl,
  },
  actionCard: {
    flex: 1,
    borderRadius: borderRadius.lg,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: spacing.md,
    alignItems: 'center',
    gap: spacing.xs,
  },
  actionCardPrimary: {
    backgroundColor: '#5CF6FF',
    borderColor: '#5CF6FF',
  },
  actionPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.97 }],
  },
  actionIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  actionIconAlt: {
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  actionTitle: {
    color: '#000',
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily.heading,
    fontWeight: typography.fontWeight.bold,
  },
  actionTitleAlt: {
    color: '#FFFFFF',
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily.heading,
    fontWeight: typography.fontWeight.bold,
  },
  actionSub: {
    color: 'rgba(0,0,0,0.4)',
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily.body,
  },
  actionSubPrimary: {
    color: 'rgba(0,0,0,0.55)',
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily.body,
  },

  // Empty state
  emptyHero: {
    alignItems: 'center',
    paddingHorizontal: spacing['2xl'],
    paddingVertical: spacing['3xl'],
    gap: spacing.md,
  },
  emptyIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 24,
    backgroundColor: 'rgba(92,246,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  emptyTitle: {
    color: '#FFFFFF',
    fontSize: typography.fontSize['2xl'],
    fontFamily: typography.fontFamily.heading,
    fontWeight: typography.fontWeight.bold,
    textAlign: 'center',
  },
  emptyDesc: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: typography.fontSize.base,
    fontFamily: typography.fontFamily.body,
    textAlign: 'center',
    lineHeight: 22,
  },
  emptyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#5CF6FF',
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    marginTop: spacing.md,
  },
  emptyBtnText: {
    color: '#000',
    fontSize: typography.fontSize.base,
    fontFamily: typography.fontFamily.body,
    fontWeight: typography.fontWeight.bold,
  },
});
