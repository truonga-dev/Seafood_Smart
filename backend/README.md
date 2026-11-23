# Seafood Smart Backend

API Node.js + TypeScript cho Firebase Realtime Database. Mã ESP32 và dữ liệu `/ponds/{pondId}` giữ nguyên hợp đồng hiện tại.

## Cài đặt

Yêu cầu Node.js 24.12 trở lên theo các phiên bản Firebase trong package-lock, dự án Firebase có Authentication và Realtime Database, cùng Application Default Credentials có quyền truy cập dự án.

```powershell
cd backend
npm ci
Copy-Item .env.example .env
```

Chỉnh `.env`. Tạo service account trong Firebase/Google Cloud và lưu JSON ở vị trí riêng trên máy. Đặt `GOOGLE_APPLICATION_CREDENTIALS` thành đường dẫn tuyệt đối tới file JSON đó. Không đưa nội dung khóa vào repo hoặc app. Trên Google Cloud có thể dùng service account gắn với môi trường chạy.

```powershell
npm run dev
```

Sau khi chạy, mở `http://localhost:3000/` để xem đường dẫn health và tài liệu API. Mở `http://localhost:3000/health` hoặc `http://localhost:3000/api/docs`. Đối với bản build, chạy `npm run build` rồi `npm start`. Trang gốc, health và tài liệu API là công khai. Cấu hình `CORS_ORIGINS` với danh sách origin web cần cho phép, phân cách bằng dấu phẩy. App native không cần CORS.

Sau khi cấu hình service account, kiểm tra thông tin đăng nhập và quyền đọc ao bằng `npm run check:firebase`. Lệnh này đọc `/ponds/pond01/info` và không thay đổi dữ liệu.

## Xác thực và quyền

API yêu cầu Firebase Authentication ID token hợp lệ qua header `Authorization: Bearer <ID_TOKEN>`. Tạo tài khoản trong Firebase Authentication, sau đó gán quyền cho UID trong RTDB bằng công cụ quản trị được cấp quyền:

```json
{
  "pondMembers": {
    "pond01": {
      "<FIREBASE_AUTH_UID>": { "role": "owner" },
      "<VIEWER_UID>": { "role": "viewer" }
    }
  }
}
```

Đây là cấu trúc đề xuất bổ sung, không thay đổi firmware. Backend kiểm tra membership trên mỗi yêu cầu; chỉ `owner` được gửi lệnh và sửa ngưỡng. Các API không tự tạo tài khoản hoặc cấp quyền cho chính người gọi.

## Dữ liệu và lệnh

- `GET /api/v1/ponds`, `/ponds/{pondId}/info`, `/latest` và `/thresholds` đọc dữ liệu thật.
- `GET /ponds/{pondId}/history?from=...&to=...&interval=raw|hour|day` nhận epoch milliseconds. Trung bình theo giờ/ngày chia theo UTC, bỏ qua trường số thiếu. Tối đa 31 ngày và 150.000 bản ghi mỗi yêu cầu.
- `GET /ponds/{pondId}/alerts?from=...&to=...&type=...` lọc theo thời gian và loại cảnh báo.
- `PATCH /ponds/{pondId}/thresholds` kiểm tra ngưỡng mới và cập nhật bằng transaction. Nhánh thresholds phải được firmware khởi tạo trước.
- `PATCH /ponds/{pondId}/control` chỉ ghi lệnh. ESP32 xác nhận thực thi thông qua `latest`. Lệnh bật/tắt bơm hoặc quạt yêu cầu mode manual. `feedNow` chỉ chấp nhận `true` và từ chối nếu đã có lệnh đang chờ.
- `POST /api/v1/push-tokens` với `{ "token": "ExpoPushToken[...]" }` đăng ký token cho user. `DELETE /api/v1/push-tokens/{tokenId}` xóa token của user.

Khi app đăng ký lại cùng token, backend giữ thời điểm `registeredAt` ban đầu và cập nhật `updatedAt`. Điều này giúp worker không bỏ qua cảnh báo đang chờ do token được đăng ký lại. Token cũ chỉ có `updatedAt` vẫn được hỗ trợ.

Đường dẫn rút gọn ở trên dùng tiền tố `/api/v1`. Truy vấn `history` và `alerts` dùng `orderByChild("ts")`; thêm `.indexOn: ["ts"]` ở đúng nhánh sau khi kiểm thử Rules với firmware. Rules ở cấp gốc hiện đang mở theo ảnh nhóm cung cấp, vì vậy việc kiểm tra quyền trong API chưa ngăn truy cập trực tiếp vào Firebase. Cần thiết kế lại Rules và xác thực ESP32 trước khi đóng quyền công khai.

### Rules bảo mật dự thảo

`firebase.rules.draft.json` là bản dự thảo chỉ chạy trên emulator. Bản này yêu cầu người đọc là owner/viewer của ao hoặc thiết bị đã được cấp quyền tại `/pondDevices/{pondId}/{deviceUid} = true`. Thiết bị có thể ghi các nhánh firmware cần sử dụng. Ứng dụng chỉ đọc trực tiếp; thao tác ghi của người dùng đi qua API dùng Admin SDK. Token push, membership, thiết bị và trạng thái worker do Admin SDK quản lý.

Chạy `npm run test:rules` với Firebase CLI và Java đã cài để khởi động Database Emulator và kiểm thử rules trên project demo. **Không áp dụng rules dự thảo lên database hiện tại** cho đến khi ESP32 có Firebase Auth hợp lệ, nhận và làm mới ID token, có UID thiết bị được cấp quyền, và đã kiểm tra Wokwi. Firmware hiện ghi ẩn danh với `DATABASE_SECRET` rỗng nên sẽ bị từ chối nếu bật rules này ngay. ID token có thời hạn, không thể chỉ dán một token cố định rồi xem như đã hoàn tất xác thực thiết bị.

Firmware cục bộ có chế độ Auth tùy chọn, mặc định tắt để duy trì demo hiện tại. Để chuẩn bị thử ở môi trường riêng, tạo một tài khoản Firebase Auth dành riêng cho thiết bị và cấp `/pondDevices/pond01/{deviceUid} = true` qua Admin SDK. Sao chép `firmware/auth_config.example.h` thành `auth_config.local.h`, bật `FIREBASE_AUTH_ENABLED`, rồi cấu hình web API key, email, mật khẩu và PEM trust bundle tương ứng với các endpoint Firebase Auth, Secure Token và Realtime Database. Thời gian phải được đồng bộ qua NTP để xác thực chứng chỉ TLS. Auth sẽ từ chối gửi thông tin đăng nhập nếu thiếu cấu hình hoặc thời gian chưa đồng bộ.

Không đưa mật khẩu thiết bị, refresh token, file cấu hình riêng hoặc service account vào repo hay dự án Wokwi công khai. Khi Auth được bật, firmware dùng tài khoản thiết bị để lấy ID token và tự làm mới; Rules chỉ được triển khai sau khi xác nhận đầy đủ đăng nhập, đọc/ghi, hết hạn token, kết nối lại và hành vi offline. Cần kiểm thử ở môi trường riêng có Rules dự thảo trước khi tác động database đang chạy. Chế độ demo hiện vẫn dùng `setInsecure()` và Rules đang mở, chỉ dùng cho mô phỏng.

## Worker thông báo đẩy

Đặt `PUSH_PONDS=pond01` trong `.env`, chạy `npm run build`, sau đó chạy `npm run worker` trong một tiến trình riêng. Khi phát triển có thể chạy `npm run worker:dev`. Worker phải duy trì hoạt động cùng mạng và service account với API. Chỉ chạy **một worker cho mỗi ao** vì phiên bản MVP chưa có khóa phân tán. Để thông báo tiếp tục hoạt động khi API ngủ, triển khai worker như một dịch vụ riêng luôn chạy.

Lần đầu chạy với một ao, worker lưu mốc thời gian hiện tại và xử lý cảnh báo phát sinh sau mốc đó. Những lần khởi động tiếp theo tiếp tục từ `/pushWorkerCursors/{pondId}`. Worker kiểm tra vai trò owner/viewer, đăng ký token, gửi Expo Push, lưu tiến độ theo cảnh báo và token, sau đó kiểm tra receipt khoảng 15 phút sau. Token bị Expo báo `DeviceNotRegistered` được xóa nếu chưa bị người dùng đăng ký lại. Firebase Rules cần chỉ mục `ts` cho alerts và `checkAfter` cho `/pushReceipts`.

Tiến trình lưu trạng thái tại `pushWorkerCursors`, `notificationDeliveries` và `pushReceipts`. Khi gửi bị lỗi, worker giữ nguyên cursor để thử lại. Nếu tiến trình dừng sau khi Expo nhận yêu cầu nhưng trước khi lưu ticket, một thông báo có thể được gửi lại. Các lỗi receipt khác `DeviceNotRegistered` được ghi log và cần kiểm tra, chưa tự gửi lại. Chưa có cơ chế tự xóa lịch sử delivery. Kiểm tra đồng hồ máy chủ của worker để mốc ban đầu đúng.

Phần app phải đăng ký Expo push token và cấp quyền thông báo. Kiểm thử push trên development build với thiết bị thật và cấu hình FCM/APNs theo Expo. Các API đọc, quyền viewer và giao dịch điều khiển/ngưỡng đã được thử với Firebase thật; giao dịch ghi được thử trên ao tạm. Kiểm thử điều khiển end-to-end với Wokwi và push trên thiết bị thật vẫn cần hoàn thành.

## Kiểm tra

```powershell
npm run check
npm run build
npm test
```

`npm test` biên dịch và chạy kiểm thử đầu vào cùng các tình huống HTTP cơ bản qua loopback cục bộ, không ghi dữ liệu Firebase. Các bài HTTP cần quyền truy cập `127.0.0.1` trong môi trường chạy kiểm thử.

Với backend đang chạy và tài khoản đã được cấp quyền, dùng Swagger UI `/api/docs` nhập Firebase ID token để thử API. Kiểm thử cả owner và viewer, lệnh manual, chống tràn, dữ liệu rỗng và lịch sử 7 ngày theo kịch bản trong `docs/DEVELOPMENT.md`.

## Đóng gói container

Chạy các lệnh từ thư mục `backend`:

```powershell
docker build -t seafood-smart-backend .
```

Image mặc định chạy API và nhận `PORT`, `FIREBASE_DATABASE_URL`, `GOOGLE_CLOUD_PROJECT` cùng Application Default Credentials từ môi trường triển khai. Không đưa file service account vào image. `.dockerignore` chỉ cho phép source và các file cần để build.

Để chạy worker bằng cùng image, cấu hình service riêng với lệnh `node dist/push-worker.js` và biến `PUSH_PONDS`. Chỉ chạy một instance worker cho mỗi ao. Chọn dịch vụ có CPU hoạt động liên tục, vì worker cần xử lý cảnh báo cả khi không có HTTP request. Với Cloud Run, tham khảo worker pool và kiểm tra chi phí trước khi triển khai. API có thể dùng Cloud Run service thông thường và lắng nghe `PORT` do nền tảng cấp. [Cloud Run container contract](https://docs.cloud.google.com/run/docs/container-contract) · [Cloud Run billing settings](https://docs.cloud.google.com/run/docs/configuring/billing-settings)
