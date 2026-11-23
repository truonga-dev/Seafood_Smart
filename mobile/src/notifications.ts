import type { User } from 'firebase/auth';
export async function enableNotifications(_user: User): Promise<void> { throw new Error('Thông báo đẩy hiện chỉ hỗ trợ trên ứng dụng điện thoại.'); }
export async function removeNotificationRegistration(_user: User): Promise<void> {}
