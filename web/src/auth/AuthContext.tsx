import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { ApiError, apiFetch, onUnauthorized } from '../api/client';

export interface User {
  id: number;
  login: string;
  avatarUrl: string;
}

export type AuthState =
  | { status: 'loading' }
  /** `reason` is set when a signed-in session ended unexpectedly. */
  | { status: 'unauthenticated'; reason?: 'session_expired' }
  | { status: 'authenticated'; user: User }
  | { status: 'error' };

interface AuthContextValue {
  state: AuthState;
  /**
   * Ends the session on the server, then shows the login page.
   * Rejects if the server could not be reached, leaving the user signed in.
   */
  logout: () => Promise<void>;
  /** Re-checks the session, e.g. after the server could not be reached. */
  retry: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const unsubscribe = onUnauthorized((code) =>
      setState(
        code === 'session_expired'
          ? { status: 'unauthenticated', reason: 'session_expired' }
          : { status: 'unauthenticated' },
      ),
    );

    apiFetch<{ user: User }>('/api/auth/me', { signal: controller.signal })
      .then(({ user }) => {
        if (!controller.signal.aborted) setState({ status: 'authenticated', user });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        // A 401 simply means "not signed in". Anything else means we could not tell.
        // (The 401 case is already handled by the onUnauthorized subscription above.)
        if (!(err instanceof ApiError && err.status === 401)) setState({ status: 'error' });
      });

    return () => {
      controller.abort();
      unsubscribe();
    };
  }, [attempt]);

  const logout = useCallback(async () => {
    await apiFetch('/api/auth/logout', { method: 'POST' });
    setState({ status: 'unauthenticated' });
  }, []);

  const retry = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt((n) => n + 1);
  }, []);

  const value = useMemo(() => ({ state, logout, retry }), [state, logout, retry]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
