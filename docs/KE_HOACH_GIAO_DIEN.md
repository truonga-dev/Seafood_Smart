# Kế hoạch xây dựng và kiểm thử ứng dụng Seafood Smart

## Mục tiêu và phạm vi

Xây dựng ứng dụng Expo cho chủ ao và người xem, dựa trên các màn hình đã thiết kế. Bản đầu tiên ưu tiên Android để thử với Wokwi, backend và Firebase hiện có. Expo SDK 58 là phiên bản mục tiêu theo yêu cầu; trước khi khởi tạo phải kiểm tra phiên bản đã phát hành, Node và các thư viện tương thích. Không nhầm Expo SDK với JDK; xác định JDK theo yêu cầu Android của bộ công cụ được chọn.

Thư mục `mobile` hiện có bản xem thử Expo với dữ liệu mẫu và năm tab; hướng dẫn chạy tại `mobile/README.md`. Chưa tích hợp đăng nhập, dữ liệu thật, điều khiển thật hoặc push. API hiện tại nằm trong `backend`, tài liệu chi tiết tại `/api/docs` khi chạy backend.

## Thứ tự thực hiện

1. Khởi tạo Expo, TypeScript và Expo Router; thiết lập theme, màu, kiểu chữ, icon, cấu trúc routes và kiểm tra Android. Dùng biến `EXPO_PUBLIC_*` cho thông tin cấu hình công khai, không đưa service account hoặc mật khẩu thiết bị vào ứng dụng.
2. Tạo đăng nhập Firebase Auth và quản lý phiên, lấy ID token để gọi backend; hiển thị lỗi đăng nhập rõ ràng và hỗ trợ đăng xuất. Lấy danh sách ao từ `GET /api/v1/ponds` và chọn ao được cấp quyền.
3. Tạo trang tổng quan gồm tên ao, trạng thái kết nối, thời gian cập nhật, nhiệt độ, pH, oxy hòa tan, độ đục, mực nước, bơm, quạt và cảnh báo. Kiểm tra trường thực tế của firmware trước khi ánh xạ; dữ liệu thiếu hiển thị `--`, không dùng dữ liệu giả như số đo thật.
4. Tạo lịch sử và biểu đồ theo chỉ số, các khoảng thời gian, trạng thái rỗng và lỗi; gọi history bằng epoch milliseconds, nhận aggregation UTC và thể hiện múi giờ hiển thị rõ ràng.
5. Tạo màn hình điều khiển và ngưỡng. Chỉ owner được thao tác; viewer chỉ xem. Bơm/quạt yêu cầu chế độ manual; cho ăn không gửi lại khi có lệnh chờ. Phân biệt lệnh đã lưu với thiết bị đã thực thi: đối chiếu `latest` và thông báo khi chưa xác nhận, không khẳng định chắc chắn chỉ từ phản hồi PATCH. Kiểm tra ngưỡng cặp min/max và hysteresis.
6. Tạo trang cảnh báo, thông tin thiết bị, cài đặt tài khoản và giao diện tải, lỗi, offline, dữ liệu cũ. Không suy luận thiết bị offline chỉ vì điện thoại mất mạng hoặc thời gian chưa đáng tin cậy.
7. Tích hợp thông báo đẩy sau khi app, worker và development build sẵn sàng. Đăng ký token sau khi được cấp quyền và xóa token khi đăng xuất phù hợp với thiết kế. Kiểm thử trên thiết bị thật với FCM/APNs; không coi Expo Go là bằng chứng push hoạt động.

## Dữ liệu và kết nối

| Chức năng | Nguồn / API |
| --- | --- |
| Đăng nhập | Firebase Authentication |
| Danh sách ao | `GET /api/v1/ponds` |
| Tổng quan | `GET /api/v1/ponds/{pondId}/latest`, `info`, `thresholds`; polling có kiểm soát trong bản đầu |
| Biểu đồ | `GET /api/v1/ponds/{pondId}/history?from=...&to=...&interval=raw|hour|day` |
| Cảnh báo | `GET /api/v1/ponds/{pondId}/alerts?from=...&to=...` |
| Điều khiển | `PATCH /api/v1/ponds/{pondId}/control` |
| Ngưỡng | `PATCH /api/v1/ponds/{pondId}/thresholds` |
| Push | `POST /api/v1/push-tokens`, `DELETE /api/v1/push-tokens/{tokenId}` |

Backend đang chạy trên máy tính: điện thoại thật không thể dùng `localhost` để truy cập backend trên máy tính. Cấu hình địa chỉ mạng LAN của máy tính và cổng backend; kiểm tra cả hai thiết bị cùng mạng và tường lửa. Android emulator thường cần địa chỉ host phù hợp với emulator. Với triển khai ngoài LAN cần HTTPS và xác thực đầy đủ.

## Kiểm thử để bàn giao

- Đăng nhập owner, chọn `pond01`, so sánh từng số đo và thời gian cập nhật với Firebase/Wokwi; thay đổi biến trở để thấy số liệu thay đổi.
- Kiểm tra màn hình tải, không có dữ liệu, token hết hạn, mất mạng điện thoại, Wokwi ngừng chạy và số đo đã cũ.
- Kiểm tra viewer không thấy hoặc không thể dùng thao tác ghi, đồng thời xác nhận API vẫn từ chối ghi.
- Thử manual, bơm/quạt và cho ăn trong Wokwi, đối chiếu `control` với `latest`; kiểm tra DO thấp, bơm chống tràn và lệnh chờ.
- Kiểm tra ngưỡng không hợp lệ, lưu ngưỡng hợp lệ, thời gian firmware đọc lại và biểu đồ lịch sử có dữ liệu/rỗng.
- Dùng development build và thiết bị thật kiểm thử thông báo, quyền và receipt sau khi có cấu hình push.

## Điều kiện trước khi dùng thật

Rules Firebase hiện vẫn mở công khai và firmware demo dùng TLS không kiểm tra chứng chỉ. Chưa đưa hệ thống vào vận hành thật cho đến khi kiểm thử firmware Auth với tài khoản thiết bị, chứng chỉ TLS, token hết hạn, kết nối lại và Rules hạn chế trên môi trường thử riêng. Lệnh cho ăn dạng boolean hiện chưa có định danh duy nhất qua lần khởi động lại; chưa khẳng định cơ chế thực thi đúng một lần. Push worker chỉ nên chạy một instance mỗi ao và cần kiểm thử trên thiết bị thật.
