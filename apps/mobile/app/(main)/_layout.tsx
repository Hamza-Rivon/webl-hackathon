import { useEffect, useMemo, useRef, useState } from 'react';
import { Redirect, Stack, useSegments } from 'expo-router';
import { useAuth, useUser } from '@clerk/clerk-expo';
import { useAuthStore } from '@/stores/auth';
import { useApiClient } from '@/lib/api';
import { headerPresets } from '@/lib/navigation/headerPresets';
import { PipelinePillOverlay } from '@/components/navigation/PipelinePillOverlay';

export default function MainLayout() {
  const { isSignedIn, isLoaded } = useAuth();
  const { user } = useUser();
  const userId = user?.id;
  const segments = useSegments();

  const apiClient = useApiClient();
  const { isOnboarded, setUser } = useAuthStore();
  const syncedUserRef = useRef<string | null>(null);
  const syncingUserRef = useRef<string | null>(null);
  const [profileSyncResolved, setProfileSyncResolved] = useState(false);
  const [profileSyncFailed, setProfileSyncFailed] = useState(false);

  const inOnboarding = useMemo(() => (segments as string[]).includes('onboarding'), [segments]);

  useEffect(() => {
    let cancelled = false;

    async function syncProfile() {
      if (!isSignedIn || !userId) {
        syncedUserRef.current = null;
        syncingUserRef.current = null;
        if (!cancelled) setProfileSyncResolved(false);
        if (!cancelled) setProfileSyncFailed(false);
        return;
      }

      if (syncedUserRef.current === userId || syncingUserRef.current === userId) {
        if (!cancelled) setProfileSyncResolved(true);
        return;
      }

      if (!cancelled) setProfileSyncResolved(false);
      if (!cancelled) setProfileSyncFailed(false);
      syncingUserRef.current = userId;
      try {
        const response = await apiClient.get('/users/profile');
        if (cancelled) return;
        const profile = response.data as {
          id: string;
          email: string;
          firstName?: string | null;
          lastName?: string | null;
          imageUrl?: string | null;
          isOnboarded?: boolean;
          personaData?: Record<string, unknown> | null;
        };

        setUser(
          {
            id: profile.id,
            email: profile.email,
            firstName: profile.firstName || undefined,
            lastName: profile.lastName || undefined,
            imageUrl: profile.imageUrl || undefined,
            isOnboarded: !!profile.isOnboarded,
          },
          !!profile.personaData,
        );
        syncedUserRef.current = userId;
      } catch {
        syncedUserRef.current = null;
        if (!cancelled) setProfileSyncFailed(true);
      } finally {
        syncingUserRef.current = null;
        if (!cancelled) {
          setProfileSyncResolved(true);
        }
      }
    }

    void syncProfile();

    return () => {
      cancelled = true;
    };
  }, [apiClient, isSignedIn, setUser, userId]);

  if (!isLoaded) {
    return null;
  }

  if (!isSignedIn) {
    return <Redirect href="/(auth)/sign-in" />;
  }

  const shouldEnforceOnboarding = true;

  if (!inOnboarding && !profileSyncResolved) {
    return null;
  }

  if (shouldEnforceOnboarding && profileSyncResolved && !profileSyncFailed && !isOnboarded && !inOnboarding) {
    return <Redirect href="/(main)/onboarding" />;
  }

  return (
    <>
      <Stack screenOptions={headerPresets.default}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false, animation: 'fade' }} />
        <Stack.Screen name="series" options={{ headerShown: false }} />
        <Stack.Screen name="templates" options={{ headerShown: false }} />
        <Stack.Screen name="jobs" options={{ headerShown: false }} />
        <Stack.Screen name="notifications" options={{ headerShown: false }} />
        <Stack.Screen name="settings" options={{ headerShown: false }} />
        <Stack.Screen name="episode" options={{ headerShown: false }} />
      </Stack>
      <PipelinePillOverlay />
    </>
  );
}
