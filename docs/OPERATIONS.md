# Vận hành và khôi phục SmartHospital

## Chuẩn bị

Dùng Node.js 22, PostgreSQL 16 có extension pgvector, và PostgreSQL client tools cùng hoặc mới hơn major version của server. Backend dùng `synchronize: false`: **triển khai migration trước khi mở phiên bản API mới**. Không dùng seed/reset để xử lý lỗi dữ liệu của phòng khám.

Copy `sh.server/.env.example` thành `.env`, cấu hình các biến POSTGRES_* cho đúng môi trường, JWT secret ngẫu nhiên riêng, CLIENT_APP_URL và Supabase Storage nếu sử dụng upload. Không commit `.env` hoặc bản backup. SSL khi bật phải có chuỗi chứng chỉ đáng tin cậy; không tắt xác minh chứng chỉ để làm cho lệnh chạy qua.

Các script database đọc `.env` cạnh `sh.server/package.json`, nhưng biến môi trường đã cấp từ bên ngoài được ưu tiên. Có thể dùng DATABASE_URL cho script; không in URL ra log hay đưa vào tham số dòng lệnh. Hãy cấu hình nhất quán với database mà ứng dụng sử dụng.

## Cài mới và nâng cấp

Trong `sh.server`:

```powershell
npm ci
npm run db:migrate
npm run build
npm run start:prod
```

`migrations/000_baseline.sql` là snapshot bất biến của schema gốc; các migration tiếp theo bổ sung ràng buộc và nghiệp vụ. Runner tạo bảng `schema_migrations`, kiểm tra SHA-256 của file đã áp dụng, khóa advisory để hai phiên deploy không chạy đồng thời, và áp dụng từng file SQL trong transaction. LF/CRLF không làm đổi checksum.

Với database cũ chưa có lịch sử migration, runner áp dụng baseline theo kiểu IF NOT EXISTS rồi thực hiện các bước nâng cấp. Chạy trên bản sao database cũ trước. Nếu schema cũ không nằm trong cấu trúc được hỗ trợ, runner phải dừng, không tự đoán cách chuyển dữ liệu. Không chỉnh file migration đã áp dụng; bổ sung file có số thứ tự cao hơn.

Migration `001_integrity.sql` **dừng khi có số điện thoại, slot bác sĩ hoặc hồ sơ theo lịch hẹn bị trùng**. Nó không tự xóa/merge dữ liệu. Kỹ thuật viên phải kiểm tra dữ liệu riêng tư trong công cụ quản trị, thống nhất cách sửa với người phụ trách nghiệp vụ, ghi lại thay đổi và chạy lại migration. Log CLI chỉ nêu tên migration/SQLSTATE, không xuất nội dung bệnh nhân.

Các lệnh migration cũ được giữ làm alias tới runner mới. `db:reset` chủ động từ chối chạy; các shortcut tham chiếu SQL không tồn tại đã được bỏ. `schema/smart-hospital-design.sql` là tài liệu tham khảo schema gốc, không phải lệnh cài đặt/nâng cấp. Luôn dùng runner.

Docker image đóng gói migration/scripts để chạy release command `npm run db:migrate` trong môi trường có kết nối DB trước khi khởi động API. Startup API không tự chạy DDL. Kiểm tra `/health/ready` sau triển khai; Docker HEALTHCHECK dùng cùng endpoint.

## Redis coordination

`docker compose up -d` in `sh.server` starts a local Redis 7.4 service bound to
127.0.0.1. Set `REDIS_URL=redis://127.0.0.1:6379/0` for a locally running API.
Redis uses AOF, a persistent volume and `noeviction`: exhausting memory must
reject protection writes instead of silently removing quota/lease keys.
Production must use a private authenticated connection or TLS `rediss://`;
the local unauthenticated Compose service must not be published to the internet.

Redis stores hashed quota keys and short-lived job leases, not clinical records,
patient text, payment ledgers or JWT revocation state. Auth/AI quotas are atomic
and shared by replicas. The same deployment must use the same
`REDIS_KEY_PREFIX`; unrelated deployments must use different prefixes. Do not
change the prefix during an incident to bypass exhausted quotas. Limit TTLs
bound storage; do not use FLUSHDB/FLUSHALL during routine operations.

When `REDIS_URL` is absent and `REDIS_REQUIRED=false`, request quotas retain the
existing PostgreSQL implementation and background jobs retain their database
protections. With Redis configured, an outage returns 503 for protected requests
and skips coordinated background jobs until a later run. It never switches to a
separate quota store. `REDIS_REQUIRED=true` also fails closed if the URL is
missing. Readiness checks connectivity with `REDIS_TIMEOUT_MS` (default 1000ms,
range 100-10000); liveness stays independent. Connections recover on later
requests without queueing stale commands offline.

Renewable token-owned leases coordinate reminders, payment reconciliation,
pending-booking expiry, slot cleanup/generation and embedding retries. Database
locks, transactions, consent checks and idempotency remain authoritative.
SMTP acceptance followed by process failure can still cause a repeated email;
this is at-least-once delivery, not an exactly-once guarantee. Monitor readiness,
Redis memory/persistence errors and skipped-job warnings before enabling pilots.

CI supplies both `TEST_DATABASE_URL` and `TEST_REDIS_URL` from disposable local
services. For a local run, set the latter to the test Redis endpoint before
`npm run test:integration`. Redis tests use unique prefixes and delete only their
own keys; they exercise concurrent quotas, lease exclusion and connection loss.

## Backup

Backup chứa dữ liệu bệnh nhân. Lưu ở vị trí được kiểm soát truy cập, có mã hóa và chính sách lưu giữ của cơ sở; không lưu trong Git. Với Windows, quyền file còn phụ thuộc ACL của thư mục đích.

```powershell
cd sh.server
npm run db:backup -- --output 'F:\ClinicBackups\smarthospital-2026-11-01.dump'
```

Script dùng `pg_dump --format=custom --no-owner --no-acl`; mật khẩu chỉ truyền qua environment cho tiến trình con. File đã tồn tại sẽ bị từ chối, không ghi đè. Backup thất bại thì file dở do chính lần chạy đó tạo bị xóa. Chưa có kiểm chứng restore thì chưa được coi là backup phục hồi được.

## Diễn tập restore và rollback

1. Dừng các thao tác ghi nếu đang xử lý sự cố và ghi nhận thời điểm dữ liệu cuối cần giữ. Không xóa database đang chạy.
2. Tạo một database **mới, trống** trên PostgreSQL có pgvector. Tên database đích phải khác database đang cấu hình cho ứng dụng.
3. Restore bằng tài khoản có đúng quyền cho database đích:

```powershell
npm run db:restore -- --input 'F:\ClinicBackups\smarthospital-2026-11-01.dump' --target smart_hospital_restore --confirm-restore smart_hospital_restore
```

Script yêu cầu gõ đúng tên đích, kiểm tra không có bảng/view/sequence trong schema người dùng, rồi dùng `pg_restore --single-transaction --exit-on-error`. Không dùng `--clean`, không DROP database. Nếu restore lỗi, điều tra và sửa nguyên nhân trước khi thử lại.

4. Trên database phục hồi, kiểm tra lịch sử migration, số lượng hồ sơ/giao dịch, mẫu dữ liệu đại diện và liên kết; chạy phiên bản API phù hợp, readiness và UAT với tài khoản thử nghiệm.
5. Chỉ sau khi người phụ trách xác nhận, đổi cấu hình ứng dụng sang database phục hồi. Giữ database cũ để điều tra. Đổi database có thể làm mất những lần ghi sau thời điểm backup; cần đối soát riêng, không tự cho là đầy đủ.

Rollback mã nguồn chỉ an toàn khi phiên bản trước đọc được schema hiện tại. Các migration đang bổ sung chủ yếu theo hướng additive, nhưng không tự động DOWN/DROP cột. Nếu cần rollback dữ liệu, dùng quy trình restore tách biệt ở trên và đối soát các thay đổi sau backup.

## Kiểm thử và theo dõi

```powershell
npm run test:ci
npm run test:scripts
# Chỉ dùng database thử nghiệm riêng, tên chứa "test". Không dùng URL production.
$env:TEST_DATABASE_URL = 'postgresql://test_user:test_password@localhost:5432/smarthospital_test'
npm run test:integration
```

Integration suite tạo schema ngẫu nhiên cho mỗi test, chỉ dọn schema nó tạo; không đọc `.env` production. Không có TEST_DATABASE_URL thì các test DB được đánh dấu skip, **không phải bằng chứng DB đã chạy thành công**. CI cung cấp PostgreSQL pgvector riêng và chạy suite này.

Trước pilot: chạy bootstrap DB trống, nâng cấp bản sao DB cũ, thử lại migration, diễn tập backup/restore, kiểm tra phân quyền và một lượt khám đầy đủ. Theo dõi readiness, lỗi HTTP, lỗi job, số giao dịch chờ đối soát và số thông báo lỗi. Chỉ định người trực xử lý, đường liên hệ và quy trình tiếp đón thủ công khi hệ thống gián đoạn.
