/**
 * Navigation Service Provider
 *
 * React Context provider that initializes and provides the NavigationService singleton.
 * Wraps the app root to make navigation service available throughout the app.
 *
 * Requirements: 1.10
 */

import React, { createContext, useContext, useEffect } from 'react';
import { useRouter } from 'expo-router';
import { NavigationService, getNavigationService } from './navigationService';
import { useNavigationStore } from '../../stores/navigation';
import { useToast } from '../../components/ui/Toast';

/**
 * Navigation Service Context
 */
const NavigationServiceContext = createContext<NavigationService | null>(null);

/**
 * Props for NavigationServiceProvider
 */
interface NavigationServiceProviderProps {
  children: React.ReactNode;
}

/**
 * Navigation Service Provider Component
 *
 * Initializes the NavigationService singleton and provides it via React Context.
 * Must wrap the app root to make navigation service available.
 *
 * Requirements: 1.10
 */
export function NavigationServiceProvider({
  children,
}: NavigationServiceProviderProps): React.ReactElement {
  const router = useRouter();
  const { showToast } = useToast();
  
  // Get store actions
  const store = useNavigationStore();

  // Initialize service synchronously so it's available immediately
  // Use useMemo to ensure we only create it once
  const service = React.useMemo(() => {
    const navService = getNavigationService();
    return navService;
  }, []);

  // Initialize with router and store in useEffect (after mount)
  useEffect(() => {
    service.initialize(
      router,
      {
        setCurrentScreen: store.setCurrentScreen,
        pushToStack: store.pushToStack,
        popFromStack: store.popFromStack,
        setIsNavigating: store.setIsNavigating,
        setPendingNavigation: store.setPendingNavigation,
        addToHistory: store.addToHistory,
        clearStack: store.clearStack,
        getNavigationHistory: store.getNavigationHistory,
      },
      (message, type) => {
        showToast({
          type: type || 'info',
          title: type === 'error' ? 'Navigation Error' : 'Navigation',
          message,
        });
      }
    );
  }, [router, store, showToast, service]);

  return (
    <NavigationServiceContext.Provider value={service}>
      {children}
    </NavigationServiceContext.Provider>
  );
}

/**
 * Hook to access the NavigationService from context
 *
 * Requirements: 1.10
 *
 * @throws Error if used outside NavigationServiceProvider
 */
export function useNavigationService(): NavigationService {
  const service = useContext(NavigationServiceContext);

  if (!service) {
    throw new Error(
      'useNavigationService must be used within NavigationServiceProvider'
    );
  }

  return service;
}

/**
 * Hook to check if NavigationService is available
 * Useful for conditional rendering
 */
export function useNavigationServiceOptional(): NavigationService | null {
  return useContext(NavigationServiceContext);
}

export default NavigationServiceProvider;
