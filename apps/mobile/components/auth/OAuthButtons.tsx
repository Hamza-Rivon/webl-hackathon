import { useCallback, useEffect } from 'react';
import { Alert, Platform, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSignInWithApple, useSSO } from '@clerk/clerk-expo';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { Ionicons } from '@/components/ui/SymbolIcon';
import { Button } from '@/components/ui';
import { borderRadius, colors, spacing, typography } from '@/lib/theme';
import { triggerHaptic } from '@/lib/haptics';

WebBrowser.maybeCompleteAuthSession();

export function useWarmUpBrowser() {
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    void WebBrowser.warmUpAsync();
    return () => {
      void WebBrowser.coolDownAsync();
    };
  }, []);
}

export interface OAuthButtonsProps {
  onSignInComplete?: () => void;
  showDivider?: boolean;
  disabled?: boolean;
}

function GoogleIcon() {
  return (
    <View style={styles.googleWrap}>
      <Text style={styles.googleLabel}>G</Text>
    </View>
  );
}

function AppleButton({ onSignInComplete, disabled }: { onSignInComplete?: () => void; disabled?: boolean }) {
  const { startAppleAuthenticationFlow } = useSignInWithApple();
  const router = useRouter();

  if (Platform.OS !== 'ios') return null;

  return (
    <Button
      variant="outline"
      size="lg"
      disabled={disabled}
      onPress={async () => {
        try {
          triggerHaptic('light');
          const { createdSessionId, setActive } = await startAppleAuthenticationFlow();
          if (createdSessionId && setActive) {
            await setActive({ session: createdSessionId });
            triggerHaptic('success');
            onSignInComplete ? onSignInComplete() : router.replace('/(main)/(tabs)/home');
          }
        } catch (err: any) {
          if (err?.code === 'ERR_REQUEST_CANCELED') return;
          triggerHaptic('error');
          Alert.alert('Apple Sign-In Failed', err?.message || 'Try again in a moment.');
        }
      }}
      leftIcon={<Ionicons name="logo-apple" size={18} color={colors.text.DEFAULT} />}
      style={styles.oauthButton}
    >
      Continue with Apple
    </Button>
  );
}

function GoogleButton({ onSignInComplete, disabled }: { onSignInComplete?: () => void; disabled?: boolean }) {
  const { startSSOFlow } = useSSO();
  const router = useRouter();

  return (
    <Button
      variant="outline"
      size="lg"
      disabled={disabled}
      onPress={async () => {
        try {
          triggerHaptic('light');
          const { createdSessionId, setActive } = await startSSOFlow({
            strategy: 'oauth_google',
            redirectUrl: AuthSession.makeRedirectUri(),
          });
          if (createdSessionId && setActive) {
            await setActive({ session: createdSessionId });
            triggerHaptic('success');
            onSignInComplete ? onSignInComplete() : router.replace('/(main)/(tabs)/home');
          }
        } catch (err: any) {
          if (err?.code === 'ERR_REQUEST_CANCELED') return;
          triggerHaptic('error');
          Alert.alert('Google Sign-In Failed', err?.message || 'Try again in a moment.');
        }
      }}
      leftIcon={<GoogleIcon />}
      style={styles.oauthButton}
    >
      Continue with Google
    </Button>
  );
}

export function OAuthButtons({ onSignInComplete, showDivider = true, disabled = false }: OAuthButtonsProps) {
  useWarmUpBrowser();

  return (
    <View style={styles.container}>
      <AppleButton onSignInComplete={onSignInComplete} disabled={disabled} />
      <GoogleButton onSignInComplete={onSignInComplete} disabled={disabled} />

      {showDivider ? (
        <View style={styles.divider}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or use email</Text>
          <View style={styles.dividerLine} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  oauthButton: {
    marginBottom: spacing.md,
  },
  googleWrap: {
    width: 18,
    height: 18,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F4F7FF',
  },
  googleLabel: {
    color: '#2F62EA',
    fontFamily: typography.fontFamily.body,
    fontSize: 11,
    fontWeight: typography.fontWeight.bold,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: spacing.md,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  dividerText: {
    marginHorizontal: spacing.md,
    color: colors.text.light,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.xs,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
});

export default OAuthButtons;
