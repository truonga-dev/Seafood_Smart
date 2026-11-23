import test, { before, after } from 'node:test';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';

let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-seafood-smart',
    database: { host: '127.0.0.1', port: 19000, rules: await readFile('firebase.rules.draft.json', 'utf8') },
  });
  await env.withSecurityRulesDisabled(async context => {
    await context.database().ref().set({
      pondMembers: { pond01: { owner1: { role: 'owner' }, viewer1: { role: 'viewer' } } },
      pondDevices: { pond01: { device1: true } },
      ponds: { pond01: { latest: { temp: 28 }, control: { mode: 'auto', feedNow: false }, thresholds: { tempMin: 25 } } },
    });
  });
});
after(async () => { if (env) await env.cleanup(); });

test('anonymous access is denied', async () => {
  const db = env.unauthenticatedContext().database();
  await assertFails(db.ref('ponds/pond01/latest').get());
  await assertFails(db.ref('ponds/pond01/latest').set({ temp: 29 }));
});

test('owner and viewer can read their pond but cannot write directly', async () => {
  for (const uid of ['owner1', 'viewer1']) {
    const db = env.authenticatedContext(uid).database();
    await assertSucceeds(db.ref('ponds/pond01/latest').get());
    await assertSucceeds(db.ref('ponds/pond01/control').get());
    await assertFails(db.ref('ponds/pond01/control').update({ mode: 'manual' }));
    await assertFails(db.ref('ponds/pond01/thresholds').update({ tempMin: 26 }));
  }
});

test('other users cannot read or write pond data', async () => {
  const db = env.authenticatedContext('other1').database();
  await assertFails(db.ref('ponds/pond01/latest').get());
  await assertFails(db.ref('ponds/pond01/latest').set({ temp: 29 }));
});

test('device can access its required paths but cannot change access assignments', async () => {
  const db = env.authenticatedContext('device1').database();
  await assertSucceeds(db.ref('ponds/pond01/control').get());
  await assertSucceeds(db.ref('ponds/pond01/latest').update({ temp: 29 }));
  await assertSucceeds(db.ref('ponds/pond01/history/sample').set({ ts: 123, temp: 29 }));
  await assertSucceeds(db.ref('ponds/pond01/alerts/sample').set({ ts: 123, message: 'test' }));
  await assertSucceeds(db.ref('ponds/pond01/control').update({ feedNow: false }));
  await assertSucceeds(db.ref('ponds/pond01/thresholds').update({ tempMin: 26 }));
  await assertFails(db.ref('pondMembers/pond01/device1/role').set('owner'));
  await assertFails(db.ref('pondDevices/pond02/device1').set(true));
  await assertFails(db.ref('ponds/pond02/latest').set({ temp: 29 }));
});

test('client tokens and worker state are private', async () => {
  const db = env.authenticatedContext('owner1').database();
  await assertFails(db.ref('pushTokens').get());
  await assertFails(db.ref('pushWorkerCursors/pond01').set({ ts: 123, id: '' }));
});
