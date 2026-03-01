/**
 * ThemeContext
 *
 * Global theme provider for light/dark mode.
 * Default: light mode. Persists preference via expo-secure-store.
 */

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import {
  type ThemeMode,
  type ThemeColors,
  getThemeColors,
  lightColors,
} from '@/lib/theme';

const THEME_STORAGE_KEY = 'webl_theme_mode';

interface ThemeContextValue {
  mode: ThemeMode;
  colors: ThemeColors;
  isDark: boolean;
  toggle: () => void;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  mode: 'light',
  colors: lightColors as unknown as ThemeColors,
  isDark: false,
  toggle: () => {},
  setMode: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>('light');

  useEffect(() => {
    SecureStore.getItemAsync(THEME_STORAGE_KEY).then((stored) => {
      if (stored === 'dark' || stored === 'light') {
        setModeState(stored);
      }
    });
  }, []);

  const setMode = useCallback((newMode: ThemeMode) => {
    setModeState(newMode);
    SecureStore.setItemAsync(THEME_STORAGE_KEY, newMode);
  }, []);

  const toggle = useCallback(() => {
    setModeState((prev) => {
      const next = prev === 'light' ? 'dark' : 'light';
      SecureStore.setItemAsync(THEME_STORAGE_KEY, next);
      return next;
    });
  }, []);

  const value: ThemeContextValue = {
    mode,
    colors: getThemeColors(mode),
    isDark: mode === 'dark',
    toggle,
    setMode,
  };

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
