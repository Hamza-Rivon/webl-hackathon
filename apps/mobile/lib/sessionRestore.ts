import * as SecureStore from 'expo-secure-store';

const SESSION_RESTORE_KEY = 'webl.last_route_v1';

interface LastRouteRecord {
  route: string;
  updatedAt: string;
}

const ROUTE_TTL_MS = 1000 * 60 * 60 * 24 * 14;

export function isRestorableRoute(route: string): boolean {
  if (!route || route === '/') return false;
  if (route.startsWith('/(auth)')) return false;
  if (route.startsWith('/(main)/onboarding')) return false;
  return route.startsWith('/(main)/');
}

export async function saveLastRoute(route: string): Promise<void> {
  if (!isRestorableRoute(route)) return;

  const payload: LastRouteRecord = {
    route,
    updatedAt: new Date().toISOString(),
  };

  try {
    await SecureStore.setItemAsync(SESSION_RESTORE_KEY, JSON.stringify(payload));
  } catch (error) {
    console.warn('Failed to persist last route in secure storage:', error);
  }
}

export async function clearLastRoute(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(SESSION_RESTORE_KEY);
  } catch (error) {
    console.warn('Failed to clear last route from secure storage:', error);
  }
}

export async function getLastRoute(): Promise<string | null> {
  try {
    const raw = await SecureStore.getItemAsync(SESSION_RESTORE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as LastRouteRecord;
    if (!parsed?.route || !parsed?.updatedAt) return null;
    if (!isRestorableRoute(parsed.route)) return null;

    const age = Date.now() - new Date(parsed.updatedAt).getTime();
    if (!Number.isFinite(age) || age < 0 || age > ROUTE_TTL_MS) {
      return null;
    }

    return parsed.route;
  } catch (error) {
    console.warn('Failed to restore last route from secure storage:', error);
    return null;
  }
}

export function getSafeFallbackRoute(): string {
  return '/(main)/(tabs)/home';
}
