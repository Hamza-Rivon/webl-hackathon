import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography } from '@/lib/theme';

interface AppLoadingScreenProps {
  message?: string;
}

export function AppLoadingScreen({ message = 'Preparing your workspace' }: AppLoadingScreenProps) {
  return (
    <View style={styles.container}>
      <View style={styles.logoWrap}>
        <Image source={require('../../assets/AppIcons/playstore.png')} style={styles.logo} resizeMode="contain" />
      </View>
      <ActivityIndicator size="small" color={colors.primary.DEFAULT} />
      <Text style={styles.message}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#050507',
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  logoWrap: {
    width: 92,
    height: 92,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  logo: {
    width: 64,
    height: 64,
  },
  message: {
    color: colors.text.light,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
    letterSpacing: 0.2,
  },
});
