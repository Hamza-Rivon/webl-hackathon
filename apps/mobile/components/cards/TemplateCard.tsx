/**
 * Template Card Component
 *
 * Displays a template with thumbnail, name, and platform badge
 * in neobrutalist soft pop design style.
 * Requirements: 8.1
 */

import React from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';
import { useRouter } from 'expo-router';
import Animated, { FadeIn } from 'react-native-reanimated';
import { Card } from '../ui/Card';
import { colors, typography, spacing, borderRadius } from '../../lib/theme';
import { Template } from '../../hooks/useTemplates';

// Platform configuration with colors and labels
const platformConfig: Record<string, { bg: string; label: string; emoji: string }> = {
  tiktok: {
    bg: colors.pastel.pink,
    label: 'TikTok',
    emoji: '🎵',
  },
  reels: {
    bg: colors.pastel.purple,
    label: 'Reels',
    emoji: '📸',
  },
  shorts: {
    bg: colors.pastel.blue,
    label: 'Shorts',
    emoji: '▶️',
  },
  all: {
    bg: colors.pastel.green,
    label: 'All',
    emoji: '🌐',
  },
};

// Pastel colors for template cards based on niche
const nicheColors: Record<string, string> = {
  fitness: colors.pastel.green,
  business: colors.pastel.blue,
  lifestyle: colors.pastel.pink,
  education: colors.pastel.yellow,
  entertainment: colors.pastel.purple,
  tech: colors.pastel.blue,
  food: colors.pastel.orange,
  travel: colors.pastel.green,
  fashion: colors.pastel.pink,
  default: colors.pastel.yellow,
};

// Get color based on niche
function getTemplateColor(niche: string | null): string {
  if (!niche) return nicheColors.default;
  return nicheColors[niche.toLowerCase()] || nicheColors.default;
}

// Format duration in seconds to readable format
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}

export interface TemplateCardProps {
  /** Template data */
  template: Template;
  /** Card size variant */
  size?: 'sm' | 'md' | 'lg';
  /** Animation delay for staggered entrance */
  animationDelay?: number;
  /** Show metrics (view count, retention) */
  showMetrics?: boolean;
}

export function TemplateCard({
  template,
  size = 'md',
  animationDelay = 0,
  showMetrics = false,
}: TemplateCardProps) {
  const router = useRouter();
  const platformInfo = platformConfig[template.platform] || platformConfig.all;
  const backgroundColor = getTemplateColor(template.niche);

  const handlePress = () => {
    router.push(`/(main)/templates/${template.id}`);
  };

  const sizeStyles = {
    sm: styles.cardSm,
    md: styles.cardMd,
    lg: styles.cardLg,
  };

  return (
    <Animated.View entering={FadeIn.duration(300).delay(animationDelay)}>
      <Card
        variant="default"
        pressable
        onPress={handlePress}
        style={[styles.card, sizeStyles[size], { backgroundColor }]}
        padding="md"
      >
        {/* Platform Badge */}
        <View style={[styles.platformBadge, { backgroundColor: platformInfo.bg }]}>
          <Text style={styles.platformEmoji}>{platformInfo.emoji}</Text>
          <Text style={styles.platformLabel}>{platformInfo.label}</Text>
        </View>

        {/* Thumbnail or Emoji */}
        <View style={styles.thumbnailContainer}>
          {template.embeddingId ? (
            <View style={styles.thumbnailPlaceholder}>
              <Text style={styles.thumbnailEmoji}>🎬</Text>
            </View>
          ) : (
            <View style={styles.thumbnailPlaceholder}>
              <Text style={styles.thumbnailEmoji}>📝</Text>
            </View>
          )}
        </View>

        {/* Template Info */}
        <View style={styles.info}>
          <Text style={styles.name} numberOfLines={2}>
            {template.name}
          </Text>

          {template.description && (
            <Text style={styles.description} numberOfLines={2}>
              {template.description}
            </Text>
          )}

          <View style={styles.meta}>
            <View style={styles.durationBadge}>
              <Text style={styles.durationText}>
                ⏱️ {formatDuration(template.durationTarget)}
              </Text>
            </View>

            {template.tone && (
              <View style={styles.toneBadge}>
                <Text style={styles.toneText}>{template.tone}</Text>
              </View>
            )}
          </View>

          {/* Metrics */}
          {showMetrics && (
            <View style={styles.metrics}>
              <Text style={styles.metricText}>
                👁️ {template.viewCount.toLocaleString()}
              </Text>
              {template.retentionRate && (
                <Text style={styles.metricText}>
                  📊 {Math.round(template.retentionRate * 100)}%
                </Text>
              )}
            </View>
          )}
        </View>
      </Card>
    </Animated.View>
  );
}


/**
 * Compact Template Card for grid layouts
 */
export function TemplateCardCompact({
  template,
  animationDelay = 0,
}: {
  template: Template;
  animationDelay?: number;
}) {
  const router = useRouter();
  const platformInfo = platformConfig[template.platform] || platformConfig.all;
  const backgroundColor = getTemplateColor(template.niche);

  const handlePress = () => {
    router.push(`/(main)/templates/${template.id}`);
  };

  return (
    <Animated.View entering={FadeIn.duration(300).delay(animationDelay)}>
      <Card
        variant="default"
        pressable
        onPress={handlePress}
        style={[styles.compactCard, { backgroundColor }]}
        padding="sm"
      >
        {/* Platform Badge - Small */}
        <View style={[styles.compactPlatformBadge, { backgroundColor: platformInfo.bg }]}>
          <Text style={styles.compactPlatformEmoji}>{platformInfo.emoji}</Text>
        </View>

        <Text style={styles.compactEmoji}>🎬</Text>
        <Text style={styles.compactName} numberOfLines={2}>
          {template.name}
        </Text>
        <Text style={styles.compactDuration}>
          {formatDuration(template.durationTarget)}
        </Text>
      </Card>
    </Animated.View>
  );
}

/**
 * Template Card Skeleton for loading states
 */
export function TemplateCardSkeleton({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const sizeStyles = {
    sm: styles.cardSm,
    md: styles.cardMd,
    lg: styles.cardLg,
  };

  return (
    <View style={[styles.card, sizeStyles[size], styles.skeletonCard]}>
      <View style={styles.skeletonBadge} />
      <View style={styles.skeletonThumbnail} />
      <View style={styles.skeletonInfo}>
        <View style={styles.skeletonTitle} />
        <View style={styles.skeletonDescription} />
        <View style={styles.skeletonMeta} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    overflow: 'hidden',
    position: 'relative',
  },
  cardSm: {
    minHeight: 120,
  },
  cardMd: {
    minHeight: 160,
  },
  cardLg: {
    minHeight: 200,
  },
  platformBadge: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
    borderWidth: 2,
    borderColor: colors.border,
    gap: 4,
  },
  platformEmoji: {
    fontSize: 12,
  },
  platformLabel: {
    fontSize: typography.fontSize.xs,
    fontWeight: '700',
    color: colors.text.DEFAULT,
  },
  thumbnailContainer: {
    alignItems: 'center',
    marginBottom: spacing.sm,
    marginTop: spacing.lg,
  },
  thumbnailPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbnailEmoji: {
    fontSize: 24,
  },
  info: {
    flex: 1,
  },
  name: {
    fontSize: typography.fontSize.base,
    fontWeight: '700',
    color: colors.text.DEFAULT,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  description: {
    fontSize: typography.fontSize.xs,
    color: colors.text.muted,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  durationBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
  },
  durationText: {
    fontSize: typography.fontSize.xs,
    fontWeight: '600',
    color: colors.text.DEFAULT,
  },
  toneBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
  },
  toneText: {
    fontSize: typography.fontSize.xs,
    fontWeight: '600',
    color: colors.text.muted,
    textTransform: 'capitalize',
  },
  metrics: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  metricText: {
    fontSize: typography.fontSize.xs,
    color: colors.text.muted,
    fontWeight: '500',
  },
  // Compact card styles
  compactCard: {
    alignItems: 'center',
    minHeight: 130,
    position: 'relative',
  },
  compactPlatformBadge: {
    position: 'absolute',
    top: spacing.xs,
    right: spacing.xs,
    width: 24,
    height: 24,
    borderRadius: borderRadius.full,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compactPlatformEmoji: {
    fontSize: 10,
  },
  compactEmoji: {
    fontSize: 32,
    marginBottom: spacing.xs,
    marginTop: spacing.sm,
  },
  compactName: {
    fontSize: typography.fontSize.sm,
    fontWeight: '700',
    color: colors.text.DEFAULT,
    textAlign: 'center',
  },
  compactDuration: {
    fontSize: typography.fontSize.xs,
    color: colors.text.muted,
    marginTop: spacing.xs,
  },
  // Skeleton styles
  skeletonCard: {
    backgroundColor: colors.background,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
  },
  skeletonBadge: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    width: 60,
    height: 24,
    borderRadius: borderRadius.full,
    backgroundColor: colors.pastel.purple,
  },
  skeletonThumbnail: {
    width: 48,
    height: 48,
    borderRadius: borderRadius.md,
    backgroundColor: colors.pastel.blue,
    alignSelf: 'center',
    marginBottom: spacing.sm,
    marginTop: spacing.lg,
  },
  skeletonInfo: {
    alignItems: 'center',
  },
  skeletonTitle: {
    width: '80%',
    height: 16,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.pastel.pink,
    marginBottom: spacing.sm,
  },
  skeletonDescription: {
    width: '60%',
    height: 12,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.pastel.yellow,
    marginBottom: spacing.sm,
  },
  skeletonMeta: {
    width: '40%',
    height: 20,
    borderRadius: borderRadius.full,
    backgroundColor: colors.pastel.green,
  },
});

export default TemplateCard;
