import { database } from './firebase.js';
import { applicationDefault, deleteApp, getApp } from 'firebase-admin/app';

async function main() {
  console.log('Checking Firebase Application Default Credentials...');
  await applicationDefault().getAccessToken();
  console.log('Credentials are available.');
  console.log('Checking /ponds/pond01/info...');
  const snapshot = await database.ref('ponds/pond01/info').get();
  if (!snapshot.exists()) {
    console.log('Connected to Firebase; /ponds/pond01/info does not exist yet.');
  } else {
    console.log('Connected to Firebase; /ponds/pond01/info is available.');
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('Firebase check failed:', message);
  console.error('Check GOOGLE_APPLICATION_CREDENTIALS, service account permissions, database URL and network access.');
  process.exitCode = 1;
}).finally(async () => {
  database.goOffline();
  await deleteApp(getApp());
});
