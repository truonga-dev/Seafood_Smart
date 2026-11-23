# Seafood Smart — Hệ thống giám sát & điều khiển ao nuôi thông minh

Hệ thống IoT + Backend API + Ứng dụng di động giám sát thông số môi trường ao nuôi theo thời gian thực (Nhiệt độ, pH, Oxy hòa tan DO, Độ đục, Mực nước), điều khiển thiết bị từ xa (Bơm, Oxy, Cho ăn) và gửi cảnh báo đẩy (Push Notifications).

## Cấu trúc dự án

```text
Seafood_Smart_app/
├── .github/
│   └── workflows/
│       └── ci.yml          # GitHub Actions CI/CD (typecheck, test, build, Docker)
├── backend/                # Node.js + Express + TypeScript + Firebase Admin SDK + Push Worker
├── mobile/                 # React Native + Expo SDK 58 + TypeScript + Firebase Auth
├── firmware/               # Mã nguồn ESP32 (chạy mô phỏng trên Wokwi)
└── docs/                   # Tài liệu kiến trúc & kế hoạch phát triển
```

## Công nghệ sử dụng

- **Firmware (`firmware/`)**: ESP32 (Arduino / Wokwi), cảm biến DS18B20, HC-SR04, biến trở mô phỏng pH / DO / Độ đục, giao tiếp Firebase Realtime Database.
- **Backend (`backend/`)**: Node.js 24+, TypeScript, Express, Zod, Firebase Admin SDK, Swagger UI (`/api/docs`), Expo Push Worker, Dockerfile.
- **Mobile (`mobile/`)**: Expo SDK 58, React Native, TypeScript, Firebase Auth, `expo-notifications` (FCM V1 qua EAS).

## Hướng dẫn chạy cục bộ

### 1. Cấu hình biến môi trường
- **Backend**: Sao chép `backend/.env.example` thành `backend/.env`, điền `FIREBASE_DATABASE_URL` và đường dẫn `GOOGLE_APPLICATION_CREDENTIALS` trỏ tới file service account cục bộ (không commit lên Git).
- **Mobile**: Sao chép `mobile/.env.example` thành `mobile/.env`, điền `EXPO_PUBLIC_API_BASE_URL` (IP LAN máy chạy backend), cấu hình Firebase Web và `EXPO_PUBLIC_EAS_PROJECT_ID`.

### 2. Cài đặt & kiểm tra
```bash
# Backend
cd backend
npm ci
npm run check
npm test

# Mobile
cd ../mobile
npm ci
npm run check
npm test
```

### 3. Khởi chạy dịch vụ
- **Backend API (cổng 3000)**: `cd backend && npm run dev`
- **Push Worker (gửi thông báo đẩy)**: `cd backend && npm run build && npm run worker`
- **Mobile (Expo Dev Client)**: `cd mobile && npx expo start --dev-client`
- **Máy ảo Android cục bộ**: `cd mobile && powershell -ExecutionPolicy Bypass -File .\android-emulator.ps1`

## CI/CD

Workflow [.github/workflows/ci.yml](.github/workflows/ci.yml) tự động chạy trên mỗi lần `push` và `pull_request` vào nhánh `main`:
1. **Backend CI**: cài phụ thuộc (`npm ci`), kiểm tra kiểu TypeScript (`npm run check`), biên dịch và chạy toàn bộ test (`npm test`).
2. **Mobile CI**: cài phụ thuộc (`npm ci`), kiểm tra kiểu TypeScript (`npm run check`), chạy unit test (`npm test`).
3. **Backend Docker Build**: kiểm tra đóng gói container từ `backend/Dockerfile`.

## Tài liệu chi tiết
- [Tài liệu phát triển](docs/DEVELOPMENT.md)
- [Kế hoạch giao diện & kiểm thử](docs/KE_HOACH_GIAO_DIEN.md)
- [Hướng dẫn Backend](backend/README.md)
- [Hướng dẫn Mobile & Push Notifications](mobile/README.md)
