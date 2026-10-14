import type { SessionStore } from '@fastify/session';
import type { Database } from '../db.js';

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type StoredSession = Parameters<SessionStore['set']>[1];

export class SqliteSessionStore implements SessionStore {
  constructor(private readonly db: Database) {
    this.purgeExpired();
  }

  set(sessionId: string, session: StoredSession, callback: (err?: unknown) => void): void {
    try {
      const expiresAt = session.cookie.expires?.getTime() ?? Date.now() + DEFAULT_TTL_MS;
      this.db
        .prepare(
          `INSERT INTO sessions (id, data, expires_at) VALUES (?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET data = excluded.data, expires_at = excluded.expires_at`,
        )
        .run(sessionId, JSON.stringify(session), expiresAt);
      callback();
    } catch (err) {
      callback(err);
    }
  }

  get(sessionId: string, callback: (err: unknown, session?: StoredSession | null) => void): void {
    try {
      const row = this.db
        .prepare('SELECT data, expires_at FROM sessions WHERE id = ?')
        .get(sessionId) as { data: string; expires_at: number } | undefined;

      if (!row) return callback(null, null);
      if (row.expires_at <= Date.now()) {
        this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
        return callback(null, null);
      }
      callback(null, JSON.parse(row.data) as StoredSession);
    } catch (err) {
      callback(err);
    }
  }

  destroy(sessionId: string, callback: (err?: unknown) => void): void {
    try {
      this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
      callback();
    } catch (err) {
      callback(err);
    }
  }

  purgeExpired(): void {
    this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
  }
}
