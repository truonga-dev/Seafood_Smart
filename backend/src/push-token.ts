export type StoredPushToken = {
  expoPushToken: string;
  registeredAt: number;
  updatedAt: number;
};

export function registerPushToken(current: unknown, token: string, now: number): StoredPushToken {
  const previous = current && typeof current === 'object'
    ? current as { expoPushToken?: unknown; registeredAt?: unknown; updatedAt?: unknown }
    : undefined;
  let registeredAt = now;
  if (previous?.expoPushToken === token) {
    if (typeof previous.registeredAt === 'number' && Number.isFinite(previous.registeredAt)) {
      registeredAt = previous.registeredAt;
    } else if (typeof previous.updatedAt === 'number' && Number.isFinite(previous.updatedAt)) {
      registeredAt = previous.updatedAt;
    }
  }
  return { expoPushToken: token, registeredAt, updatedAt: now };
}

export function wasRegisteredWhenAlertOccurred(registeredAt: number, alertTimestamp: number): boolean {
  return registeredAt <= alertTimestamp;
}
