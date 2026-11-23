import { initializeApp } from 'firebase/app';
import { initializeAuth, getReactNativePersistence } from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';

const apiKey = process.env.EXPO_PUBLIC_FIREBASE_API_KEY;
const projectId = process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID;
const appId = process.env.EXPO_PUBLIC_FIREBASE_APP_ID;
export const hasFirebaseConfig = !!(apiKey && projectId && appId);
const app = initializeApp({ apiKey: apiKey || 'missing', projectId: projectId || 'missing', appId: appId || 'missing', authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN });
export const auth = initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) });
