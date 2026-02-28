/**
 * Entry Point
 *
 * Redirects based on authentication state.
 */

import { useEffect, useState } from 'react';
import { Redirect, type Href } from 'expo-router';
import { useAuth } from '@clerk/clerk-expo';
import { getLastRoute, getSafeFallbackRoute } from '@/lib/sessionRestore';
import { trackScreenView } from '@/lib/analytics';
import { AppLoadingScreen } from '@/components/ui';

export default function Index() {
  const { isSignedIn, isLoaded } = useAuth();
  const [resumeRoute, setResumeRoute] = useState<string | null>(null);
  const [isResolvingRoute, setIsResolvingRoute] = useState(true);

  useEffect(() => {
    trackScreenView('app_entry');
  }, []);

  useEffect(() => {
    let isActive = true;

    async function resolveRoute() {
      if (!isLoaded || !isSignedIn) {
        if (isActive) {
          setResumeRoute(null);
          setIsResolvingRoute(false);
        }
        return;
      }

      const restored = await getLastRoute();
      if (isActive) {
        setResumeRoute(restored || getSafeFallbackRoute());
        setIsResolvingRoute(false);
      }
    }

    void resolveRoute();

    return () => {
      isActive = false;
    };
  }, [isLoaded, isSignedIn]);

  if (!isLoaded) {
    return <AppLoadingScreen message="Initializing authentication" />;
  }

  if (isSignedIn) {
    if (isResolvingRoute) {
      return <AppLoadingScreen message="Restoring your workspace" />;
    }
    return <Redirect href={(resumeRoute || getSafeFallbackRoute()) as Href} />;
  }

  return <Redirect href="/(auth)/sign-in" />;
}
