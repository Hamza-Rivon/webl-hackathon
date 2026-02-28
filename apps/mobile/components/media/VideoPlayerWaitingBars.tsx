import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { styles } from './VideoPlayer.styles';

export function VideoPlayerWaitingBars() {
  const pulse = useSharedValue(0);

  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(1, { duration: 900, easing: Easing.inOut(Easing.cubic) }),
      -1,
      true
    );
  }, [pulse]);

  const barA = useAnimatedStyle(() => ({
    opacity: 0.2 + pulse.value * 0.7,
    transform: [{ scaleY: 0.65 + pulse.value * 0.35 }],
  }));
  const barB = useAnimatedStyle(() => ({
    opacity: 0.25 + (1 - pulse.value) * 0.65,
    transform: [{ scaleY: 0.75 + (1 - pulse.value) * 0.25 }],
  }));
  const barC = useAnimatedStyle(() => ({
    opacity: 0.3 + pulse.value * 0.55,
    transform: [{ scaleY: 0.7 + pulse.value * 0.3 }],
  }));

  return (
    <View style={styles.waitingBars}>
      <Animated.View style={[styles.waitingBar, barA]} />
      <Animated.View style={[styles.waitingBar, barB]} />
      <Animated.View style={[styles.waitingBar, barC]} />
    </View>
  );
}
