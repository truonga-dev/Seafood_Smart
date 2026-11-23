# Seafood Smart Mobile

Ứng dụng Expo SDK 58 đăng nhập Firebase email/mật khẩu và gọi backend bằng Firebase ID token. Các thông số mới nhất được tải mỗi 5 giây; lịch sử, cảnh báo, ngưỡng và lệnh dùng API. Lệnh chỉ được xác nhận đã lưu, không khẳng định ESP32 đã thực thi. Tài khoản viewer chỉ xem. Mã đăng ký thông báo đẩy đã được bổ sung nhưng cần thiết lập EAS/FCM và kiểm thử trên điện thoại trước khi xác nhận hoạt động.

## Cấu hình

File `.env` cục bộ đã được cấu hình Firebase Web của dự án và địa chỉ Wi-Fi của máy tính tại thời điểm cài đặt. Không gửi file service account hoặc mật khẩu vào app. Nếu địa chỉ mạng thay đổi, chạy `ipconfig` và sửa `EXPO_PUBLIC_API_BASE_URL` trong `.env`, ví dụ `http://192.168.1.4:3000/api/v1`. Điện thoại và máy tính phải cùng mạng, backend phải lắng nghe cổng 3000 và firewall phải cho phép kết nối.

Nếu cài lại, sao chép `.env.example` thành `.env`, nhập Firebase Web API key, project ID, app ID và auth domain từ Firebase Console > Project settings > General > Your apps. Đây là cấu hình công khai, không phải service account. Đăng nhập bằng tài khoản Firebase Auth đã được cấp role trong `pondMembers`.

HTTP trên LAN chỉ dùng trong môi trường demo đáng tin cậy; ID token không được bảo vệ khỏi bên nghe lén. Dùng HTTPS trước khi sử dụng ngoài môi trường thử nghiệm. Rules RTDB hiện vẫn mở công khai và chưa an toàn cho triển khai thật.

## Chạy

Mở terminal thứ nhất tại thư mục `backend` và chạy `npm run dev`. Mở terminal thứ hai tại `mobile` và chạy `npx expo start --clear`; quét QR bằng Expo Go. Cần giải phóng ổ C nếu công cụ không chạy vì hết dung lượng. Nếu thử web, thêm origin web chính xác vào `CORS_ORIGINS` trong `backend/.env`, rồi khởi động lại backend.

## Kiểm tra

Chạy `npm run check` và `npm test`. Biên dịch Metro không chứng minh đồng bộ thiết bị: cần đăng nhập tài khoản thật trên điện thoại và đối chiếu Wokwi với Firebase. Kiểm tra viewer, chế độ manual, DO thấp, lệnh cho ăn, đổi ngưỡng và tình huống mất mạng. Npm audit ghi nhận các cảnh báo phụ thuộc Expo/Firebase; không tự hạ phiên bản bằng `npm audit fix --force`.

## Thiết lập và thử thông báo Android

1. Đăng nhập tài khoản Expo bằng `npx eas-cli@latest login`, sau đó liên kết hoặc tạo EAS project bằng `npx eas-cli@latest init`. Xác nhận `extra.eas.projectId` trong `app.json`; đây là UUID của EAS, khác Firebase project ID. Có thể đặt `EXPO_PUBLIC_EAS_PROJECT_ID` nếu cần.
2. Firebase Android app `com.seafoodsmart.app` đã được đăng ký; `google-services.json` và `expo.android.googleServicesFile` đã được cấu hình cục bộ. Tiếp tục thiết lập thông tin FCM V1 cho EAS theo hướng dẫn Expo. Không đưa khóa riêng service account vào app hoặc repository. Xác định package phù hợp với dự án trước khi phát hành.
3. Tạo development build: `npx eas-cli@latest build --platform android --profile development`, rồi cài APK lên điện thoại thật hoặc Android Emulator có Google Play services. Expo Go trên Android không nhận remote push. Máy ảo `SeafoodSmart_API35` được chuẩn bị tại `.android-sdk` và `.android-user` ở thư mục dự án. Để mở giao diện máy ảo từ thư mục `mobile`, chạy `powershell -ExecutionPolicy Bypass -File .\android-emulator.ps1`. Chỉ chạy một bản máy ảo cùng lúc.
4. Chạy backend và một worker cho ao: trong `backend`, `npm run build` rồi `npm run worker`. Đảm bảo `PUSH_PONDS=pond01`, chỉ chạy một worker cho mỗi ao.
5. Mở development build, đăng nhập tài khoản được cấp quyền, vào **Cài đặt → Bật thông báo** và cấp quyền. Khi đăng xuất, app yêu cầu kết nối backend để xóa đăng ký thiết bị.
6. Sau khi đăng ký và worker đang chạy, thay đổi cảm biến trong Wokwi để phát sinh cảnh báo mới. Kiểm tra thông báo trên điện thoại, log worker, ticket và receipt; cảnh báo cũ không được gửi lại khi mới đăng ký. Có thể mất khoảng 15 phút để worker kiểm tra receipt.

Thông báo có thể bị trì hoãn hoặc gửi trùng nếu tiến trình dừng giữa lúc Expo nhận yêu cầu và lưu trạng thái. Không chia sẻ token thiết bị hay khóa riêng trong báo cáo lỗi. [Expo: thiết lập push](https://docs.expo.dev/push-notifications/push-notifications-setup/) · [Expo: FCM credentials](https://docs.expo.dev/push-notifications/fcm-credentials/)

## Thiết lập và thử thông báo iPhone

1. Dự án hiện đã được liên kết với `@truong102005vn/seafood-smart`; `extra.eas.projectId` đã nằm trong `app.json`. Trên máy khác, đăng nhập bằng `npx eas-cli@latest login` với tài khoản có quyền vào dự án đó.
2. Cần tài khoản Apple Developer Program đang hoạt động, có quyền tạo signing credentials và APNs key. Chọn một `expo.ios.bundleIdentifier` duy nhất thuộc Apple Developer team của bạn trong `app.json`.
3. Đăng ký iPhone thử nghiệm bằng `npx eas-cli@latest device:create`. Chạy `npx eas-cli@latest build --platform ios --profile development`, đăng nhập Apple khi EAS yêu cầu và bật cấu hình Push Notifications/APNs. EAS sẽ hướng dẫn signing và provisioning.
4. Cài development build lên iPhone; chạy backend và worker như hướng dẫn Android, đăng nhập app, mở **Cài đặt → Bật thông báo**, cấp quyền và tạo cảnh báo mới từ Wokwi. Kiểm tra trên điện thoại thật và log worker.

Không đưa Apple ID, mật khẩu, APNs key hay service account vào mã nguồn hoặc cuộc trò chuyện. [Expo: cấu hình push iOS](https://docs.expo.dev/push-notifications/push-notifications-setup/)
