/**
 * B-Roll Library Screen
 *
 * Apple-style grid view showing all uploaded B-roll chunks for an episode.
 * Displays thumbnails, AI tags, quality scores, and match status.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  Dimensions,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Animated, { FadeIn, FadeInDown, FadeOut } from 'react-native-reanimated';
import { Ionicons } from '@/components/ui/SymbolIcon';
import { useBrollChunks, type BrollChunk } from '@/hooks/useBrollChunks';
import {
  EmptyState,
  Screen,
  SegmentedControl,
  Skeleton,
} from '@/components/ui';
import { useTheme } from '@/contexts/ThemeContext';
import { borderRadius, spacing, typography } from '@/lib/theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const GRID_GAP = 4;
const NUM_COLUMNS = 3;
const TILE_SIZE = (SCREEN_WIDTH - spacing.lg * 2 - GRID_GAP * (NUM_COLUMNS - 1)) / NUM_COLUMNS;

type FilterMode = 'all' | 'used' | 'unused';

const FILTER_MODES: FilterMode[] = ['all', 'used', 'unused'];
const FILTER_OPTIONS = [
  { label: 'All' },
  { label: 'Used' },
  { label: 'Unused' },
];

function QualityBadge({ score, isDark }: { score: number; isDark: boolean }) {
  const level = score >= 0.8 ? 'high' : score >= 0.5 ? 'mid' : 'low';
  const config = {
    high: { bg: 'rgba(74,222,128,0.85)', text: '#052E16', label: 'HD' },
    mid: { bg: 'rgba(251,191,36,0.85)', text: '#451A03', label: 'OK' },
    low: { bg: 'rgba(251,113,133,0.7)', text: '#4C0519', label: 'LQ' },
  }[level];

  return (
    <View style={[styles.qualityBadge, { backgroundColor: config.bg }]}>
      <Text style={[styles.qualityText, { color: config.text }]}>{config.label}</Text>
    </View>
  );
}

function MatchBadge({ isDark }: { isDark: boolean }) {
  return (
    <View style={[styles.matchBadge, { backgroundColor: 'rgba(92,246,255,0.85)' }]}>
      <Ionicons name="checkmark-circle" size={10} color="#052E16" />
    </View>
  );
}

function ChunkTile({
  chunk,
  onPress,
  isDark,
}: {
  chunk: BrollChunk;
  onPress: (chunk: BrollChunk) => void;
  isDark: boolean;
}) {
  const durationSec = Math.round((chunk.durationMs || 0) / 1000);

  return (
    <Pressable
      onPress={() => onPress(chunk)}
      style={({ pressed }) => [
        styles.tile,
        pressed && { opacity: 0.8, transform: [{ scale: 0.97 }] },
      ]}
    >
      {chunk.thumbnailUrl ? (
        <Image
          source={{ uri: chunk.thumbnailUrl }}
          style={styles.tileImage}
          resizeMode="cover"
        />
      ) : (
        <View style={[styles.tileImage, styles.tilePlaceholder, { backgroundColor: isDark ? '#1C2230' : '#E2E8F0' }]}>
          <Ionicons name="film-outline" size={24} color={isDark ? 'rgba(255,255,255,0.2)' : '#94A3B8'} />
        </View>
      )}

      {/* Duration overlay */}
      <View style={styles.durationOverlay}>
        <Text style={styles.durationText}>{durationSec}s</Text>
      </View>

      {/* Quality badge */}
      {chunk.qualityScore != null && (
        <QualityBadge score={chunk.qualityScore} isDark={isDark} />
      )}

      {/* Used in final cut badge */}
      {chunk.isUsedInFinalCut && <MatchBadge isDark={isDark} />}
    </Pressable>
  );
}

function ChunkDetail({
  chunk,
  onClose,
  isDark,
}: {
  chunk: BrollChunk;
  onClose: () => void;
  isDark: boolean;
}) {
  const durationSec = ((chunk.durationMs || 0) / 1000).toFixed(1);

  return (
    <Animated.View
      entering={FadeIn.duration(200)}
      exiting={FadeOut.duration(150)}
      style={[
        styles.detailOverlay,
        { backgroundColor: isDark ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.95)' },
      ]}
    >
      <Pressable style={styles.detailCloseArea} onPress={onClose} />
      <Animated.View
        entering={FadeInDown.duration(300).springify()}
        style={[
          styles.detailCard,
          {
            backgroundColor: isDark ? '#1C2230' : '#FFFFFF',
            borderColor: isDark ? 'rgba(255,255,255,0.1)' : '#E2E8F0',
          },
        ]}
      >
        {/* Preview */}
        {chunk.thumbnailUrl ? (
          <Image
            source={{ uri: chunk.thumbnailUrl }}
            style={styles.detailImage}
            resizeMode="cover"
          />
        ) : (
          <View style={[styles.detailImage, { backgroundColor: isDark ? '#141820' : '#F1F5F9' }]} />
        )}

        {/* Info */}
        <View style={styles.detailInfo}>
          {/* AI Summary */}
          {chunk.aiSummary && (
            <Text style={[styles.detailSummary, { color: isDark ? '#F1F5F9' : '#1E293B' }]}>
              {chunk.aiSummary}
            </Text>
          )}

          {/* Tags */}
          {chunk.aiTags && chunk.aiTags.length > 0 && (
            <View style={styles.tagWrap}>
              {chunk.aiTags.slice(0, 8).map((tag, i) => (
                <View
                  key={i}
                  style={[
                    styles.tag,
                    {
                      backgroundColor: isDark ? 'rgba(92,246,255,0.1)' : 'rgba(14,165,168,0.08)',
                      borderColor: isDark ? 'rgba(92,246,255,0.2)' : 'rgba(14,165,168,0.15)',
                    },
                  ]}
                >
                  <Text style={[styles.tagText, { color: isDark ? '#5CF6FF' : '#0EA5A8' }]}>
                    {tag}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {/* Metrics row */}
          <View style={styles.metricsRow}>
            <MetricPill
              icon="time-outline"
              value={`${durationSec}s`}
              isDark={isDark}
            />
            {chunk.qualityScore != null && (
              <MetricPill
                icon="star-outline"
                value={`${Math.round(chunk.qualityScore * 100)}%`}
                isDark={isDark}
              />
            )}
            {chunk.motionScore != null && (
              <MetricPill
                icon="speedometer-outline"
                value={`${Math.round(chunk.motionScore * 100)}%`}
                isDark={isDark}
              />
            )}
            {chunk.matchScore != null && (
              <MetricPill
                icon="git-compare-outline"
                value={`${Math.round(chunk.matchScore * 100)}%`}
                isDark={isDark}
              />
            )}
          </View>

          {/* Status */}
          <View style={styles.statusRow}>
            {chunk.isUsedInFinalCut && (
              <View style={[styles.statusPill, { backgroundColor: 'rgba(74,222,128,0.15)' }]}>
                <Ionicons name="checkmark-circle" size={12} color={isDark ? '#4ADE80' : '#16A34A'} />
                <Text style={[styles.statusText, { color: isDark ? '#4ADE80' : '#16A34A' }]}>
                  Used in final cut
                </Text>
              </View>
            )}
            {chunk.moderationStatus === 'safe' && (
              <View style={[styles.statusPill, { backgroundColor: 'rgba(96,165,250,0.12)' }]}>
                <Ionicons name="shield-checkmark-outline" size={12} color={isDark ? '#60A5FA' : '#2563EB'} />
                <Text style={[styles.statusText, { color: isDark ? '#60A5FA' : '#2563EB' }]}>
                  Safe
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* Close button */}
        <Pressable style={styles.detailCloseBtn} onPress={onClose}>
          <Ionicons name="close-circle" size={28} color={isDark ? 'rgba(255,255,255,0.5)' : '#94A3B8'} />
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}

function MetricPill({
  icon,
  value,
  isDark,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  value: string;
  isDark: boolean;
}) {
  return (
    <View
      style={[
        styles.metricPill,
        {
          backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : '#F1F5F9',
          borderColor: isDark ? 'rgba(255,255,255,0.08)' : '#E2E8F0',
        },
      ]}
    >
      <Ionicons name={icon} size={12} color={isDark ? 'rgba(255,255,255,0.5)' : '#64748B'} />
      <Text style={[styles.metricText, { color: isDark ? 'rgba(255,255,255,0.7)' : '#475569' }]}>
        {value}
      </Text>
    </View>
  );
}

export default function BrollLibraryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const [filter, setFilter] = useState<FilterMode>('all');
  const [selectedChunk, setSelectedChunk] = useState<BrollChunk | null>(null);

  const { data, isLoading } = useBrollChunks(id);

  const filteredChunks = useMemo(() => {
    if (!data?.chunks) return [];
    switch (filter) {
      case 'used':
        return data.chunks.filter((c) => c.isUsedInFinalCut);
      case 'unused':
        return data.chunks.filter((c) => !c.isUsedInFinalCut);
      default:
        return data.chunks;
    }
  }, [data?.chunks, filter]);

  const handleChunkPress = useCallback((chunk: BrollChunk) => {
    setSelectedChunk(chunk);
  }, []);

  const renderTile = useCallback(
    ({ item }: { item: BrollChunk }) => (
      <ChunkTile chunk={item} onPress={handleChunkPress} isDark={isDark} />
    ),
    [isDark, handleChunkPress]
  );

  const header = (
    <View style={styles.headerSection}>
      {/* Title */}
      <View style={styles.titleRow}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={isDark ? '#5CF6FF' : '#0EA5A8'} />
        </Pressable>
        <Text style={[styles.title, { color: colors.text.DEFAULT }]}>B-Roll Library</Text>
      </View>

      {/* Stats */}
      {data && (
        <Animated.View entering={FadeInDown.duration(250)} style={styles.statsRow}>
          <View style={[styles.statCard, { backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : '#F8FAFC', borderColor: isDark ? 'rgba(255,255,255,0.06)' : '#E2E8F0' }]}>
            <Text style={[styles.statNumber, { color: isDark ? '#5CF6FF' : '#0EA5A8' }]}>
              {data.total}
            </Text>
            <Text style={[styles.statLabel, { color: isDark ? 'rgba(255,255,255,0.5)' : '#64748B' }]}>
              Total Chunks
            </Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : '#F8FAFC', borderColor: isDark ? 'rgba(255,255,255,0.06)' : '#E2E8F0' }]}>
            <Text style={[styles.statNumber, { color: isDark ? '#4ADE80' : '#16A34A' }]}>
              {data.usedInFinalCut}
            </Text>
            <Text style={[styles.statLabel, { color: isDark ? 'rgba(255,255,255,0.5)' : '#64748B' }]}>
              In Final Cut
            </Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : '#F8FAFC', borderColor: isDark ? 'rgba(255,255,255,0.06)' : '#E2E8F0' }]}>
            <Text style={[styles.statNumber, { color: isDark ? '#FBBF24' : '#D97706' }]}>
              {data.total - data.usedInFinalCut}
            </Text>
            <Text style={[styles.statLabel, { color: isDark ? 'rgba(255,255,255,0.5)' : '#64748B' }]}>
              Available
            </Text>
          </View>
        </Animated.View>
      )}

      {/* Filter */}
      <SegmentedControl
        options={FILTER_OPTIONS}
        selectedIndex={FILTER_MODES.indexOf(filter)}
        onSelect={(index) => setFilter(FILTER_MODES[index])}
      />
    </View>
  );

  if (isLoading) {
    return (
      <Screen topInset={false}>
        <View style={styles.loadingGrid}>
          {Array.from({ length: 9 }).map((_, i) => (
            <Skeleton key={i} width={TILE_SIZE} height={TILE_SIZE} radius="sm" />
          ))}
        </View>
      </Screen>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <Screen scroll={false} topInset={false}>
        <FlashList
          data={filteredChunks}
          renderItem={renderTile}
          keyExtractor={(item) => item.id}
          numColumns={NUM_COLUMNS}
          estimatedItemSize={TILE_SIZE}
          ListHeaderComponent={header}
          ListEmptyComponent={
            <EmptyState
              title="No B-Roll chunks"
              description={
                filter !== 'all'
                  ? 'No chunks match this filter.'
                  : 'Upload video clips to see analyzed B-roll here.'
              }
              icon={<Ionicons name="images-outline" size={44} color={isDark ? '#5CF6FF' : '#0EA5A8'} />}
            />
          }
          contentContainerStyle={styles.gridContent}
          showsVerticalScrollIndicator={false}
        />
      </Screen>

      {/* Detail overlay */}
      {selectedChunk && (
        <ChunkDetail
          chunk={selectedChunk}
          onClose={() => setSelectedChunk(null)}
          isDark={isDark}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  headerSection: {
    gap: spacing.md,
    paddingBottom: spacing.md,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.sm,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontFamily: typography.fontFamily.heading,
    fontSize: typography.fontSize.xl,
    fontWeight: typography.fontWeight.bold as any,
  },
  statsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  statCard: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1,
  },
  statNumber: {
    fontFamily: typography.fontFamily.heading,
    fontSize: typography.fontSize.xl,
    fontWeight: typography.fontWeight.bold as any,
  },
  statLabel: {
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.xs,
    marginTop: 2,
  },
  gridContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing['4xl'],
  },
  loadingGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID_GAP,
    padding: spacing.lg,
  },
  // Tile styles
  tile: {
    width: TILE_SIZE,
    height: TILE_SIZE,
    marginBottom: GRID_GAP,
    marginRight: GRID_GAP,
    borderRadius: borderRadius.xs,
    overflow: 'hidden',
  },
  tileImage: {
    width: '100%',
    height: '100%',
  },
  tilePlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  durationOverlay: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  durationText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 9,
    color: '#FFFFFF',
    fontWeight: typography.fontWeight.semibold as any,
  },
  qualityBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  qualityText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: 8,
    fontWeight: typography.fontWeight.bold as any,
  },
  matchBadge: {
    position: 'absolute',
    top: 4,
    left: 4,
    borderRadius: 8,
    width: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Detail overlay
  detailOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 100,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  detailCloseArea: {
    ...StyleSheet.absoluteFillObject,
  },
  detailCard: {
    width: '100%',
    maxWidth: 380,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  detailImage: {
    width: '100%',
    height: 220,
  },
  detailInfo: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  detailSummary: {
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.base,
    lineHeight: 22,
  },
  tagWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  tag: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: borderRadius.xs,
    borderWidth: 1,
  },
  tagText: {
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.medium as any,
  },
  metricsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  metricPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: borderRadius.xs,
    borderWidth: 1,
  },
  metricText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: typography.fontSize.xs,
  },
  statusRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: borderRadius.full,
  },
  statusText: {
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.medium as any,
  },
  detailCloseBtn: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    zIndex: 10,
  },
});
