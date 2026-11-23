import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';

// Resolve configuration from the backend directory even when npm runs elsewhere.
config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });

const databaseURL = process.env.FIREBASE_DATABASE_URL;
if (!databaseURL) {
  throw new Error('FIREBASE_DATABASE_URL is required');
}

const app = initializeApp({
  credential: applicationDefault(),
  databaseURL,
  projectId: process.env.GOOGLE_CLOUD_PROJECT || undefined,
});

export const auth = getAuth(app);
export const database = getDatabase(app);
