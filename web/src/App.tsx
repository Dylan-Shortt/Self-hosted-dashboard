import { useEffect, useState } from 'react';

type ApiStatus = 'checking' | 'online' | 'offline';

export function App() {
  const [status, setStatus] = useState<ApiStatus>('checking');

  useEffect(() => {
    fetch('/api/health')
      .then((res) => setStatus(res.ok ? 'online' : 'offline'))
      .catch(() => setStatus('offline'));
  }, []);

  return (
    <main className="app">
      <h1>Dev Dashboard</h1>
      <p className="subtitle">GitHub activity, CI runs, system stats, weather and tasks.</p>
      <p className={`status status-${status}`}>API: {status}</p>
    </main>
  );
}
