import { database } from './firebase.js';
import { deleteApp, getApp } from 'firebase-admin/app';
import { keySchema } from './validation.js';
import { wasRegisteredWhenAlertOccurred } from './push-token.js';

type Cursor = { ts: number; id: string };
type Ticket = { status: 'ok' | 'error'; id?: string; message?: string; details?: { error?: string } };
type Receipt = { status: 'ok' | 'error'; message?: string; details?: { error?: string } };
const SEND_URL = 'https://exp.host/--/api/v2/push/send';
const RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';
const INTERVAL_MS = 5000;
const RECEIPT_DELAY_MS = 15 * 60 * 1000;
const ponds = [...new Set((process.env.PUSH_PONDS || '').split(',').map(id => id.trim()).filter(Boolean))];
if (!ponds.length) throw new Error('Set PUSH_PONDS to one or more pond IDs');
ponds.forEach(id => keySchema.parse(id));

async function post(url: string, body: unknown): Promise<any> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Expo HTTP ${response.status}`);
  const result: any = await response.json();
  if (result.errors?.length) throw new Error('Expo rejected push request');
  return result;
}

async function removeToken(uid: string, tokenId: string, token: string, updatedAt: number) {
  const ref = database.ref('pushTokens').child(uid).child(tokenId);
  await ref.once('value');
  await ref.transaction(current => {
    if (current === null) return null;
    if (current?.expoPushToken === token && current?.updatedAt === updatedAt) return null;
    return;
  });
}

async function deliver(pondId: string, alertId: string, alert: Record<string, unknown>) {
  const members = await database.ref('pondMembers').child(pondId).get();
  const userIds: string[] = [];
  members.forEach(member => {
    const role: unknown = member.child('role').val();
    if (member.key && (role === 'owner' || role === 'viewer')) userIds.push(member.key);
  });
  for (const uid of userIds) {
    const tokens = await database.ref('pushTokens').child(uid).get();
    const entries: Array<{ id: string; token: string; registeredAt: number; updatedAt: number }> = [];
    tokens.forEach(child => {
      const value: unknown = child.val();
      if (!child.key || !value || typeof value !== 'object') return;
      const data = value as { expoPushToken?: unknown; registeredAt?: unknown; updatedAt?: unknown };
      if (typeof data.expoPushToken === 'string' && typeof data.updatedAt === 'number') {
        entries.push({
          id: child.key,
          token: data.expoPushToken,
          registeredAt: typeof data.registeredAt === 'number' ? data.registeredAt : data.updatedAt,
          updatedAt: data.updatedAt,
        });
      }
    });
    for (const entry of entries) {
      // Do not deliver an old alert to a device registered after the event.
      if (typeof alert.ts === 'number' && !wasRegisteredWhenAlertOccurred(entry.registeredAt, alert.ts)) continue;
      const deliveryRef = database.ref('notificationDeliveries').child(pondId).child(alertId).child(uid).child(entry.id);
      if ((await deliveryRef.get()).exists()) continue;
      const response = await post(SEND_URL, {
        to: entry.token,
        title: 'Cảnh báo ao nuôi',
        body: typeof alert.message === 'string' ? alert.message : 'Ao nuôi có cảnh báo mới',
        sound: 'default',
        channelId: 'alerts',
        data: { pondId, alertId },
      });
      const ticket: Ticket | undefined = Array.isArray(response.data) ? response.data[0] : response.data;
      if (!ticket) throw new Error('Expo returned no ticket');
      if (ticket.status === 'error') {
        if (ticket.details?.error === 'DeviceNotRegistered') {
          await removeToken(uid, entry.id, entry.token, entry.updatedAt);
          await deliveryRef.set({ status: 'unregistered', updatedAt: Date.now() });
          continue;
        }
        throw new Error(`Expo push ticket error: ${ticket.details?.error || ticket.message || 'unknown'}`);
      }
      if (!ticket.id || !keySchema.safeParse(ticket.id).success) throw new Error('Expo returned an invalid ticket ID');
      const now = Date.now();
      const updates: Record<string, unknown> = {};
      updates[`notificationDeliveries/${pondId}/${alertId}/${uid}/${entry.id}`] = { status: 'accepted', ticketId: ticket.id, updatedAt: now };
      updates[`pushReceipts/${ticket.id}`] = { uid, tokenId: entry.id, token: entry.token, tokenUpdatedAt: entry.updatedAt, checkAfter: now + RECEIPT_DELAY_MS };
      await database.ref().update(updates);
    }
  }
}

async function processPond(pondId: string) {
  const cursorRef = database.ref('pushWorkerCursors').child(pondId);
  await cursorRef.once('value');
  // The first run begins now; later runs resume from the persisted cursor.
  const initial = Date.now();
  const initialized = await cursorRef.transaction(current => current || { ts: initial, id: '' });
  const cursor = initialized.snapshot.val() as Cursor;
  if (!Number.isFinite(cursor?.ts) || typeof cursor?.id !== 'string') throw new Error('Invalid push worker cursor');
  const ref = database.ref('ponds').child(pondId).child('alerts').orderByChild('ts');
  const query = cursor.id ? ref.startAfter(cursor.ts, cursor.id) : ref.startAt(cursor.ts);
  const snapshot = await query.limitToFirst(100).get();
  const alerts: Array<{ id: string; value: Record<string, unknown> }> = [];
  snapshot.forEach(child => {
    const value: unknown = child.val();
    if (child.key && value && typeof value === 'object' && typeof (value as { ts?: unknown }).ts === 'number') {
      alerts.push({ id: child.key, value: value as Record<string, unknown> });
    }
  });
  for (const alert of alerts) {
    await deliver(pondId, alert.id, alert.value);
    await cursorRef.set({ ts: alert.value.ts, id: alert.id });
  }
}

async function processReceipts() {
  // Query only due receipts, including those retained across process restarts.
  const due = await database.ref('pushReceipts').orderByChild('checkAfter').endAt(Date.now()).limitToFirst(100).get();
  const entries: Array<{ id: string; value: any }> = [];
  due.forEach(child => { if (child.key) entries.push({ id: child.key, value: child.val() }); });
  if (!entries.length) return;
  const response = await post(RECEIPTS_URL, { ids: entries.map(entry => entry.id) });
  for (const entry of entries) {
    const receipt: Receipt | undefined = response.data?.[entry.id];
    if (!receipt) {
      await database.ref('pushReceipts').child(entry.id).child('checkAfter').set(Date.now() + RECEIPT_DELAY_MS);
      continue;
    }
    if (receipt.status === 'error') {
      console.error('Expo receipt error:', receipt.details?.error || receipt.message || 'unknown');
      if (receipt.details?.error === 'DeviceNotRegistered') {
        const { uid, tokenId, token, tokenUpdatedAt } = entry.value;
        if (keySchema.safeParse(uid).success && keySchema.safeParse(tokenId).success && typeof token === 'string' && typeof tokenUpdatedAt === 'number') {
          await removeToken(uid, tokenId, token, tokenUpdatedAt);
        }
      }
    }
    await database.ref('pushReceipts').child(entry.id).remove();
  }
}

let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { stopping = true; });
console.log('Expo push worker started for', ponds.join(', '));
while (!stopping) {
  for (const pondId of ponds) {
    try { await processPond(pondId); }
    catch (error) { console.error('Push processing failed for', pondId, error instanceof Error ? error.message : error); }
  }
  try { await processReceipts(); }
  catch (error) { console.error('Receipt processing failed:', error instanceof Error ? error.message : error); }
  if (!stopping) await new Promise(resolve => setTimeout(resolve, INTERVAL_MS));
}
database.goOffline();
await deleteApp(getApp());
