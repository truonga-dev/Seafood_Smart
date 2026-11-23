import type { User } from 'firebase/auth';

export type Pond = { pondId: string; role: 'owner' | 'viewer'; info: { name?: string; location?: string; firmware?: string } | null };
export type Latest = { temp?: number; ph?: number; do?: number; turbidity?: number; waterLevel?: number; mode?: string; pump?: boolean; aerator?: boolean; ts?: number; status?: string; alerts?: string[]; feedCount?: number; rssi?: number; uptime?: number };
export type Entry = { id: string; ts: number; message?: string; [key: string]: unknown };
export type Thresholds = { tempMin: number; tempMax: number; phMin: number; phMax: number; doOn: number; doOff: number; turbMax: number; levelLow: number; levelHigh: number };

const baseUrl = (process.env.EXPO_PUBLIC_API_BASE_URL || '').replace(/\/$/, '');
export const hasApiConfig = !!baseUrl;
export async function api<T>(user: User, path: string, options?: { method?: 'GET' | 'PATCH' | 'POST' | 'DELETE'; body?: unknown }): Promise<T> {
  if (!baseUrl) throw new Error('Thiếu EXPO_PUBLIC_API_BASE_URL trong mobile/.env');
  const token = await user.getIdToken();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: options?.method || 'GET',
      headers: { Authorization: `Bearer ${token}`, ...(options?.body ? { 'Content-Type': 'application/json' } : {}) },
      ...(options?.body ? { body: JSON.stringify(options.body) } : {}),
      signal: controller.signal,
    });
  } finally { clearTimeout(timeout); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : `Lỗi API (${response.status})`);
  return data as T;
}

export const pondPath = (pondId: string) => `/ponds/${encodeURIComponent(pondId)}`;
