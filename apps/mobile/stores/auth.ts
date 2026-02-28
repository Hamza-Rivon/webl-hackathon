/**
 * Auth Store
 *
 * Zustand store for authentication state management.
 *
 * `isOnboarded` – user passed through or explicitly skipped onboarding (controls forced redirect).
 * `hasPersona`  – user actually filled in their creator persona (controls the "finish setup" nudge).
 */

import { create } from 'zustand';

interface User {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  imageUrl?: string;
  isOnboarded: boolean;
}

interface AuthStore {
  user: User | null;
  isAuthenticated: boolean;
  isOnboarded: boolean;
  hasPersona: boolean;
  setUser: (user: User | null, hasPersona?: boolean) => void;
  clearUser: () => void;
  setOnboarded: (isOnboarded: boolean) => void;
  setHasPersona: (hasPersona: boolean) => void;
}

export const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  isAuthenticated: false,
  isOnboarded: false,
  hasPersona: false,

  setUser: (user, hasPersona) =>
    set({
      user,
      isAuthenticated: !!user,
      isOnboarded: user?.isOnboarded ?? false,
      hasPersona: hasPersona ?? false,
    }),

  clearUser: () =>
    set({
      user: null,
      isAuthenticated: false,
      isOnboarded: false,
      hasPersona: false,
    }),

  setOnboarded: (isOnboarded) =>
    set((state) => ({
      isOnboarded,
      user: state.user ? { ...state.user, isOnboarded } : null,
    })),

  setHasPersona: (hasPersona) =>
    set({ hasPersona }),
}));
