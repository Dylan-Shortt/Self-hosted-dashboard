import { useEffect, useState } from 'react';
import type { User } from '../auth/AuthContext';
import { useFocusOnMount } from '../hooks/useFocusOnMount';
import { UserMenu } from './UserMenu';

type ApiStatus = 'checking' | 'online' | 'offline';

function useApiStatus(): ApiStatus {
  const [status, setStatus] = useState<ApiStatus>('checking');

  useEffect(() => {
    fetch('/api/health')
      .then((res) => setStatus(res.ok ? 'online' : 'offline'))
      .catch(() => setStatus('offline'));
  }, []);

  return status;
}

export function Dashboard({ user }: { user: User }) {
  const apiStatus = useApiStatus();
  const headingRef = useFocusOnMount<HTMLHeadingElement>();

  return (
    <>
      <header className="topbar">
        <h1 ref={headingRef} tabIndex={-1}>
          Dev Dashboard
        </h1>
        <UserMenu user={user} />
      </header>
      <main className="app">
        <p className="subtitle">Signed in as {user.login}.</p>
        <section className="card" aria-labelledby="status-heading">
          <h2 id="status-heading">Server</h2>
          <p className={`status status-${apiStatus}`}>API: {apiStatus}</p>
        </section>
      </main>
    </>
  );
}
