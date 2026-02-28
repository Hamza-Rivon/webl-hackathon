/**
 * Root Layout
 *
 * Configures ClerkProvider and global app providers.
 * Handles authentication state and routing.
 */

import '../global.css';

import { ClerkProvider, useAuth } from '@clerk/clerk-expo';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { tokenCache } from '@/lib/clerk';
import { queryClient } from '@/lib/queryClient';
import { AppLoadingScreen, ToastProvider } from '@/components/ui';
import { NavigationServiceProvider } from '@/lib/navigation/NavigationServiceProvider';
import { ScreenProvider } from '@/contexts/ScreenContext';
import { NavigationDebugOverlay } from '@/components/navigation/NavigationDebugOverlay';
import { useNavigationDebug } from '@/hooks/useNavigationDebug';

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY!;

if (!publishableKey) {
  throw new Error('Missing EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY. Please add it to your .env file.');
}

function AppNavigator() {
  const { isLoaded } = useAuth();
  const { visible: debugVisible, toggle: toggleDebug } = useNavigationDebug();

  if (!isLoaded) {
    return <AppLoadingScreen message="Securing your session" />;
  }

  return (
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(main)" />
      </Stack>
      <NavigationDebugOverlay visible={debugVisible} onClose={toggleDebug} />
    </>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ClerkProvider
        publishableKey={publishableKey}
        tokenCache={tokenCache}
        appearance={{
          variables: {
            colorPrimary: '#0EA5A8',
            colorBackground: '#EEF4FB',
            colorText: '#10233D',
            borderRadius: '0.875rem',
          },
        }}
      >
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <NavigationServiceProvider>
              <ScreenProvider>
                <AppNavigator />
              </ScreenProvider>
            </NavigationServiceProvider>
          </ToastProvider>
        </QueryClientProvider>
      </ClerkProvider>
    </GestureHandlerRootView>
  );
}
