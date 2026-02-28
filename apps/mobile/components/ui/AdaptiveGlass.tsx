import { useEffect, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Platform, type StyleProp, View, type ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { colors } from '@/lib/theme';

interface AdaptiveGlassProps {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  glassEffectStyle?: 'clear' | 'regular';
  tintColor?: string;
  blurIntensity?: number;
  fallbackColor?: string;
}

export function AdaptiveGlass({
  children,
  style,
  glassEffectStyle = 'regular',
  tintColor = '#FFFFFF80',
  blurIntensity = 40,
  fallbackColor = colors.overlay,
}: AdaptiveGlassProps) {
  const [reduceTransparency, setReduceTransparency] = useState(false);

  useEffect(() => {
    let mounted = true;

    AccessibilityInfo.isReduceTransparencyEnabled()
      .then((enabled) => {
        if (mounted) {
          setReduceTransparency(enabled);
        }
      })
      .catch(() => {
        if (mounted) {
          setReduceTransparency(false);
        }
      });

    const subscription = AccessibilityInfo.addEventListener('reduceTransparencyChanged', (enabled) => {
      setReduceTransparency(enabled);
    });

    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  if (Platform.OS === 'ios' && !reduceTransparency && isLiquidGlassAvailable()) {
    return (
      <GlassView style={style} glassEffectStyle={glassEffectStyle} tintColor={tintColor}>
        {children}
      </GlassView>
    );
  }

  if (Platform.OS === 'ios' && !reduceTransparency) {
    return (
      <BlurView style={style} tint="systemThinMaterialLight" intensity={blurIntensity}>
        {children}
      </BlurView>
    );
  }

  return <View style={[style, { backgroundColor: fallbackColor }]}>{children}</View>;
}

export default AdaptiveGlass;
