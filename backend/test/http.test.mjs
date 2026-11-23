import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { deleteApp, getApp } from 'firebase-admin/app';

process.env.FIREBASE_DATABASE_URL = 'https://demo-seafood-smart.firebaseio.com';
process.env.GOOGLE_CLOUD_PROJECT = 'demo-seafood-smart';
const { app } = await import('../dist/app.js');
let server;
let base;
before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await deleteApp(getApp());
});

test('public health and missing routes return predictable JSON', async () => {
  const health = await fetch(`${base}/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok' });
  const missing = await fetch(`${base}/does-not-exist`);
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: 'Not found' });
});

test('protected API requires a token without accessing Firebase', async () => {
  const response = await fetch(`${base}/api/v1/ponds`);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'Missing Firebase ID token' });
});

test('invalid and oversized JSON return client errors', async () => {
  const request = body => fetch(`${base}/api/v1/push-tokens`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body,
  });
  const invalid = await request('{');
  assert.equal(invalid.status, 400);
  assert.deepEqual(await invalid.json(), { error: 'Invalid JSON' });
  const large = await request(JSON.stringify({ token: 'x'.repeat(17000) }));
  assert.equal(large.status, 413);
  assert.deepEqual(await large.json(), { error: 'Request body too large' });
});
