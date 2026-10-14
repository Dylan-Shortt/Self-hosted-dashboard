import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type Database } from '../db.js';
import { SqliteSessionStore } from './sqliteStore.js';

/** A session object in the shape @fastify/session stores (cast, since only cookie and user matter). */
function sessionWith(expires: Date, login = 'x') {
  return { cookie: { expires }, user: { login } } as never;
}

const future = () => new Date(Date.now() + 60_000);
const past = () => new Date(Date.now() - 60_000);

describe('SqliteSessionStore', () => {
  let db: Database;
  let store: SqliteSessionStore;

  const setSession = (id: string, session: unknown) =>
    new Promise<void>((resolve, reject) => {
      store.set(id, session as never, (err) => (err ? reject(err) : resolve()));
    });

  const getSession = (id: string) =>
    new Promise<unknown>((resolve, reject) => {
      store.get(id, (err, session) => (err ? reject(err) : resolve(session ?? null)));
    });

  const destroySession = (id: string) =>
    new Promise<void>((resolve, reject) => {
      store.destroy(id, (err) => (err ? reject(err) : resolve()));
    });

  const rowCount = () =>
    (db.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n;

  beforeEach(() => {
    db = openDatabase(':memory:');
    store = new SqliteSessionStore(db);
  });

  afterEach(() => {
    db.close();
  });

  it('returns the stored data for a set then get', async () => {
    await setSession('abc', sessionWith(future(), 'octocat'));
    await expect(getSession('abc')).resolves.toMatchObject({ user: { login: 'octocat' } });
  });

  it('returns null for an unknown session id', async () => {
    await expect(getSession('missing')).resolves.toBeNull();
  });

  it('returns null for an expired session and deletes its row', async () => {
    await setSession('old', sessionWith(past()));
    expect(rowCount()).toBe(1);

    await expect(getSession('old')).resolves.toBeNull();
    expect(rowCount()).toBe(0);
  });

  it('overwrites the data when the same id is set twice (one row)', async () => {
    await setSession('same', sessionWith(future(), 'first'));
    await setSession('same', sessionWith(future(), 'second'));

    expect(rowCount()).toBe(1);
    await expect(getSession('same')).resolves.toMatchObject({ user: { login: 'second' } });
  });

  it('destroy removes the session', async () => {
    await setSession('gone', sessionWith(future()));
    await destroySession('gone');

    expect(rowCount()).toBe(0);
    await expect(getSession('gone')).resolves.toBeNull();
  });

  it('purgeExpired removes only the expired rows', async () => {
    await setSession('expired', sessionWith(past()));
    await setSession('fresh', sessionWith(future()));

    store.purgeExpired();

    expect(db.prepare('SELECT id FROM sessions').all()).toEqual([{ id: 'fresh' }]);
  });
});
