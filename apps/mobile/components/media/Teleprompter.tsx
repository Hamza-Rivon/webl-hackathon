/**
 * Teleprompter Component
 *
 * A professional scrolling script display for recording voiceovers.
 * Clean, readable design with intuitive controls.
 * Requirements: 9.1, 9.2, 9.3
 */

import React, { useRef, useEffect, useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  Dimensions,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedRef,
  useDerivedValue,
  withTiming,
  scrollTo,
  cancelAnimation,
  Easing,
  runOnJS,
  FadeInDown,
} from 'react-native-reanimated';

import { colors, typography, spacing, borderRadius, shadows } from '../../lib/theme';
import { triggerHaptic } from '../../lib/haptics';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

export interface TeleprompterBeat {
  index: number;
  type: string;
  text: string;
  duration: number;
}

export interface TeleprompterProps {
  beats: TeleprompterBeat[];
  currentBeatIndex: number;
  isPlaying: boolean;
  speed: number;
  textSize: number;
  onSpeedChange: (speed: number) => void;
  onTextSizeChange: (size: number) => void;
  onBeatChange?: (beatIndex: number) => void;
  onComplete?: () => void;
  showControls?: boolean;
  mirrored?: boolean;
  allowManualScroll?: boolean; // Allow manual scrolling even when isPlaying is true
}

// Speed presets
const SPEED_PRESETS = [
  { label: '0.5x', value: 0.5 },
  { label: '0.75x', value: 0.75 },
  { label: '1x', value: 1.0 },
  { label: '1.25x', value: 1.25 },
  { label: '1.5x', value: 1.5 },
  { label: '2x', value: 2.0 },
];

// Text size presets
const TEXT_SIZE_PRESETS = [
  { label: 'S', value: 0.85 },
  { label: 'M', value: 1.0 },
  { label: 'L', value: 1.2 },
  { label: 'XL', value: 1.4 },
];

export function Teleprompter({
  beats,
  currentBeatIndex,
  isPlaying,
  speed,
  textSize,
  onSpeedChange,
  onTextSizeChange,
  onBeatChange,
  onComplete,
  showControls = true,
  mirrored = false,
  allowManualScroll = false,
}: TeleprompterProps) {
  // Reanimated's ScrollView wrapper type is not assignable to scrollTo's generic constraint.
  // Keep ref broad here to preserve runtime behavior while satisfying TS.
  const scrollViewRef = useAnimatedRef<any>();
  const scrollY = useSharedValue(0);
  const [contentHeight, setContentHeight] = useState(0);
  const [containerHeight, setContainerHeight] = useState(SCREEN_HEIGHT * 0.5);
  const beatPositions = useRef<number[]>([]);

  // Calculate total duration
  const totalDuration = beats.reduce((sum, beat) => sum + (beat.duration || 5), 0);
  const baseScrollDuration = totalDuration * 1000;

  // Handle scroll animation
  // Only auto-scroll if isPlaying is true AND manual scroll is not allowed
  useEffect(() => {
    if (isPlaying && !allowManualScroll && contentHeight > containerHeight) {
      const scrollDistance = contentHeight - containerHeight + 100;
      const duration = baseScrollDuration / speed;

      scrollY.value = withTiming(
        scrollDistance,
        { duration, easing: Easing.linear },
        (finished) => {
          if (finished && onComplete) {
            runOnJS(onComplete)();
          }
        }
      );
    } else if (!isPlaying || allowManualScroll) {
      cancelAnimation(scrollY);
    }
  }, [isPlaying, allowManualScroll, contentHeight, containerHeight, speed, baseScrollDuration, onComplete]);

  // Keep scroll on the UI thread for smoother movement and no interval jitter.
  useDerivedValue(() => {
    scrollTo(scrollViewRef, 0, scrollY.value, false);
  });

  // Reset scroll when beats change
  useEffect(() => {
    cancelAnimation(scrollY);
    scrollY.value = 0;
    beatPositions.current = [];
  }, [beats]);

  const handleBeatLayout = useCallback((index: number, y: number) => {
    beatPositions.current[index] = y;
  }, []);

  const syncBeatFromOffset = useCallback((offsetY: number) => {
    if (!onBeatChange || beatPositions.current.length === 0) return;
    const currentY = offsetY + containerHeight / 3;
    for (let i = beatPositions.current.length - 1; i >= 0; i--) {
      if (currentY >= beatPositions.current[i]) {
        if (i !== currentBeatIndex) {
          onBeatChange(i);
        }
        break;
      }
    }
  }, [containerHeight, currentBeatIndex, onBeatChange]);

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetY = event.nativeEvent.contentOffset.y;
    scrollY.value = offsetY;
    syncBeatFromOffset(offsetY);
  }, [scrollY, syncBeatFromOffset]);

  // Scroll to specific beat when tapped
  const scrollToBeat = useCallback((index: number) => {
    if ((!isPlaying || allowManualScroll) && beatPositions.current[index] !== undefined) {
      triggerHaptic('selection');
      const targetY = Math.max(0, beatPositions.current[index] - containerHeight / 3);
      scrollY.value = withTiming(targetY, {
        duration: 240,
        easing: Easing.out(Easing.cubic),
      });
      onBeatChange?.(index);
    }
  }, [isPlaying, allowManualScroll, containerHeight, onBeatChange, scrollY]);

  const baseFontSize = 24;
  const calculatedFontSize = baseFontSize * textSize;

  return (
    <View style={styles.container}>
      {/* Script Display Area */}
      <View
        style={styles.scriptContainer}
        onLayout={(e) => setContainerHeight(e.nativeEvent.layout.height)}
      >
        {/* Reading line indicator */}
        <View style={styles.readingLineContainer} pointerEvents="none">
          <View style={styles.readingLine} />
        </View>

        <Animated.ScrollView
          ref={scrollViewRef}
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          bounces={false}
          alwaysBounceVertical={false}
          scrollEnabled={!isPlaying || allowManualScroll}
          scrollEventThrottle={16}
          onScroll={handleScroll}
          onContentSizeChange={(_, height) => setContentHeight(height)}
        >
          {/* Top padding for center alignment */}
          <View style={{ height: containerHeight / 3 }} />

          {beats.map((beat, index) => (
            <BeatCard
              key={index}
              beat={beat}
              isActive={index === currentBeatIndex}
              isPast={index < currentBeatIndex}
              fontSize={calculatedFontSize}
              onLayout={(y) => handleBeatLayout(index, y)}
              onPress={() => scrollToBeat(index)}
            />
          ))}

          {/* Bottom padding */}
          <View style={{ height: containerHeight / 2 }} />
        </Animated.ScrollView>

        {/* Top fade gradient */}
        <View style={styles.topGradient} pointerEvents="none">
          <View style={[styles.gradientOverlay, styles.gradientTop]} />
        </View>

        {/* Bottom fade gradient */}
        <View style={styles.bottomGradient} pointerEvents="none">
          <View style={[styles.gradientOverlay, styles.gradientBottom]} />
        </View>
      </View>

      {/* Controls */}
      {showControls && (
        <Animated.View entering={FadeInDown.duration(300).delay(200)} style={styles.controlsContainer}>
          {/* Speed Control */}
          <View style={styles.controlSection}>
            <Text style={styles.controlLabel}>Speed</Text>
            <View style={styles.presetRow}>
              {SPEED_PRESETS.map((preset) => (
                <Pressable
                  key={preset.value}
                  style={[
                    styles.presetButton,
                    speed === preset.value && styles.presetButtonActive,
                  ]}
                  onPress={() => {
                    triggerHaptic('selection');
                    onSpeedChange(preset.value);
                  }}
                >
                  <Text
                    style={[
                      styles.presetButtonText,
                      speed === preset.value && styles.presetButtonTextActive,
                    ]}
                  >
                    {preset.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          {/* Text Size Control */}
          <View style={styles.controlSection}>
            <Text style={styles.controlLabel}>Text Size</Text>
            <View style={styles.presetRow}>
              {TEXT_SIZE_PRESETS.map((preset) => (
                <Pressable
                  key={preset.value}
                  style={[
                    styles.presetButton,
                    styles.textSizeButton,
                    textSize === preset.value && styles.presetButtonActive,
                  ]}
                  onPress={() => {
                    triggerHaptic('selection');
                    onTextSizeChange(preset.value);
                  }}
                >
                  <Text
                    style={[
                      styles.presetButtonText,
                      textSize === preset.value && styles.presetButtonTextActive,
                    ]}
                  >
                    {preset.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        </Animated.View>
      )}
    </View>
  );
}

/**
 * Individual Beat Card Component
 */
interface BeatCardProps {
  beat: TeleprompterBeat;
  isActive: boolean;
  isPast: boolean;
  fontSize: number;
  onLayout: (y: number) => void;
  onPress: () => void;
}

function BeatCard({ 
  beat, 
  isActive, 
  isPast,
  fontSize,
  onLayout,
  onPress,
}: BeatCardProps) {
  const beatText = beat.text || '';

  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.beatCard,
        isActive && styles.beatCardActive,
        isPast && styles.beatCardPast,
      ]}
      onLayout={(e) => onLayout(e.nativeEvent.layout.y)}
    >
      {/* Beat text */}
      <Text
        style={[
          styles.beatText,
          { fontSize, lineHeight: fontSize * 1.5 },
          isActive && styles.beatTextActive,
          isPast && styles.beatTextPast,
        ]}
      >
        {beatText}
      </Text>
    </Pressable>
  );
}

export default Teleprompter;

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scriptContainer: {
    flex: 1,
    backgroundColor: 'transparent',
    borderRadius: borderRadius.xl,
    overflow: 'hidden',
    position: 'relative',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.md,
  },
  // Reading line indicator
  readingLineContainer: {
    position: 'absolute',
    top: '30%',
    left: 0,
    right: 0,
    zIndex: 20,
    alignItems: 'center',
  },
  readingLine: {
    width: '90%',
    height: 2,
    backgroundColor: 'rgba(255,255,255,0.55)',
    borderRadius: 2,
    opacity: 0.45,
  },
  // Gradient overlays
  topGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 40,
    zIndex: 10,
  },
  bottomGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 40,
    zIndex: 10,
  },
  gradientOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.12)',
  },
  gradientTop: {
    opacity: 0.7,
  },
  gradientBottom: {
    opacity: 0.7,
  },
  // Beat card styles
  beatCard: {
    marginBottom: spacing.md,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.xs,
    borderLeftWidth: 2,
    borderLeftColor: 'transparent',
  },
  beatCardActive: {
    borderLeftColor: 'rgba(255,255,255,0.8)',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  beatCardPast: {
    opacity: 0.62,
  },
  beatText: {
    color: '#FFFFFF',
    fontWeight: '400',
    letterSpacing: 0.15,
  },
  beatTextActive: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  beatTextPast: {
    color: 'rgba(255, 255, 255, 0.4)',
  },
  // Controls styles
  controlsContainer: {
    paddingTop: spacing.lg,
    gap: spacing.md,
  },
  controlSection: {
    gap: spacing.sm,
  },
  controlLabel: {
    fontSize: typography.fontSize.sm,
    fontWeight: '700',
    color: colors.text.DEFAULT,
    letterSpacing: 0.5,
  },
  presetRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  presetButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    minWidth: 50,
    alignItems: 'center',
    ...shadows.sm,
  },
  textSizeButton: {
    minWidth: 44,
  },
  presetButtonActive: {
    backgroundColor: colors.primary.DEFAULT,
    borderColor: colors.primary.dark,
  },
  presetButtonText: {
    fontSize: typography.fontSize.sm,
    fontWeight: '700',
    color: colors.text.DEFAULT,
  },
  presetButtonTextActive: {
    color: '#FFFFFF',
  },
});
