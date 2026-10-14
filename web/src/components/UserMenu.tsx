import { useRef, useState } from 'react';
import { useAuth, type User } from '../auth/AuthContext';

/** Only load avatars over https. The URL comes from GitHub, but there is no reason to trust it. */
function safeAvatarUrl(url: string): string | null {
  try {
    return new URL(url).protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

export function UserMenu({ user }: { user: User }) {
  const { logout } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A ref, not state: it blocks a second click before React has re-rendered the disabled button.
  const signingOut = useRef(false);
  const avatarUrl = safeAvatarUrl(user.avatarUrl);

  async function handleSignOut() {
    if (signingOut.current) return;
    signingOut.current = true;
    setBusy(true);
    setError(null);
    try {
      await logout();
    } catch {
      // The server session is still alive, so stay signed in and let the user retry.
      setError('Could not sign out. Check your connection and try again.');
      setBusy(false);
      signingOut.current = false;
    }
  }

  return (
    <div className="user-menu">
      {avatarUrl && <img className="avatar" src={avatarUrl} alt="" width={32} height={32} />}
      <span className="user-login">{user.login}</span>
      <button className="button" type="button" onClick={handleSignOut} disabled={busy}>
        {busy ? 'Signing out...' : 'Sign out'}
      </button>
      {error && (
        <p className="alert alert-inline" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
