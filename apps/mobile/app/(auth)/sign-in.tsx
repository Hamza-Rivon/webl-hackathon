import { useSignIn } from '@clerk/clerk-expo';
import { Link, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@/components/ui/SymbolIcon';
import { OAuthButtons } from '@/components/auth';
import { Button, Input, PasswordInput, Screen } from '@/components/ui';
import { borderRadius, colors, spacing, typography } from '@/lib/theme';
import { triggerHaptic } from '@/lib/haptics';

export default function SignInScreen() {
  const { signIn, setActive, isLoaded } = useSignIn();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string; general?: string }>({});
  const [loading, setLoading] = useState(false);

  const validateForm = useCallback(() => {
    const nextErrors: typeof errors = {};

    if (!email.trim()) {
      nextErrors.email = 'Email is required.';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      nextErrors.email = 'Enter a valid email address.';
    }

    if (!password) {
      nextErrors.password = 'Password is required.';
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }, [email, password]);

  const handleSignIn = useCallback(async () => {
    if (!isLoaded || !signIn) return;

    if (!validateForm()) {
      triggerHaptic('warning');
      return;
    }

    setLoading(true);
    setErrors({});

    try {
      const result = await signIn.create({
        identifier: email.trim(),
        password,
      });

      if (result.status === 'complete' && result.createdSessionId) {
        await setActive({ session: result.createdSessionId });
        triggerHaptic('success');
        router.replace('/(main)/(tabs)/home');
        return;
      }

      setErrors({ general: 'Additional verification is required to sign in.' });
    } catch (err: any) {
      triggerHaptic('error');
      const message = err?.errors?.[0]?.message as string | undefined;
      const code = err?.errors?.[0]?.code as string | undefined;

      if (code === 'form_identifier_not_found') {
        setErrors({ email: 'No account found with this email.' });
      } else if (code === 'form_password_incorrect') {
        setErrors({ password: 'Incorrect password.' });
      } else {
        setErrors({ general: message || 'Unable to sign in right now.' });
      }
    } finally {
      setLoading(false);
    }
  }, [email, isLoaded, password, router, setActive, signIn, validateForm]);

  return (
    <Screen contentContainerStyle={styles.content}>
      <View style={styles.heroCard}>
        <View style={styles.heroIconWrap}>
          <Ionicons name="sparkles-outline" size={22} color={colors.primary.DEFAULT} />
        </View>
        <Text style={styles.title}>Welcome Back</Text>
        <Text style={styles.subtitle}>Continue your creator pipeline from where you left off.</Text>
      </View>

      <View style={styles.formCard}>
        {errors.general ? <Text style={styles.generalError}>{errors.general}</Text> : null}

        <OAuthButtons showDivider disabled={loading} />

        <Input
          label="Email"
          placeholder="you@domain.com"
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={(value) => {
            setEmail(value);
            if (errors.email) setErrors((prev) => ({ ...prev, email: undefined }));
          }}
          error={errors.email}
          containerStyle={styles.input}
        />

        <PasswordInput
          label="Password"
          placeholder="Enter your password"
          value={password}
          onChangeText={(value) => {
            setPassword(value);
            if (errors.password) setErrors((prev) => ({ ...prev, password: undefined }));
          }}
          error={errors.password}
          containerStyle={styles.input}
        />

        <Button onPress={handleSignIn} loading={loading} disabled={loading} size="lg">
          Sign In
        </Button>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>Need an account?</Text>
        <Link href="/(auth)/sign-up" asChild>
          <Text style={styles.link}>Create one</Text>
        </Link>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing['4xl'],
    paddingBottom: spacing['5xl'],
    gap: spacing.lg,
  },
  heroCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.panelAlt,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  heroIconWrap: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  title: {
    color: colors.text.DEFAULT,
    fontFamily: typography.fontFamily.heading,
    fontSize: typography.fontSize['2xl'],
    fontWeight: typography.fontWeight.bold,
  },
  subtitle: {
    color: colors.text.muted,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.base,
    lineHeight: 24,
  },
  formCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.surface,
    padding: spacing.lg,
  },
  generalError: {
    marginBottom: spacing.md,
    color: colors.error,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
  },
  input: {
    marginBottom: spacing.md,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
  },
  footerText: {
    color: colors.text.muted,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
  },
  link: {
    color: colors.primary.DEFAULT,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
  },
});
