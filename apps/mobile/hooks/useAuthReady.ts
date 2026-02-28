import { useAuth } from '@clerk/clerk-expo';

/**
 * Returns true only when Clerk auth has finished loading and a user is signed in.
 * Use this to prevent protected API queries from firing before a token exists.
 */
export function useAuthReady(): boolean {
  const { isLoaded, isSignedIn } = useAuth();
  return Boolean(isLoaded && isSignedIn);
}

export default useAuthReady;
