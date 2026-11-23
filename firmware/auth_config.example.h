#pragma once

// Copy to auth_config.local.h only in a private development environment.
// Do not publish credentials in a public Wokwi project or commit the file.
#define FIREBASE_AUTH_ENABLED 1
#define FIREBASE_WEB_API_KEY ""
#define FIREBASE_DEVICE_EMAIL ""
#define FIREBASE_DEVICE_PASSWORD ""

// Supply a PEM trust bundle appropriate for all three HTTPS endpoints:
// Firebase Authentication, Secure Token and your Realtime Database.
// Authenticated mode refuses to send credentials when this is empty.
#define FIREBASE_TLS_ROOT_CA ""
