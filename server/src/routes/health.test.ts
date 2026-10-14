import { afterEach, describe, expect, it } from 'vitest';
import { createTestApp } from '../test/helpers.js';

describe('GET /api/health', () => {
  const { app } = createTestApp();
  afterEach(() => app.close());

  it('reports ok', async () => {
    const res = await app.inject('/api/health');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok' });
  });
});
