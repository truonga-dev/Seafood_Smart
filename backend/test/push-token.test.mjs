import test from 'node:test';
import assert from 'node:assert/strict';
import { registerPushToken, wasRegisteredWhenAlertOccurred } from '../dist/push-token.js';

test('registering the same token retains its first registration time', () => {
  const old = registerPushToken(null, 'token', 100);
  const refreshed = registerPushToken(old, 'token', 300);
  assert.equal(refreshed.registeredAt, 100);
  assert.equal(refreshed.updatedAt, 300);
  assert.equal(wasRegisteredWhenAlertOccurred(refreshed.registeredAt, 200), true);
});

test('legacy tokens retain their previous update time on first refresh', () => {
  const refreshed = registerPushToken({ expoPushToken: 'token', updatedAt: 100 }, 'token', 300);
  assert.equal(refreshed.registeredAt, 100);
  assert.equal(wasRegisteredWhenAlertOccurred(refreshed.registeredAt, 200), true);
});

test('newly registered or replaced tokens do not receive earlier alerts', () => {
  const value = registerPushToken({ expoPushToken: 'old', registeredAt: 100, updatedAt: 200 }, 'new', 300);
  assert.equal(value.registeredAt, 300);
  assert.equal(wasRegisteredWhenAlertOccurred(value.registeredAt, 200), false);
});

test('invalid legacy registration timestamps are replaced safely', () => {
  const value = registerPushToken({ expoPushToken: 'token', registeredAt: 'invalid', updatedAt: 150 }, 'token', 300);
  assert.equal(value.registeredAt, 150);
});
