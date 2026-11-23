import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

const apiKey = process.env.EXPO_PUBLIC_FIREBASE_API_KEY;
const projectId = process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID;
const appId = process.env.EXPO_PUBLIC_FIREBASE_APP_ID;
export const hasFirebaseConfig = !!(apiKey && projectId && appId);
const app = initializeApp({ apiKey: apiKey || 'missing', projectId: projectId || 'missing', appId: appId || 'missing', authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN });
export const auth = getAuth(app);
