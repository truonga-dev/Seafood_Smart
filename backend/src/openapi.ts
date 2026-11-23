const pondId = { in: 'path', name: 'pondId', required: true, schema: { type: 'string' } };
const range = [
  { in: 'query', name: 'from', required: true, schema: { type: 'integer' }, description: 'Epoch milliseconds, inclusive' },
  { in: 'query', name: 'to', required: true, schema: { type: 'integer' }, description: 'Epoch milliseconds, inclusive; maximum range 31 days' },
];
const response = { '200': { description: 'Success' }, '400': { description: 'Invalid input' }, '401': { description: 'Invalid token' }, '403': { description: 'Insufficient access' } };
const json = (schema: object) => ({ required: true, content: { 'application/json': { schema } } });
const operation = (summary: string, parameters: object[] = [], body?: object) => ({
  summary, security: [{ firebaseIdToken: [] }], parameters, responses: response,
  ...(body ? { requestBody: json(body) } : {}),
});
const number = { type: 'number' };
const thresholds = {
  type: 'object', additionalProperties: false,
  properties: Object.fromEntries(['tempMin', 'tempMax', 'phMin', 'phMax', 'doOn', 'doOff', 'turbMax', 'levelLow', 'levelHigh'].map(key => [key, number])),
};
export const openapi = {
  openapi: '3.0.3',
  info: { title: 'Seafood Smart API', version: '0.1.0', description: 'Firebase ID token and per-pond owner/viewer authorization are required. Timestamps are epoch milliseconds. Aggregates use UTC.' },
  components: { securitySchemes: { firebaseIdToken: { type: 'http', scheme: 'bearer', bearerFormat: 'Firebase ID token' } } },
  paths: {
    '/health': { get: { summary: 'Process health', responses: response } },
    '/api/v1/ponds': { get: operation('List accessible ponds') },
    '/api/v1/ponds/{pondId}/info': { get: operation('Pond information', [pondId]) },
    '/api/v1/ponds/{pondId}/latest': { get: operation('Latest device telemetry', [pondId]) },
    '/api/v1/ponds/{pondId}/history': { get: operation('History and UTC averages', [pondId, ...range, { in: 'query', name: 'interval', schema: { type: 'string', enum: ['raw', 'hour', 'day'], default: 'raw' } }]) },
    '/api/v1/ponds/{pondId}/alerts': { get: operation('Alerts filtered by time and type', [pondId, ...range, { in: 'query', name: 'type', schema: { type: 'string' } }]) },
    '/api/v1/ponds/{pondId}/thresholds': {
      get: operation('Read thresholds', [pondId]),
      patch: operation('Update thresholds (owner)', [pondId], thresholds),
    },
    '/api/v1/ponds/{pondId}/control': {
      patch: operation('Store device command (owner)', [pondId], {
        type: 'object', additionalProperties: false,
        properties: { mode: { type: 'string', enum: ['auto', 'manual'] }, pump: { type: 'boolean' }, aerator: { type: 'boolean' }, feedNow: { type: 'boolean', enum: [true] } },
      }),
    },
    '/api/v1/push-tokens': { post: operation('Register an Expo push token', [], { type: 'object', required: ['token'], properties: { token: { type: 'string' } } }) },
    '/api/v1/push-tokens/{tokenId}': { delete: operation('Remove own push token', [{ in: 'path', name: 'tokenId', required: true, schema: { type: 'string' } }]) },
  },
};
