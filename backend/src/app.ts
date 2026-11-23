import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import { createHash } from 'node:crypto';
import { ZodError, z } from 'zod';
import swaggerUi from 'swagger-ui-express';
import { auth, database } from './firebase.js';
import { controlSchema, keySchema, thresholdPatchSchema, thresholdsSchema, timeRangeSchema, tokenSchema } from './validation.js';
import { openapi } from './openapi.js';
import { registerPushToken } from './push-token.js';

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;
const route = (fn: AsyncHandler) => (req: Request, res: Response, next: NextFunction) => { void fn(req, res, next).catch(next); };
class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const app = express();
const origins = new Set((process.env.CORS_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean));
app.disable('x-powered-by');
app.use(cors({ origin(origin, callback) { callback(null, !origin || origins.has(origin)); } }));
app.use(express.json({ limit: '16kb' }));
app.get('/', (_req, res) => {
  res.json({
    service: 'Seafood Smart API',
    status: 'running',
    health: '/health',
    documentation: '/api/docs',
  });
});
app.get('/health', (_req, res) => { res.json({ status: 'ok' }); });
app.get('/api/openapi.json', (_req, res) => { res.json(openapi); });
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openapi));

const api = express.Router();
api.use(route(async (req, res, next) => {
  const match = /^Bearer (\S+)$/.exec(req.header('authorization') || '');
  if (!match) throw new HttpError(401, 'Missing Firebase ID token');
  try {
    res.locals.uid = (await auth.verifyIdToken(match[1], true)).uid;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code && ['auth/argument-error', 'auth/invalid-id-token', 'auth/id-token-expired', 'auth/id-token-revoked', 'auth/user-disabled', 'auth/user-not-found'].includes(code)) {
      throw new HttpError(401, 'Invalid or expired Firebase ID token');
    }
    throw error;
  }
  next();
}));

async function roleFor(pondId: string, uid: string): Promise<'owner' | 'viewer'> {
  const snapshot = await database.ref('pondMembers').child(pondId).child(uid).child('role').get();
  const role: unknown = snapshot.val();
  if (role !== 'owner' && role !== 'viewer') throw new HttpError(403, 'No access to this pond');
  return role;
}

api.get('/ponds', route(async (_req, res) => {
  const memberships = await database.ref('pondMembers').get();
  const ponds: Array<{ pondId: string; role: string; info: unknown }> = [];
  const ids: Array<{ pondId: string; role: string }> = [];
  memberships.forEach(child => {
    const role: unknown = child.child(res.locals.uid).child('role').val();
    if (child.key && (role === 'owner' || role === 'viewer')) ids.push({ pondId: child.key, role });
  });
  await Promise.all(ids.map(async ({ pondId, role }) => {
    const info = await database.ref('ponds').child(pondId).child('info').get();
    ponds.push({ pondId, role, info: info.val() });
  }));
  ponds.sort((a, b) => a.pondId.localeCompare(b.pondId));
  res.json({ ponds });
}));

api.use('/ponds/:pondId', route(async (req, res, next) => {
  const pondId = keySchema.parse(req.params.pondId);
  res.locals.pondId = pondId;
  res.locals.role = await roleFor(pondId, res.locals.uid);
  next();
}));

function pondRef(res: Response) { return database.ref('ponds').child(res.locals.pondId); }
function requireOwner(res: Response) {
  if (res.locals.role !== 'owner') throw new HttpError(403, 'Owner role required');
}

api.get('/ponds/:pondId/latest', route(async (_req, res) => {
  const result = await pondRef(res).child('latest').get();
  res.json({ latest: result.val() });
}));
api.get('/ponds/:pondId/info', route(async (_req, res) => {
  const result = await pondRef(res).child('info').get();
  res.json({ info: result.val() });
}));
api.get('/ponds/:pondId/thresholds', route(async (_req, res) => {
  const result = await pondRef(res).child('thresholds').get();
  res.json({ thresholds: result.val() });
}));

api.patch('/ponds/:pondId/thresholds', route(async (req, res) => {
  requireOwner(res);
  const patch = thresholdPatchSchema.parse(req.body);
  const reference = pondRef(res).child('thresholds');
  let invalid = false;
  const result = await reference.transaction(current => {
    // Firebase may call the transaction first with an uncached null value.
    // Returning null lets the server retry with its authoritative value.
    if (current === null) return null;
    if (typeof current !== 'object' || Array.isArray(current)) { invalid = true; return; }
    const candidate = { ...current, ...patch };
    if (!thresholdsSchema.safeParse(candidate).success) { invalid = true; return; }
    invalid = false;
    return candidate;
  });
  if (!result.committed || invalid || !result.snapshot.exists()) throw new HttpError(422, 'Stored thresholds missing or resulting thresholds invalid');
  res.json({ thresholds: result.snapshot.val() });
}));

api.patch('/ponds/:pondId/control', route(async (req, res) => {
  requireOwner(res);
  const patch = controlSchema.parse(req.body);
  const reference = pondRef(res).child('control');
  let conflict = '';
  const result = await reference.transaction(current => {
    if (current === null) return null;
    if (typeof current !== 'object' || Array.isArray(current)) { conflict = 'Control has not been initialized by the device'; return; }
    const nextMode = patch.mode ?? current.mode;
    if ((patch.pump !== undefined || patch.aerator !== undefined) && nextMode !== 'manual') {
      conflict = 'Pump and aerator commands require manual mode'; return;
    }
    if (patch.feedNow && current.feedNow === true) {
      conflict = 'A feeding request is already pending'; return;
    }
    conflict = '';
    return { ...current, ...patch };
  });
  if (!result.committed || !result.snapshot.exists()) throw new HttpError(409, conflict || 'Control has not been initialized by the device');
  res.json({ control: result.snapshot.val(), message: 'Command stored; device execution is not yet confirmed' });
}));

type Entry = { id: string; ts: number; [key: string]: unknown };
async function readRange(res: Response, branch: 'history' | 'alerts', from: number, to: number): Promise<Entry[]> {
  const result: Entry[] = [];
  let cursor: { ts: number; id: string } | undefined;
  while (true) {
    const query = pondRef(res).child(branch).orderByChild('ts');
    const snapshot = await (cursor ? query.startAfter(cursor.ts, cursor.id) : query.startAt(from))
      .endAt(to).limitToFirst(2000).get();
    let count = 0;
    let last: { ts: number; id: string } | undefined;
    snapshot.forEach(child => {
      count++;
      const value: unknown = child.val();
      if (child.key && value && typeof value === 'object' && typeof (value as { ts?: unknown }).ts === 'number') {
        const entry = { ...(value as Record<string, unknown>), id: child.key, ts: (value as { ts: number }).ts };
        result.push(entry);
        last = { ts: entry.ts, id: entry.id };
      }
    });
    if (result.length > 150000) throw new HttpError(413, 'Too many records; request a shorter time range');
    if (count < 2000 || !last) break;
    cursor = last;
  }
  return result.sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id));
}

const metrics = ['temp', 'ph', 'do', 'turbidity', 'waterLevel', 'distance'] as const;
api.get('/ponds/:pondId/history', route(async (req, res) => {
  const { from, to } = timeRangeSchema.parse(req.query);
  const interval = z.enum(['raw', 'hour', 'day']).default('raw').parse(req.query.interval);
  const entries = await readRange(res, 'history', from, to);
  if (interval === 'raw') { res.json({ interval, entries }); return; }
  const duration = interval === 'hour' ? 3600000 : 86400000;
  const buckets = new Map<number, Entry[]>();
  for (const item of entries) {
    const start = Math.floor(item.ts / duration) * duration;
    const bucket = buckets.get(start) || [];
    bucket.push(item);
    buckets.set(start, bucket);
  }
  const data = [...buckets].map(([ts, items]) => {
    const averages: Record<string, number | null> = {};
    for (const metric of metrics) {
      const values = items.map(item => item[metric]).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
      averages[metric] = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    }
    return { ts, count: items.length, averages };
  });
  res.json({ interval, timeZone: 'UTC', entries: data });
}));

api.get('/ponds/:pondId/alerts', route(async (req, res) => {
  const { from, to } = timeRangeSchema.parse(req.query);
  const type = z.string().max(100).optional().parse(req.query.type);
  const entries = await readRange(res, 'alerts', from, to);
  res.json({ alerts: entries.filter(item => !type || (Array.isArray(item.types) && item.types.includes(type))).reverse() });
}));

api.post('/push-tokens', route(async (req, res) => {
  const { token } = tokenSchema.parse(req.body);
  const tokenId = createHash('sha256').update(token).digest('hex');
  const now = Date.now();
  const reference = database.ref('pushTokens').child(res.locals.uid).child(tokenId);
  await reference.transaction(current => registerPushToken(current, token, now));
  res.status(201).json({ tokenId });
}));
api.delete('/push-tokens/:tokenId', route(async (req, res) => {
  const tokenId = z.string().regex(/^[a-f0-9]{64}$/).parse(req.params.tokenId);
  await database.ref('pushTokens').child(res.locals.uid).child(tokenId).remove();
  res.status(204).end();
}));

app.use('/api/v1', api);
app.use((_req, _res, next) => { next(new HttpError(404, 'Not found')); });
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof ZodError) { res.status(400).json({ error: 'Invalid request', details: error.issues }); return; }
  if (error instanceof HttpError) { res.status(error.status).json({ error: error.message }); return; }
  if ((error as { type?: string })?.type === 'entity.too.large') { res.status(413).json({ error: 'Request body too large' }); return; }
  if (error instanceof SyntaxError && 'body' in error) { res.status(400).json({ error: 'Invalid JSON' }); return; }
  console.error(error);
  res.status(500).json({ error: 'Internal server error' });
});
export { app };
