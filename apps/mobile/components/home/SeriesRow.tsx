import React from 'react';
import { Dimensions, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import Animated, { FadeInRight, FadeInDown } from 'react-native-reanimated';
import { Ionicons } from '@/components/ui/SymbolIcon';
import { getMuxThumbnailUrl } from '@/components/media/muxPlayback';
import { colors, typography, spacing, borderRadius, shadows } from '@/lib/theme';
import { triggerHaptic } from '@/lib/haptics';
import { statusColors } from '@/lib/theme';
import type { EpisodeWithSeries } from '@/hooks/useEpisodes';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_WIDTH = SCREEN_WIDTH * 0.38;
const CARD_HEIGHT = CARD_WIDTH * 1.5;

type EnrichedEpisode = EpisodeWithSeries & {
  muxFinalPlaybackId?: string | null;
  thumbnailUrl?: string | null;
};

interface SeriesRowProps {
  title: string;
  subtitle?: string;
  episodes: EnrichedEpisode[];
  onPressEpisode: (id: string) => void;
  onPressSeeAll?: () => void;
  variant?: 'default' | 'wide' | 'compact';
  themeMode?: 'dark' | 'light';
}

function EpisodeThumb({
  episode,
  index,
  onPress,
  variant,
  themeMode = 'dark',
}: {
  episode: EnrichedEpisode;
  index: number;
  onPress: () => void;
  variant: string;
  themeMode?: 'dark' | 'light';
}) {
  const poster =
    episode.thumbnailUrl ||
    (episode.muxFinalPlaybackId
      ? getMuxThumbnailUrl(episode.muxFinalPlaybackId, { width: 480, fit: 'smartcrop' })
      : null);

  const isWide = variant === 'wide';
  const isDark = themeMode === 'dark';
  const palette = isDark
    ? {
        cardBg: '#111820',
        placeholderBg: '#0F1824',
        draftTitle: 'rgba(255,255,255,0.5)',
        overlayBg: 'rgba(0,0,0,0.15)',
      }
    : {
        cardBg: colors.surface,
        placeholderBg: colors.panelAlt,
        draftTitle: colors.text.muted,
        overlayBg: 'rgba(16,35,61,0.08)',
      };
  const cardW = isWide ? SCREEN_WIDTH * 0.72 : CARD_WIDTH;
  const cardH = isWide ? cardW * 0.56 : CARD_HEIGHT;
  const statusColor =
    statusColors[episode.status as keyof typeof statusColors] || colors.text.muted;

  return (
    <Animated.View entering={FadeInRight.delay(index * 60).duration(300)}>
      <Pressable
        onPress={() => {
          triggerHaptic('light');
          onPress();
        }}
        style={({ pressed }) => [
          styles.card,
          { width: cardW, height: cardH },
          { backgroundColor: palette.cardBg },
          pressed && styles.cardPressed,
        ]}
      >
        {poster ? (
          <Image source={{ uri: poster }} style={styles.cardImage} contentFit="cover" />
        ) : (
          <View style={[styles.cardPlaceholder, { backgroundColor: palette.placeholderBg }]}>
            <View style={[styles.draftIconCircle, { borderColor: statusColor + '40' }]}>
              <Ionicons
                name={
                  episode.status === 'draft'
                    ? 'document-text-outline'
                    : episode.status.includes('voiceover')
                      ? 'mic-outline'
                      : episode.status.includes('clip') || episode.status.includes('chunk')
                        ? 'videocam-outline'
                        : episode.status.includes('match')
                          ? 'git-merge-outline'
                          : episode.status === 'rendering'
                            ? 'construct-outline'
                            : 'film-outline'
                }
                size={24}
                color={statusColor}
              />
            </View>
            <Text style={[styles.draftTitle, { color: palette.draftTitle }]} numberOfLines={2}>
              {episode.title}
            </Text>
          </View>
        )}

        <View style={[styles.cardOverlay, { backgroundColor: palette.overlayBg }]}>
          <View style={styles.cardTopRow}>
            <View style={[styles.statusPill, { backgroundColor: statusColor + '30' }]}>
              <View style={[styles.statusIndicator, { backgroundColor: statusColor }]} />
              <Text style={[styles.statusLabel, { color: statusColor }]} numberOfLines={1}>
                {episode.status === 'ready'
                  ? 'Ready'
                  : episode.status === 'published'
                    ? 'Published'
                    : episode.status.replaceAll('_', ' ')}
              </Text>
            </View>
          </View>

          {poster ? (
            <View style={styles.cardBottom}>
              <Text style={styles.cardTitle} numberOfLines={isWide ? 2 : 1}>
                {episode.title}
              </Text>
              {episode.series?.name ? (
                <Text style={styles.cardSeries} numberOfLines={1}>
                  {episode.series.name}
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>

        {(episode.status === 'ready' || episode.status === 'published') ? (
          <View style={styles.playIcon}>
            <Ionicons name="play" size={14} color="#fff" />
          </View>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}

export function SeriesRow({
  title,
  subtitle,
  episodes,
  onPressEpisode,
  onPressSeeAll,
  variant = 'default',
  themeMode = 'dark',
}: SeriesRowProps) {
  if (episodes.length === 0) return null;
  const isDark = themeMode === 'dark';
  const palette = isDark
    ? {
        title: '#FFFFFF',
        subtitle: 'rgba(255,255,255,0.5)',
      }
    : {
        title: colors.text.DEFAULT,
        subtitle: colors.text.muted,
      };

  return (
    <Animated.View entering={FadeInDown.duration(350)} style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={[styles.title, { color: palette.title }]}>{title}</Text>
          {subtitle ? <Text style={[styles.subtitle, { color: palette.subtitle }]}>{subtitle}</Text> : null}
        </View>
        {onPressSeeAll ? (
          <Pressable
            onPress={() => {
              triggerHaptic('light');
              onPressSeeAll();
            }}
            style={styles.seeAllBtn}
          >
            <Text style={styles.seeAllText}>See All</Text>
            <Ionicons name="chevron-forward" size={14} color={colors.primary.DEFAULT} />
          </Pressable>
        ) : null}
      </View>

      <FlatList
        data={episodes}
        horizontal
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item, index }) => (
          <EpisodeThumb
            episode={item}
            index={index}
            onPress={() => onPressEpisode(item.id)}
            variant={variant}
            themeMode={themeMode}
          />
        )}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.xl,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  headerLeft: {
    flex: 1,
  },
  title: {
    color: '#FFFFFF',
    fontSize: typography.fontSize.lg,
    fontFamily: typography.fontFamily.heading,
    fontWeight: typography.fontWeight.bold,
  },
  subtitle: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily.body,
    marginTop: 2,
  },
  seeAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  seeAllText: {
    color: colors.primary.DEFAULT,
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily.body,
    fontWeight: typography.fontWeight.semibold,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  card: {
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    backgroundColor: '#111820',
    ...shadows.lg,
  },
  cardPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.97 }],
  },
  cardImage: {
    ...StyleSheet.absoluteFillObject,
  },
  cardPlaceholder: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0F1824',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  draftIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  draftTitle: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily.body,
    fontWeight: typography.fontWeight.semibold,
    textAlign: 'center',
  },
  cardGradient: {
    ...StyleSheet.absoluteFillObject,
    top: '40%',
    backgroundColor: undefined,
    // Simulated gradient with a semi-transparent overlay
    // Real LinearGradient requires expo-linear-gradient
  },
  cardOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
    padding: spacing.sm,
    backgroundColor: 'rgba(0,0,0,0.15)',
  },
  cardTopRow: {
    flexDirection: 'row',
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: borderRadius.full,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  statusIndicator: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  statusLabel: {
    fontSize: 10,
    fontFamily: typography.fontFamily.body,
    fontWeight: typography.fontWeight.bold,
    textTransform: 'capitalize',
  },
  cardBottom: {
    gap: 2,
  },
  cardTitle: {
    color: '#FFFFFF',
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily.heading,
    fontWeight: typography.fontWeight.bold,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  cardSeries: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily.body,
  },
  playIcon: {
    position: 'absolute',
    right: spacing.sm,
    bottom: spacing.sm + 28,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default SeriesRow;
