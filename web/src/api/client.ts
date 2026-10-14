export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`API error ${status}: ${code}`);
  }
}

type UnauthorizedHandler = (code: string) => void;
const unauthorizedHandlers = new Set<UnauthorizedHandler>();

/**
 * Subscribes to 401 responses from any API call (e.g. the session expired).
 * The handler gets the server's error code, such as 'session_expired'. Returns an unsubscribe.
 */
export function onUnauthorized(handler: UnauthorizedHandler): () => void {
  unauthorizedHandlers.add(handler);
  return () => {
    unauthorizedHandlers.delete(handler);
  };
}

async function readErrorCode(res: Response): Promise<string | null> {
  const body: unknown = await res.json().catch(() => null);
  return typeof body === 'object' &&
    body !== null &&
    'error' in body &&
    typeof body.error === 'string'
    ? body.error
    : null;
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');
  if (typeof init.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(path, { ...init, headers });

  if (!res.ok) {
    const code = await readErrorCode(res);
    // A caller that already gave up (aborted) should not change the app's auth state.
    if (res.status === 401 && !init.signal?.aborted) {
      unauthorizedHandlers.forEach((handler) => handler(code ?? 'unauthenticated'));
    }
    throw new ApiError(res.status, code ?? 'unknown_error');
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
