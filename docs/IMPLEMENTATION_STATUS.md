# SmartHospital — các phần đã triển khai ngày 02/11/2026

Phạm vi: sửa các lỗi trong review 01/11 và bổ sung luồng khám ngoại trú phục vụ thử nghiệm phòng khám. Mỗi nhóm dưới đây được commit và push riêng lên `origin/main`. Không chạy migration hay thao tác trên database thật.

## Đối chiếu review

| Mục | Thay đổi đã thực hiện |
|---|---|
| R01 phân quyền | Guard đọc quyền class/method; kiểm thử HTTP cho bệnh nhân/bác sĩ/admin; thêm lễ tân và thu ngân với quyền nghiệp vụ riêng |
| R02 hash mật khẩu | Cột mật khẩu/token version không select mặc định; DTO bác sĩ công khai chỉ trả trường cho phép; luồng login chọn thông tin xác thực tường minh |
| R03 webhook | Kiểm tra chữ ký/số tiền; transaction và khóa theo bác sĩ; xử lý lặp không đưa lịch hoàn tất/hủy về confirmed; cọc đến muộn vào đối soát; giữ trạng thái đã xử lý khi webhook lặp |
| R04 phiên và tài khoản | Token version, khóa mọi vai trò, thu hồi token khi đổi/reset mật khẩu/khóa/logout; production từ chối secret mặc định/yếu |
| R05 ca khám | Ca lặp có thời lượng, preview ảnh hưởng và phiên bản; ngoại lệ đóng/mở theo ngày; sinh cuốn chiếu 30 ngày, idempotent, bảo vệ lịch đặt và nghỉ đã duyệt |
| R06 mất dữ liệu khi xóa | Vô hiệu hóa thay hard delete, giữ hồ sơ/giao dịch; có mở lại và kiểm tra admin hoạt động cuối cùng |
| R07 hồ sơ trùng/dở dang | UNIQUE lịch hẹn, transaction khóa, kiểm tra đã tiếp đón, phiên bản chống ghi đè, revision và lý do; lỗi giữa chừng rollback |
| R08 phạm vi/chi phí AI | Gate môi trường và quản trị, đồng ý xử lý dữ liệu theo người dùng; giới hạn request chia sẻ DB, backfill theo bác sĩ/batch; kiểm tra UUID/quyền phiên trước gọi provider |
| R09 duyệt nghỉ tranh chấp | Khóa chung với đặt lịch, transaction, kiểm tra lịch đã đặt và trạng thái đơn; kiểm thử đặt lịch đồng thời với duyệt và duyệt/từ chối đồng thời |
| R10 thanh toán/khôi phục | Lưu checkout/expiry; retry cùng order, API khôi phục chính chủ; kết quả frontend đọc trạng thái server; đổi lịch giữ cọc; URL trả về bị giới hạn cùng origin |
| R11 migration | Baseline bất biến, migration version/checksum/transaction/advisory lock; preflight trùng dữ liệu không xóa; runner xử lý enum theo namespace; backup/restore có đích rõ ràng |

## Chức năng mới có backend và giao diện

- **Tiếp đón:** danh mục bệnh nhân riêng với tài khoản; liên kết người đại diện sau xác minh; đặt tại quầy/điện thoại, tiếp nhận lịch trực tuyến; check-in, hàng đợi, bắt đầu khám, vắng mặt, hủy và hoàn tất theo quyền.
- **Lịch làm việc:** sửa ca định kỳ, xem trước slot bị ảnh hưởng, xác nhận thay đổi, ngày ngoại lệ và sinh lịch tiếp nối; không âm thầm hủy lịch đã đặt.
- **Đổi lịch:** bệnh nhân đổi ca tương lai cùng bác sĩ; bảo toàn tiền cọc, lịch sử đổi và trạng thái tiếp đón; ca đã check-in/đang khám bị chặn.
- **Hồ sơ khám:** chỉ số khám, triệu chứng, chẩn đoán, điều trị, ghi chú, ngày tái khám; nháp/xác nhận, lý do chỉnh sửa, revision, kiểm tra version, in kết quả. Hồ sơ cấu trúc đã xác nhận phải sửa ở màn hình phòng khám để không tách hai bản dữ liệu khác nhau.
- **Thu ngân:** khoản thu còn lại, ghi nhận tiền thủ công với mã chống trùng, chứng từ có thể in; đề nghị hoàn → quản trị khác duyệt → xác nhận đã hoàn thực tế; chuyển khoản đã thu giữa ca cùng bệnh nhân có xác nhận và audit.
- **Cọc đến muộn/lịch hủy:** tiếp nhận vào ca tài chính không mở lại lịch, liên kết payment vào ledger một lần; hoàn/chuyển theo quy trình rồi xác nhận xử lý đối soát.
- **Vận hành:** danh sách lịch chưa tiếp nhận, ca chưa hoàn tất, nhắc lịch lỗi, giao dịch cần đối soát; nhận người xử lý, ghi chú/kết quả và nhật ký.
- **Tái khám/danh sách chờ:** ngày tái khám bác sĩ xác nhận, đề nghị khung giờ và ghi nhận đồng ý; người bệnh vẫn phải hoàn tất đặt lịch để giữ slot, không tự tạo lịch hay thu tiền.

## Tối ưu và vận hành

- Tìm bác sĩ phân trang/lọc trên server; kiểm tra khả dụng bằng truy vấn gộp, bỏ gọi slot cho từng bác sĩ. Sidebar chat chỉ lấy tin nhắn cuối mỗi phiên.
- Dashboard/clinic/tìm kiếm/hồ sơ bác sĩ/đặt lịch tải theo nhu cầu. Bundle JS chính: **443,08 kB**, gzip **132,81 kB**, so với baseline review 707,05 kB/gzip 185,27 kB. Đây là kích thước build, không phải độ trễ đo trên thiết bị của phòng khám.
- Gỡ điểm đánh giá/tỷ lệ hài lòng/liên hệ giả và các link hỗ trợ không hoạt động; cấu hình thông tin thật bằng biến frontend công khai. Có xuất lịch hẹn `.ics` sau xác nhận server.
- Loại SDK Gemini/Express/dotenv không dùng khỏi frontend và bỏ cấu hình nhúng key Gemini. Npm audit frontend sau cập nhật dependency tương thích: **0 vulnerabilities tại thời điểm kiểm tra**; không phải chứng nhận an toàn toàn hệ thống.
- Nhắc lịch có lease theo attempt, trạng thái xử lý/sent/failed/skipped và retry; cửa sổ tính theo giờ Việt Nam cả khi DB chạy UTC. Việc gửi có thể lặp nếu process chết sau khi provider đã nhận nhưng trước khi lưu sent; không hứa exactly-once với email.
- `/health/live`, `/health/ready` kiểm tra schema/migration và DB; validation runtime trước controller; `TRUST_PROXY_HOPS` cấu hình rõ ràng thay vì đọc header IP thủ công.
- CI chạy test script, unit, PostgreSQL integration, build backend; frontend TypeScript, test và build.

## Kiểm chứng đã thực hiện

| Loại | Bằng chứng |
|---|---|
| Backend unit | 123/123 tests, 12 suites |
| PostgreSQL | 76/76 tests, 10 suites; container tạm, schema ngẫu nhiên, explicit `TEST_DATABASE_URL`, không dùng `.env` |
| Khởi động/HTTP | `AppModule` thực, JWT đăng nhập đủ 5 vai trò, health, quyền và luồng tiếp đón → bác sĩ → thu ngân; chỉ provider ngoài bị thay bằng mock |
| Migration runner | 7/7 script tests; baseline/checksum, rollback, cạnh tranh lock, namespace và bảo toàn dữ liệu |
| Backup/restore | Diễn tập `pg_dump`/`pg_restore` trực tiếp trong container tạm: nguồn và đích riêng, sau restore khớp checksum migration, định danh user và nội dung hồ sơ giả. Không dùng dữ liệu thật; chưa chạy CLI PostgreSQL native trên Windows |
| Frontend | TypeScript, 2 test route/calendar và production build đạt |
| Browser | 128 assertions, 5 vai trò × desktop 1280px/mobile 320px; API fixture, không traffic backend/provider |

Chi tiết browser và cách tái chạy: [QA record](qa/clinic-browser-smoke-2026-11-02.md). CI backend/frontend cho commit giao diện `5df2b3c` đã đạt: [GitHub Actions](https://github.com/ITCrazy357/SmartHospital/actions/runs/41415449319). Kiểm tra các commit tiếp theo tại [Actions](https://github.com/ITCrazy357/SmartHospital/actions).

## Trước khi dùng tại cơ sở

1. Đọc [quy trình sử dụng](CLINIC_WORKFLOWS.md) và [runbook vận hành](OPERATIONS.md).
2. Backup DB hiện hữu; kiểm tra dữ liệu trùng mà migration có thể từ chối; chạy `npm run db:migrate` ở môi trường đích rồi kiểm tra readiness. Không dùng reset DB.
3. Thiết lập domain, CORS, JWT secret, thông tin phòng khám và số proxy đúng hạ tầng. Cấp tài khoản lễ tân/thu ngân từ admin.
4. Chốt chính sách cọc/hoàn/chuyển và trách nhiệm phê duyệt. Chứng từ trong ứng dụng là bản ghi thu/hoàn, không mặc định là hóa đơn thuế đã được cơ quan có thẩm quyền chấp nhận.
5. AI mặc định tắt; chỉ bật sau khi cơ sở duyệt phạm vi xử lý dữ liệu và người dùng đồng ý. Các luồng khám/ghi hồ sơ vẫn hoạt động khi AI tắt.
6. Nghiệm thu tại cơ sở, diễn tập restore/gián đoạn mạng và kiểm tra tích hợp provider ở môi trường được cơ sở cho phép. Phiên làm việc này không gọi PayOS/OpenAI/SMTP/Supabase thật, không chuyển tiền/gửi email, không triển khai production và không thay thế nghiệm thu chuyên môn/pháp lý.

Thay đổi cục bộ có trước trong `sh.server/src/ai/openai.service.ts` được giữ nguyên và không nằm trong các commit triển khai này.
