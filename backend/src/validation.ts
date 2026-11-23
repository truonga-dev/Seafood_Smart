import { z } from 'zod';

export const keySchema = z.string().min(1).max(128).regex(/^[^.#$\[\]/\u0000-\u001f\u007f]+$/);

export const thresholdsSchema = z.object({
  tempMin: z.number().finite().min(-50).max(125),
  tempMax: z.number().finite().min(-50).max(125),
  phMin: z.number().finite().min(0).max(14),
  phMax: z.number().finite().min(0).max(14),
  doOn: z.number().finite().min(0).max(15),
  doOff: z.number().finite().min(0).max(15),
  turbMax: z.number().finite().min(0).max(200),
  levelLow: z.number().finite().min(0).max(100),
  levelHigh: z.number().finite().min(0).max(100),
}).strict().superRefine((value, ctx) => {
  for (const [low, high] of [
    ['tempMin', 'tempMax'], ['phMin', 'phMax'],
    ['doOn', 'doOff'], ['levelLow', 'levelHigh'],
  ] as const) {
    if (value[low] >= value[high]) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [low], message: `${low} must be less than ${high}` });
    }
  }
});

export const thresholdPatchSchema = z.object({
  tempMin: z.number().finite().min(-50).max(125).optional(),
  tempMax: z.number().finite().min(-50).max(125).optional(),
  phMin: z.number().finite().min(0).max(14).optional(),
  phMax: z.number().finite().min(0).max(14).optional(),
  doOn: z.number().finite().min(0).max(15).optional(),
  doOff: z.number().finite().min(0).max(15).optional(),
  turbMax: z.number().finite().min(0).max(200).optional(),
  levelLow: z.number().finite().min(0).max(100).optional(),
  levelHigh: z.number().finite().min(0).max(100).optional(),
}).strict().refine(value => Object.keys(value).length > 0, 'At least one threshold is required');

export const controlSchema = z.object({
  mode: z.enum(['auto', 'manual']).optional(),
  pump: z.boolean().optional(),
  aerator: z.boolean().optional(),
  feedNow: z.literal(true).optional(),
}).strict().refine(value => Object.keys(value).length > 0, 'At least one control field is required');

const timestampSchema = z.union([
  z.number().int().nonnegative().safe(),
  z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().nonnegative().safe()),
]);

export const timeRangeSchema = z.object({
  from: timestampSchema,
  to: timestampSchema,
}).refine(v => v.from <= v.to, 'from must not exceed to')
  .refine(v => v.to - v.from <= 31 * 24 * 60 * 60 * 1000, 'Maximum range is 31 days');

export const tokenSchema = z.object({
  token: z.string().min(1).max(255).regex(/^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/),
}).strict();
