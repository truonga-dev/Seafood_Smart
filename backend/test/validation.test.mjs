import test from 'node:test';
import assert from 'node:assert/strict';
import { controlSchema, thresholdPatchSchema, thresholdsSchema, timeRangeSchema, tokenSchema } from '../dist/validation.js';

const defaults = {
  tempMin: 25, tempMax: 32, phMin: 6.5, phMax: 8.5,
  doOn: 5, doOff: 6.5, turbMax: 100, levelLow: 30, levelHigh: 85,
};

test('thresholds enforce hysteresis and physical bounds', () => {
  assert.equal(thresholdsSchema.safeParse(defaults).success, true);
  assert.equal(thresholdsSchema.safeParse({ ...defaults, doOn: 7 }).success, false);
  assert.equal(thresholdsSchema.safeParse({ ...defaults, levelHigh: 101 }).success, false);
  assert.equal(thresholdPatchSchema.safeParse({}).success, false);
  assert.equal(thresholdPatchSchema.safeParse({ unknown: 1 }).success, false);
});

test('control accepts commands without allowing clients to reset feedNow', () => {
  assert.equal(controlSchema.safeParse({ mode: 'manual', pump: true }).success, true);
  assert.equal(controlSchema.safeParse({ feedNow: true }).success, true);
  assert.equal(controlSchema.safeParse({ feedNow: false }).success, false);
  assert.equal(controlSchema.safeParse({}).success, false);
});

test('time ranges require integer timestamps in order and within 31 days', () => {
  assert.equal(timeRangeSchema.safeParse({ from: '0', to: '1000' }).success, true);
  assert.equal(timeRangeSchema.safeParse({ from: '', to: '1000' }).success, false);
  assert.equal(timeRangeSchema.safeParse({ from: '2', to: '1' }).success, false);
  assert.equal(timeRangeSchema.safeParse({ from: '0', to: String(32 * 86400000) }).success, false);
  assert.equal(timeRangeSchema.safeParse({ from: '9007199254740992', to: '9007199254740992' }).success, false);
});

test('push token validation accepts Expo tokens and rejects other strings', () => {
  assert.equal(tokenSchema.safeParse({ token: 'ExpoPushToken[abc_123-xyz]' }).success, true);
  assert.equal(tokenSchema.safeParse({ token: 'invalid' }).success, false);
});
