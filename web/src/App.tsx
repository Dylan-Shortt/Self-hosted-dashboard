import { AuthProvider, useAuth } from './auth/AuthContext';
import { Dashboard } from './components/Dashboard';
import { LoginPage } from './components/LoginPage';

/** Only signed-in users reach the dashboard. Everyone else gets the login page. */
function AuthGate() {
  const { state, retry } = useAuth();

  switch (state.status) {
    case 'loading':
      return (
        <main className="centered">
          <p className="subtitle" role="status">
            Loading...
          </p>
        </main>
      );
    case 'error':
      return (
        <main className="centered">
          <p className="alert" role="alert">
            Could not reach the server.
          </p>
          <button className="button" type="button" onClick={retry}>
            Try again
          </button>
        </main>
      );
    case 'unauthenticated':
      return <LoginPage />;
    case 'authenticated':
      return <Dashboard user={state.user} />;
  }
}

export function App() {
  return (
    <AuthProvider>
      <AuthGate />
    </AuthProvider>
  );
}
