/**
 * Navigation Debug Hook
 *
 * Hook to toggle and manage navigation debug overlay.
 * Can be enabled via environment variable EXPO_PUBLIC_NAV_DEBUG or programmatically.
 *
 * Requirements: 13.6
 */

import { useState, useEffect } from 'react';

/**
 * Hook to manage navigation debug overlay visibility
 *
 * Requirements: 13.6
 *
 * @returns Object with visible state and toggle function
 */
export function useNavigationDebug() {
  // Check environment variable for default state
  const envDebugEnabled = process.env.EXPO_PUBLIC_NAV_DEBUG === 'true';
  
  const [visible, setVisible] = useState(envDebugEnabled);

  // Toggle visibility
  const toggle = () => {
    setVisible((prev) => !prev);
  };

  // Enable debug mode
  const enable = () => {
    setVisible(true);
  };

  // Disable debug mode
  const disable = () => {
    setVisible(false);
  };

  // Only enable in development mode
  useEffect(() => {
    if (!__DEV__ && visible) {
      setVisible(false);
    }
  }, [visible]);

  return {
    visible: __DEV__ ? visible : false, // Force false in production
    toggle,
    enable,
    disable,
  };
}

export default useNavigationDebug;
