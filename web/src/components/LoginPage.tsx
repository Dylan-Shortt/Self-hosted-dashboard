import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useFocusOnMount } from '../hooks/useFocusOnMount';

const ERROR_MESSAGES: Record<string, string> = {
  invalid_request: 'The sign-in attempt was incomplete or expired. Please try again.',
  invalid_state: 'The sign-in attempt could not be verified. Please try again.',
  denied: 'GitHub sign-in was cancelled.',
  not_allowed: 'This GitHub account is not allowed to use this dashboard.',
  github_error: 'Could not complete sign-in with GitHub. Please try again.',
};

/** Reads ?auth_error=... left by the server's callback, then removes it from the address bar. */
function useAuthError(): string | null {
  const [message] = useState<string | null>(() => {
    const code = new URL(window.location.href).searchParams.get('auth_error');
    if (!code) return null;
    return ERROR_MESSAGES[code] ?? 'Sign-in failed. Please try again.';
  });

  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('auth_error')) return;

    url.searchParams.delete('auth_error');
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
  }, []);

  return message;
}

export function LoginPage() {
  const { state } = useAuth();
  const authError = useAuthError();
  const headingRef = useFocusOnMount<HTMLHeadingElement>();

  const expired = state.status === 'unauthenticated' && state.reason === 'session_expired';
  const error = authError ?? (expired ? 'Your session expired. Please sign in again.' : null);

  return (
    <main className="login">
      <h1 ref={headingRef} tabIndex={-1}>
        Dev Dashboard
      </h1>
      <p className="subtitle">GitHub activity, CI runs, system stats, weather and tasks.</p>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      {/* A real navigation, not fetch(): the server redirects the browser to GitHub. */}
      <a className="button button-primary" href="/api/auth/login">
        Sign in with GitHub
      </a>
    </main>
  );
}
