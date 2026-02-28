import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Image } from 'react-native';
import Animated, { FadeInRight } from 'react-native-reanimated';
import { colors, typography, spacing, borderRadius, shadows } from '@/lib/theme';
import { triggerHaptic } from '@/lib/haptics';

export interface StoryItem {
  id: string;
  title: string;
  emoji?: string;
  imageUri?: string;
  ringColor?: string;
  onPress?: () => void;
}

export interface StoriesRailProps {
  title?: string;
  items: StoryItem[];
  contentContainerStyle?: object;
}

export function StoriesRail({ title, items, contentContainerStyle }: StoriesRailProps) {
  if (items.length === 0) return null;

  return (
    <View style={styles.container}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.rail, contentContainerStyle]}
      >
        {items.map((item, index) => (
          <Animated.View key={item.id} entering={FadeInRight.duration(250).delay(index * 35)}>
            <Pressable
              onPress={() => {
                triggerHaptic('light');
                item.onPress?.();
              }}
              style={styles.item}
              accessibilityRole="button"
              accessibilityLabel={item.title}
            >
              <View style={[styles.ring, { borderColor: item.ringColor || colors.primary.DEFAULT }]}>
                <View style={styles.avatar}>
                  {item.imageUri ? (
                    <Image source={{ uri: item.imageUri }} style={styles.avatarImage} />
                  ) : (
                    <Text style={styles.avatarEmoji}>{item.emoji || '✨'}</Text>
                  )}
                </View>
              </View>
              <Text style={styles.label} numberOfLines={1}>
                {item.title}
              </Text>
            </Pressable>
          </Animated.View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: spacing.sm,
  },
  title: {
    fontSize: typography.fontSize.lg,
    fontWeight: '800',
    color: colors.text.DEFAULT,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  rail: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    gap: spacing.lg,
  },
  item: {
    width: 74,
    alignItems: 'center',
  },
  ring: {
    width: 62,
    height: 62,
    borderRadius: 31,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    ...shadows.sm,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.background,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarEmoji: {
    fontSize: 22,
  },
  label: {
    marginTop: spacing.sm,
    fontSize: typography.fontSize.xs,
    fontWeight: '700',
    color: colors.text.DEFAULT,
    textAlign: 'center',
  },
});

export default StoriesRail;
