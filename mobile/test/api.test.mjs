import test from 'node:test';
import assert from 'node:assert/strict';

process.env.EXPO_PUBLIC_API_BASE_URL = 'https://example.test/api/v1/';
const { api, pondPath } = await import('../src/api.ts');
const user = { getIdToken: async () => 'test-token' };

test('API attaches Firebase token and sends control JSON', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, 'https://example.test/api/v1/ponds/pond01/control');
      assert.equal(options.headers.Authorization, 'Bearer test-token');
      assert.equal(options.method, 'PATCH');
      assert.deepEqual(JSON.parse(options.body), { mode: 'manual' });
      return new Response(JSON.stringify({ message: 'stored' }), { status: 200 });
    };
    assert.deepEqual(await api(user, `${pondPath('pond01')}/control`, { method: 'PATCH', body: { mode: 'manual' } }), { message: 'stored' });
  } finally { globalThis.fetch = original; }
});

test('API exposes backend errors without treating them as success', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ error: 'Owner role required' }), { status: 403 });
    await assert.rejects(api(user, '/ponds/pond01/control'), /Owner role required/);
    assert.equal(pondPath('pond name'), '/ponds/pond%20name');
  } finally { globalThis.fetch = original; }
});

test('push token registration and deletion use the API contract', async () => {
  const original = globalThis.fetch;
  const calls = [];
  try {
    globalThis.fetch = async (url, options) => {
      calls.push({ url, method: options.method, body: options.body });
      return options.method === 'POST'
        ? new Response(JSON.stringify({ tokenId: 'a'.repeat(64) }), { status: 201 })
        : new Response(null, { status: 204 });
    };
    const result = await api(user, '/push-tokens', { method: 'POST', body: { token: 'ExpoPushToken[demo]' } });
    await api(user, `/push-tokens/${result.tokenId}`, { method: 'DELETE' });
    assert.deepEqual(calls.map(call => call.method), ['POST', 'DELETE']);
    assert.deepEqual(JSON.parse(calls[0].body), { token: 'ExpoPushToken[demo]' });
    assert.ok(calls[1].url.endsWith('/push-tokens/' + 'a'.repeat(64)));
  } finally { globalThis.fetch = original; }
});
