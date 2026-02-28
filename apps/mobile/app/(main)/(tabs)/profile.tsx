import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, Text, View } from 'react-native';
import { useAuth, useUser } from '@clerk/clerk-expo';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@/components/ui/SymbolIcon';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Button, Card, Input, ListRow, PasswordInput, Screen } from '@/components/ui';
import { useToast } from '@/components/ui/Toast';
import { useApiClient } from '@/lib/api';
import { clearAllTokens } from '@/lib/clerk';
import { useAuthStore } from '@/stores/auth';
import { useNotificationStore } from '@/stores/notifications';
import {
  type AudienceAge,
  type ContentGoal,
  type Niche,
  type Platform,
  type Tone,
  useOnboardingStore,
} from '@/stores/onboarding';
import { colors } from '@/lib/theme';
import { triggerHaptic } from '@/lib/haptics';
import { styles } from '@/components/screens/profile-screen.styles';

interface UsageSummary {
  episodesCreatedToday: number;
  rendersCompletedToday: number;
  llmCallsToday: number;
  transcriptionSecondsToday: number;
  totalEpisodesCreated: number;
  totalRendersCompleted: number;
  totalLlmCalls: number;
  totalEstimatedCostUSD: number;
}

interface UsageLimitEntry {
  current: number;
  max: number;
  pct: number;
}

interface UsageLimitsResponse {
  allowed: boolean;
  reason: string | null;
  limits: {
    externalApiCalls: UsageLimitEntry;
    llmCalls: UsageLimitEntry;
    embeddingCalls: UsageLimitEntry;
    episodes: UsageLimitEntry;
    renders: UsageLimitEntry;
    estimatedCost: UsageLimitEntry;
  };
  warnings: string[];
  subscriptionActive: boolean;
  subscriptionTier: string;
}

interface PersonaSnapshot {
  niche?: string | null;
  subNiche?: string | null;
  targetAudience?: string | null;
  audienceAge?: string | null;
  tone?: string | null;
  platforms?: string[] | null;
  contentGoal?: string | null;
  postingFrequency?: string | null;
}

const VALID_NICHES = new Set<Niche>([
  'fitness',
  'business',
  'lifestyle',
  'tech',
  'beauty',
  'food',
  'travel',
  'education',
  'entertainment',
  'gaming',
]);
const VALID_TONES = new Set<Tone>(['aggressive', 'calm', 'educational', 'motivational', 'humorous']);
const VALID_PLATFORMS = new Set<Platform>(['tiktok', 'reels', 'shorts']);
const VALID_AUDIENCE_AGES = new Set<AudienceAge>(['13-17', '18-24', '25-34', '35-44', '45+']);
const VALID_CONTENT_GOALS = new Set<ContentGoal>([
  'grow_audience',
  'monetize',
  'brand_awareness',
  'community',
  'education',
]);

function normalizePlatforms(input: string[] | null | undefined): Platform[] {
  if (!input?.length) return [];
  if (input.includes('all')) return ['tiktok', 'reels', 'shorts'];
  return input.filter((value): value is Platform => VALID_PLATFORMS.has(value as Platform));
}

function hydrateFromServerPersona(snapshot: PersonaSnapshot | undefined | null) {
  if (!snapshot) return {};

  const niche = snapshot.niche && VALID_NICHES.has(snapshot.niche as Niche)
    ? (snapshot.niche as Niche)
    : undefined;
  const tone = snapshot.tone && VALID_TONES.has(snapshot.tone as Tone)
    ? (snapshot.tone as Tone)
    : undefined;
  const audienceAge = snapshot.audienceAge && VALID_AUDIENCE_AGES.has(snapshot.audienceAge as AudienceAge)
    ? (snapshot.audienceAge as AudienceAge)
    : undefined;
  const contentGoal = snapshot.contentGoal && VALID_CONTENT_GOALS.has(snapshot.contentGoal as ContentGoal)
    ? (snapshot.contentGoal as ContentGoal)
    : undefined;

  return {
    niche,
    tone,
    subNiche: snapshot.subNiche || undefined,
    targetAudience: snapshot.targetAudience || undefined,
    audienceAge,
    contentGoal,
    postingFrequency: snapshot.postingFrequency || undefined,
    platforms: normalizePlatforms(snapshot.platforms),
  };
}

export default function ProfileScreen() {
  const { user } = useUser();
  const { signOut } = useAuth();
  const router = useRouter();
  const { showToast } = useToast();
  const clearUser = useAuthStore((state) => state.clearUser);
  const { hydrateFromPersona, getResumeRoute, resetOnboarding } = useOnboardingStore();
  const unreadNotifications = useNotificationStore((state) => state.unreadCount);
  const apiClient = useApiClient();

  const [signingOut, setSigningOut] = useState(false);
  const [savingAccount, setSavingAccount] = useState(false);
  const [updatingPassword, setUpdatingPassword] = useState(false);
  const [updatingAvatar, setUpdatingAvatar] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const profileQuery = useQuery({
    queryKey: ['profile', 'usage'],
    queryFn: async () => {
      const response = await apiClient.get('/users/me');
      return response.data as {
        email: string;
        firstName?: string | null;
        lastName?: string | null;
        isOnboarded?: boolean;
        subscriptionTier?: string;
        subscriptionActive?: boolean;
        personaData?: PersonaSnapshot | null;
        usage?: UsageSummary | null;
        usageLimits?: UsageLimitsResponse | null;
      };
    },
  });

  const usage = profileQuery.data?.usage;
  const usageLimits = profileQuery.data?.usageLimits;

  useEffect(() => {
    setFirstName(profileQuery.data?.firstName || user?.firstName || '');
    setLastName(profileQuery.data?.lastName || user?.lastName || '');
  }, [profileQuery.data?.firstName, profileQuery.data?.lastName, user?.firstName, user?.lastName]);

  const displayName = useMemo(() => {
    const full = `${profileQuery.data?.firstName || ''} ${profileQuery.data?.lastName || ''}`.trim();
    return full || user?.fullName || 'Creator';
  }, [profileQuery.data?.firstName, profileQuery.data?.lastName, user?.fullName]);

  const initials = useMemo(() => {
    const fromName = displayName
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase();
    return fromName || 'C';
  }, [displayName]);

  const accountDirty = useMemo(() => {
    const initialFirst = profileQuery.data?.firstName || user?.firstName || '';
    const initialLast = profileQuery.data?.lastName || user?.lastName || '';
    return firstName.trim() !== initialFirst || lastName.trim() !== initialLast;
  }, [firstName, lastName, profileQuery.data?.firstName, profileQuery.data?.lastName, user?.firstName, user?.lastName]);

  const canUpdatePassword =
    currentPassword.trim().length > 0 &&
    newPassword.trim().length >= 8 &&
    confirmPassword.trim().length > 0 &&
    newPassword === confirmPassword;

  const saveAccount = async () => {
    if (!accountDirty || savingAccount) return;

    try {
      setSavingAccount(true);
      if (user) {
        await user.update({
          firstName: firstName.trim() || null,
          lastName: lastName.trim() || null,
        });
      }

      await apiClient.put('/users/me', {
        firstName: firstName.trim() || null,
        lastName: lastName.trim() || null,
      });

      await profileQuery.refetch();
      showToast({
        type: 'success',
        title: 'Account updated',
        message: 'Your profile details were saved.',
      });
    } catch (error) {
      showToast({
        type: 'error',
        title: 'Update failed',
        message: error instanceof Error ? error.message : 'Could not update account details.',
      });
    } finally {
      setSavingAccount(false);
    }
  };

  const updatePassword = async () => {
    if (!user || !canUpdatePassword || updatingPassword) return;

    try {
      setUpdatingPassword(true);
      await user.updatePassword({
        currentPassword: currentPassword.trim(),
        newPassword: newPassword.trim(),
        signOutOfOtherSessions: false,
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      showToast({
        type: 'success',
        title: 'Password updated',
        message: 'Your Clerk password was changed.',
      });
    } catch (error) {
      showToast({
        type: 'error',
        title: 'Password update failed',
        message: error instanceof Error ? error.message : 'Could not update password.',
      });
    } finally {
      setUpdatingPassword(false);
    }
  };

  const handleSignOut = async () => {
    Alert.alert('Sign out', 'Do you want to sign out from this device?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          try {
            setSigningOut(true);
            triggerHaptic('warning');
            await signOut();
          } catch {
            // continue cleanup even if Clerk session is already invalid
          } finally {
            await clearAllTokens();
            clearUser();
            setSigningOut(false);
            router.replace('/(auth)/sign-in');
          }
        },
      },
    ]);
  };

  const handleResumeOnboarding = () => {
    const personaDraft = hydrateFromServerPersona(profileQuery.data?.personaData);
    hydrateFromPersona(personaDraft);
    const resumeRoute = getResumeRoute();
    const route =
      profileQuery.data?.isOnboarded && resumeRoute === '/(main)/onboarding/complete'
        ? '/(main)/onboarding/niche'
        : resumeRoute;
    router.push(route as never);
  };

  const handleRestartOnboarding = () => {
    Alert.alert('Restart onboarding', 'This will reset your draft onboarding answers on this device. Continue?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Restart',
        style: 'destructive',
        onPress: () => {
          resetOnboarding();
          router.push('/(main)/onboarding/niche' as never);
        },
      },
    ]);
  };

  const handleUpdateProfileImage = async () => {
    if (!user || updatingAvatar) return;

    try {
      setUpdatingAvatar(true);
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        showToast({
          type: 'error',
          title: 'Permission needed',
          message: 'Allow photo library access to update your profile image.',
        });
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.82,
      });

      if (result.canceled || !result.assets[0]) return;
      const asset = result.assets[0];

      await user.setProfileImage({
        file: {
          uri: asset.uri,
          name: asset.fileName || `profile-${Date.now()}.jpg`,
          type: asset.mimeType || 'image/jpeg',
        } as any,
      });

      await profileQuery.refetch();
      showToast({
        type: 'success',
        title: 'Profile image updated',
        message: 'Your new profile photo is live.',
      });
    } catch (error) {
      showToast({
        type: 'error',
        title: 'Image update failed',
        message: error instanceof Error ? error.message : 'Could not update profile image.',
      });
    } finally {
      setUpdatingAvatar(false);
    }
  };

  return (
    <Screen contentContainerStyle={styles.content}>
      <Card variant="elevated">
        <View style={styles.userRow}>
          <Pressable onPress={() => void handleUpdateProfileImage()} style={styles.avatarPressable}>
            {user?.imageUrl ? (
              <Image source={{ uri: user.imageUrl }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarFallback}>
                <Text style={styles.avatarText}>{initials}</Text>
              </View>
            )}
            <View style={styles.avatarBadge}>
              {updatingAvatar ? (
                <ActivityIndicator size="small" color={colors.text.inverse} />
              ) : (
                <Ionicons name="camera-outline" size={14} color={colors.text.inverse} />
              )}
            </View>
          </Pressable>

          <View style={styles.userInfo}>
            <Text style={styles.name}>{displayName}</Text>
            <Text style={styles.email}>{profileQuery.data?.email || user?.primaryEmailAddress?.emailAddress || ''}</Text>
            <Text style={styles.avatarHint}>Tap avatar to update photo</Text>
          </View>
        </View>
      </Card>

      {!profileQuery.data?.isOnboarded ? (
        <View style={styles.onboardingBanner}>
          <View style={styles.onboardingBannerHeader}>
            <Ionicons name="sparkles-outline" size={18} color="#0B5E3A" />
            <Text style={styles.onboardingBannerTitle}>Finish onboarding</Text>
          </View>
          <Text style={styles.onboardingBannerBody}>
            Complete the 5-step setup so WEBL can tailor scripts, templates, and rendering defaults to your creator profile.
          </Text>
          <Button onPress={handleResumeOnboarding}>Continue onboarding</Button>
        </View>
      ) : null}

      {usageLimits && !usageLimits.subscriptionActive && (
        <View style={styles.suspendedBanner}>
          <Ionicons name="alert-circle" size={20} color={colors.text.inverse} />
          <View style={{ flex: 1 }}>
            <Text style={styles.suspendedBannerText}>Account Suspended</Text>
            <Text style={styles.suspendedBannerSubtext}>
              {usageLimits.reason || 'Your subscription is not active. Contact support to resume.'}
            </Text>
          </View>
        </View>
      )}

      {usageLimits && usageLimits.subscriptionActive && !usageLimits.allowed && (
        <View style={[styles.suspendedBanner, { backgroundColor: colors.warning }]}>
          <Ionicons name="warning" size={20} color={colors.text.inverse} />
          <View style={{ flex: 1 }}>
            <Text style={styles.suspendedBannerText}>Usage Limit Reached</Text>
            <Text style={styles.suspendedBannerSubtext}>
              {usageLimits.reason || 'You have exceeded your usage limits.'}
            </Text>
          </View>
        </View>
      )}

      <Card>
        <Text style={styles.sectionTitle}>Subscription</Text>
        <View style={styles.subscriptionRow}>
          <Text style={styles.subscriptionTier}>
            {usageLimits?.subscriptionTier || profileQuery.data?.subscriptionTier || 'free'}
          </Text>
          <View
            style={[
              styles.subscriptionBadge,
              {
                backgroundColor: usageLimits?.subscriptionActive !== false
                  ? colors.accent.light
                  : colors.error,
              },
            ]}
          >
            <Text
              style={[
                styles.subscriptionBadgeText,
                {
                  color: usageLimits?.subscriptionActive !== false
                    ? colors.accent.dark
                    : colors.text.inverse,
                },
              ]}
            >
              {usageLimits?.subscriptionActive !== false ? 'Active' : 'Suspended'}
            </Text>
          </View>
        </View>
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>Usage Limits</Text>

        {usageLimits?.limits ? (
          <>
            <UsageLimitBar label="External API Calls" entry={usageLimits.limits.externalApiCalls} />
            <UsageLimitBar label="LLM Calls" entry={usageLimits.limits.llmCalls} />
            <UsageLimitBar label="Embedding Calls" entry={usageLimits.limits.embeddingCalls} />
            <UsageLimitBar label="Episodes" entry={usageLimits.limits.episodes} />
            <UsageLimitBar label="Renders" entry={usageLimits.limits.renders} />
            <UsageLimitBar
              label="Est. Cost (USD)"
              entry={usageLimits.limits.estimatedCost}
              formatValue={(v) => `$${v.toFixed(2)}`}
              formatMax={(v) => `$${v.toFixed(2)}`}
            />
          </>
        ) : (
          <View style={styles.grid}>
            <UsageTile label="Total Episodes" value={usage?.totalEpisodesCreated ?? 0} />
            <UsageTile label="Total Renders" value={usage?.totalRendersCompleted ?? 0} />
            <UsageTile label="Total LLM Calls" value={usage?.totalLlmCalls ?? 0} />
            <UsageTile
              label="Estimated Cost"
              value={`$${(usage?.totalEstimatedCostUSD ?? 0).toFixed(2)}`}
            />
          </View>
        )}

        <View style={styles.dailyStatsRow}>
          <View style={styles.dailyStat}>
            <Text style={styles.dailyStatLabel}>Episodes today</Text>
            <Text style={styles.dailyStatValue}>{usage?.episodesCreatedToday ?? 0}</Text>
          </View>
          <View style={styles.dailyStat}>
            <Text style={styles.dailyStatLabel}>Renders today</Text>
            <Text style={styles.dailyStatValue}>{usage?.rendersCompletedToday ?? 0}</Text>
          </View>
          <View style={styles.dailyStat}>
            <Text style={styles.dailyStatLabel}>LLM today</Text>
            <Text style={styles.dailyStatValue}>{usage?.llmCallsToday ?? 0}</Text>
          </View>
          <View style={styles.dailyStat}>
            <Text style={styles.dailyStatLabel}>Transcription (s)</Text>
            <Text style={styles.dailyStatValue}>{Math.round(usage?.transcriptionSecondsToday ?? 0)}</Text>
          </View>
        </View>
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>Settings</Text>
        <ListRow
          icon={<Ionicons name="notifications-outline" size={16} color={colors.text.muted} />}
          title="Notification Center"
          subtitle="Pipeline updates and failures"
          value={unreadNotifications > 0 ? `${unreadNotifications}` : undefined}
          onPress={() => router.push('/(main)/notifications' as never)}
        />
        <ListRow
          icon={<Ionicons name="mic-outline" size={16} color={colors.text.muted} />}
          title="ElevenLabs Voice"
          subtitle="Voice ID and API key"
          onPress={() => router.push('/(main)/settings/elevenlabs-voice')}
        />
        <ListRow
          icon={<Ionicons name="grid-outline" size={16} color={colors.text.muted} />}
          title="Templates"
          subtitle="Browse template library"
          onPress={() => router.push('/(main)/(tabs)/templates')}
        />
        <ListRow
          icon={<Ionicons name="albums-outline" size={16} color={colors.text.muted} />}
          title="Series"
          subtitle="Manage series"
          onPress={() => router.push('/(main)/(tabs)/series')}
        />
        <ListRow
          icon={<Ionicons name="compass-outline" size={16} color={colors.text.muted} />}
          title={profileQuery.data?.isOnboarded ? 'Review onboarding' : 'Resume onboarding'}
          subtitle={profileQuery.data?.isOnboarded ? 'Tune your creator plan and defaults' : 'Continue from your next incomplete step'}
          onPress={handleResumeOnboarding}
        />
        <ListRow
          icon={<Ionicons name="refresh-outline" size={16} color={colors.text.muted} />}
          title="Restart onboarding"
          subtitle="Start from the first question"
          onPress={handleRestartOnboarding}
        />
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>Account</Text>
        <View style={styles.stack}>
          <Input label="First name" value={firstName} onChangeText={setFirstName} />
          <Input label="Last name" value={lastName} onChangeText={setLastName} />
          <Button onPress={() => void saveAccount()} disabled={!accountDirty || savingAccount} loading={savingAccount}>
            Save Profile
          </Button>
        </View>
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>Security</Text>
        <View style={styles.stack}>
          <PasswordInput
            label="Current password"
            value={currentPassword}
            onChangeText={setCurrentPassword}
            placeholder="Current password"
          />
          <PasswordInput
            label="New password"
            value={newPassword}
            onChangeText={setNewPassword}
            placeholder="At least 8 characters"
          />
          <PasswordInput
            label="Confirm new password"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            placeholder="Repeat new password"
          />
          {!canUpdatePassword ? (
            <Text style={styles.helperText}>Use your current password and a new password with at least 8 characters.</Text>
          ) : null}
          <Button
            variant="outline"
            onPress={() => void updatePassword()}
            disabled={!canUpdatePassword || updatingPassword}
            loading={updatingPassword}
          >
            Update Password
          </Button>
        </View>
      </Card>

      <Button
        variant="danger"
        onPress={handleSignOut}
        loading={signingOut}
        disabled={signingOut}
      >
        Sign Out
      </Button>
    </Screen>
  );
}

function UsageTile({ label, value }: { label: string; value: number | string }) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={styles.tileValue}>{value}</Text>
    </View>
  );
}

function getBarColor(pct: number): string {
  if (pct >= 90) return colors.error;
  if (pct >= 80) return colors.warning;
  if (pct >= 60) return colors.secondary.DEFAULT;
  return colors.accent.DEFAULT;
}

function UsageLimitBar({
  label,
  entry,
  formatValue,
  formatMax,
}: {
  label: string;
  entry: UsageLimitEntry;
  formatValue?: (v: number) => string;
  formatMax?: (v: number) => string;
}) {
  const currentStr = formatValue ? formatValue(entry.current) : String(entry.current);
  const maxStr = formatMax ? formatMax(entry.max) : String(entry.max);
  const barColor = getBarColor(entry.pct);
  const isWarning = entry.pct >= 80;

  return (
    <View style={styles.limitRow}>
      <View style={styles.limitHeader}>
        <Text style={styles.limitLabel}>{label}</Text>
        <Text style={styles.limitValues}>
          {currentStr} / {maxStr}
        </Text>
      </View>
      <View style={styles.limitTrack}>
        <View
          style={[
            styles.limitFill,
            {
              width: `${Math.min(100, entry.pct)}%`,
              backgroundColor: barColor,
            },
          ]}
        />
      </View>
      {isWarning && (
        <Text style={[styles.limitWarning, entry.pct >= 100 ? { color: colors.error } : undefined]}>
          {entry.pct >= 100 ? 'Limit reached' : `${entry.pct}% used`}
        </Text>
      )}
    </View>
  );
}
