import { colors, typography } from '@/lib/theme';

export const baseHeaderOptions = {
  headerStyle: {
    backgroundColor: colors.background,
  },
  headerTintColor: colors.text.DEFAULT,
  headerShadowVisible: false,
  headerBackTitleVisible: false,
  headerTitleStyle: {
    fontFamily: typography.fontFamily.heading,
    fontWeight: typography.fontWeight.bold,
    color: colors.text.DEFAULT,
  },
  contentStyle: {
    backgroundColor: colors.background,
  },
  animation: 'slide_from_right' as const,
};

export const headerPresets = {
  default: baseHeaderOptions,
  modal: {
    ...baseHeaderOptions,
    presentation: 'modal' as const,
    animation: 'fade_from_bottom' as const,
  },
  transparent: {
    ...baseHeaderOptions,
    headerTransparent: true,
    headerBlurEffect: 'systemUltraThinMaterialDark' as const,
  },
  largeTitle: {
    ...baseHeaderOptions,
    headerLargeTitle: true,
  },
};
