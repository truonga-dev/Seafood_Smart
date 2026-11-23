import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { User } from 'firebase/auth';
import { api } from './api';

const KEY = 'seafood-smart:push-registration';
type Registration = { uid: string; tokenIds: string[] };

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

export async function enableNotifications(user: User): Promise<void> {
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
    throw new Error('Expo Go không hỗ trợ thử thông báo đẩy của dự án này. Hãy cài development build.');
  }
  const projectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID || Constants.expoConfig?.extra?.eas?.projectId || Constants.easConfig?.projectId;
  if (!projectId) throw new Error('Chưa cấu hình EAS project ID; xem hướng dẫn trong mobile/README.md.');
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('alerts', { name: 'Cảnh báo ao nuôi', importance: Notifications.AndroidImportance.HIGH });
  }
  const permission = await Notifications.getPermissionsAsync();
  const status = permission.granted ? permission : await Notifications.requestPermissionsAsync();
  if (!status.granted) throw new Error('Quyền thông báo chưa được cấp. Hãy bật trong cài đặt điện thoại.');
  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  const previous = await readRegistration();
  if (previous && previous.uid !== user.uid) {
    throw new Error('Thiết bị còn đăng ký với tài khoản khác. Hãy đăng nhập lại tài khoản đó và đăng xuất khi có mạng.');
  }
  const result = await api<{ tokenId: string }>(user, '/push-tokens', { method: 'POST', body: { token } });
  // Persist both IDs before removing an old one so a failed removal can be retried at logout.
  const tokenIds = [...new Set([...(previous?.tokenIds || []), result.tokenId])];
  await AsyncStorage.setItem(KEY, JSON.stringify({ uid: user.uid, tokenIds }));
  for (const oldId of tokenIds.filter(id => id !== result.tokenId)) {
    await api(user, `/push-tokens/${oldId}`, { method: 'DELETE' });
  }
  await AsyncStorage.setItem(KEY, JSON.stringify({ uid: user.uid, tokenIds: [result.tokenId] }));
}

async function readRegistration(): Promise<Registration | null> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    const ids = Array.isArray(value.tokenIds) ? value.tokenIds : [value.tokenId];
    if (typeof value.uid === 'string' && ids.length && ids.every((id: unknown) => typeof id === 'string' && /^[a-f0-9]{64}$/.test(id))) return { uid: value.uid, tokenIds: ids };
  } catch { /* treat invalid local state as missing */ }
  return null;
}

export async function removeNotificationRegistration(user: User): Promise<void> {
  const previous = await readRegistration();
  if (!previous || previous.uid !== user.uid) return;
  for (const id of previous.tokenIds) await api(user, `/push-tokens/${id}`, { method: 'DELETE' });
  await AsyncStorage.removeItem(KEY);
}
