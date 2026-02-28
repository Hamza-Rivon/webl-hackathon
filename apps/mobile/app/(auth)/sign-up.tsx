import { useSignUp } from '@clerk/clerk-expo';
import { Link, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@/components/ui/SymbolIcon';
import { OAuthButtons } from '@/components/auth';
import { Button, Input, PasswordInput, Screen } from '@/components/ui';
import { borderRadius, colors, spacing, typography } from '@/lib/theme';
import { triggerHaptic } from '@/lib/haptics';

type SignUpStep = 'register' | 'verify';

export default function SignUpScreen() {
  const { signUp, setActive, isLoaded } = useSignUp();
  const router = useRouter();

  const [step, setStep] = useState<SignUpStep>('register');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<{
    email?: string;
    password?: string;
    confirmPassword?: string;
    code?: string;
    general?: string;
  }>({});

  const validateRegister = useCallback(() => {
    const nextErrors: typeof errors = {};

    if (!email.trim()) {
      nextErrors.email = 'Email is required.';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      nextErrors.email = 'Enter a valid email address.';
    }

    if (!password) {
      nextErrors.password = 'Password is required.';
    } else if (password.length < 8) {
      nextErrors.password = 'Use at least 8 characters.';
    }

    if (confirmPassword !== password) {
      nextErrors.confirmPassword = 'Passwords do not match.';
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }, [confirmPassword, email, password]);

  const handleRegister = useCallback(async () => {
    if (!isLoaded || !signUp) return;

    if (!validateRegister()) {
      triggerHaptic('warning');
      return;
    }

    setLoading(true);
    setErrors({});

    try {
      await signUp.create({
        emailAddress: email.trim(),
        password,
      });
      await signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
      triggerHaptic('success');
      setStep('verify');
    } catch (err: any) {
      triggerHaptic('error');
      const message = err?.errors?.[0]?.message as string | undefined;
      const code = err?.errors?.[0]?.code as string | undefined;

      if (code === 'form_identifier_exists') {
        setErrors({ email: 'An account already exists for this email.' });
      } else {
        setErrors({ general: message || 'Unable to create account.' });
      }
    } finally {
      setLoading(false);
    }
  }, [email, isLoaded, password, signUp, validateRegister]);

  const handleVerify = useCallback(async () => {
    if (!isLoaded || !signUp) return;

    if (!code.trim()) {
      setErrors({ code: 'Verification code is required.' });
      triggerHaptic('warning');
      return;
    }

    setLoading(true);
    setErrors({});

    try {
      const result = await signUp.attemptEmailAddressVerification({ code: code.trim() });
      if (result.status === 'complete' && result.createdSessionId) {
        await setActive({ session: result.createdSessionId });
        triggerHaptic('success');
        router.replace('/(main)/onboarding');
        return;
      }
      setErrors({ general: 'Additional verification is required.' });
    } catch (err: any) {
      triggerHaptic('error');
      const message = err?.errors?.[0]?.message as string | undefined;
      setErrors({ code: message || 'Verification failed.' });
    } finally {
      setLoading(false);
    }
  }, [code, isLoaded, router, setActive, signUp]);

  const handleResend = useCallback(async () => {
    if (!isLoaded || !signUp) return;

    setLoading(true);
    setErrors({});
    try {
      await signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
      triggerHaptic('success');
    } catch {
      triggerHaptic('error');
      setErrors({ general: 'Could not resend code. Try again.' });
    } finally {
      setLoading(false);
    }
  }, [isLoaded, signUp]);

  if (step === 'verify') {
    return (
      <Screen contentContainerStyle={styles.content}>
        <View style={styles.heroCard}>
          <View style={styles.heroIconWrap}>
            <Ionicons name="mail-outline" size={22} color={colors.primary.DEFAULT} />
          </View>
          <Text style={styles.title}>Verify Your Email</Text>
          <Text style={styles.subtitle}>Enter the code sent to {email}.</Text>
        </View>

        <View style={styles.formCard}>
          {errors.general ? <Text style={styles.generalError}>{errors.general}</Text> : null}
          <Input
            label="Verification Code"
            placeholder="6-digit code"
            keyboardType="number-pad"
            value={code}
            onChangeText={(value) => {
              setCode(value);
              if (errors.code) setErrors((prev) => ({ ...prev, code: undefined }));
            }}
            error={errors.code}
            containerStyle={styles.input}
          />

          <Button onPress={handleVerify} loading={loading} disabled={loading} size="lg">
            Verify and Continue
          </Button>

          <Button variant="ghost" onPress={handleResend} disabled={loading}>
            Resend Code
          </Button>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>Wrong email?</Text>
          <Button variant="ghost" onPress={() => setStep('register')}>
            Go Back
          </Button>
        </View>
      </Screen>
    );
  }

  return (
    <Screen contentContainerStyle={styles.content}>
      <View style={styles.heroCard}>
        <View style={styles.heroIconWrap}>
          <Ionicons name="sparkles-outline" size={22} color={colors.primary.DEFAULT} />
        </View>
        <Text style={styles.title}>Create Account</Text>
        <Text style={styles.subtitle}>Set up your studio and start building episodes.</Text>
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
          placeholder="Use at least 8 characters"
          value={password}
          onChangeText={(value) => {
            setPassword(value);
            if (errors.password) setErrors((prev) => ({ ...prev, password: undefined }));
          }}
          error={errors.password}
          containerStyle={styles.input}
        />

        <PasswordInput
          label="Confirm Password"
          placeholder="Repeat your password"
          value={confirmPassword}
          onChangeText={(value) => {
            setConfirmPassword(value);
            if (errors.confirmPassword) setErrors((prev) => ({ ...prev, confirmPassword: undefined }));
          }}
          error={errors.confirmPassword}
          containerStyle={styles.input}
        />

        <Button onPress={handleRegister} loading={loading} disabled={loading} size="lg">
          Create Account
        </Button>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>Already have an account?</Text>
        <Link href="/(auth)/sign-in" asChild>
          <Text style={styles.link}>Sign in</Text>
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
