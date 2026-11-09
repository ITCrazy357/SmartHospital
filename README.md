# SmartHospital

SmartHospital là ứng dụng web hỗ trợ đặt lịch khám và quản lý hoạt động phòng khám ngoại trú. Hệ thống kết nối quy trình đặt lịch trực tuyến với tiếp đón tại quầy, khám bệnh, lưu hồ sơ và thu ngân.

Dự án gồm frontend **React + Vite** và backend **NestJS**, dùng **PostgreSQL + pgvector** để lưu dữ liệu. Các tích hợp gồm PayOS cho thanh toán, Supabase Storage cho ảnh, SendGrid cho email và OpenAI cho các chức năng AI.

## Chức năng chính

| Nhóm | Chức năng |
| --- | --- |
| Tài khoản | Đăng ký, đăng nhập JWT, cập nhật hồ sơ, đổi/đặt lại mật khẩu, khóa tài khoản và thu hồi phiên |
| Tìm kiếm và đặt lịch | Tìm bác sĩ theo chuyên khoa và khả dụng; xem hồ sơ, chọn khung giờ, đặt lịch, đổi/hủy lịch và xuất lịch hẹn `.ics` |
| Thanh toán trực tuyến | Tạo liên kết thanh toán PayOS, xử lý webhook, khôi phục thanh toán và theo dõi giao dịch cần đối soát |
| Tiếp đón | Quản lý mã bệnh nhân riêng với tài khoản; đăng ký tại quầy/điện thoại, tiếp nhận lịch trực tuyến, check-in, hàng đợi và ghi vắng mặt |
| Hồ sơ khám | Ghi chỉ số, triệu chứng, chẩn đoán, điều trị và ngày tái khám; lưu nháp, xác nhận, bổ sung phiên bản và in kết quả |
| Thu ngân | Ghi nhận thu tiền, đề nghị hoàn, duyệt và xác nhận chi hoàn; chuyển khoản đã thu giữa các ca cùng bệnh nhân |
| Lịch làm việc | Quản lý ca định kỳ, ngoại lệ theo ngày, sinh khung giờ và duyệt nghỉ phép; xem trước ảnh hưởng khi thay đổi lịch |
| Vận hành | Quản lý người đại diện, danh sách chờ, công việc tồn, nhắc lịch, nhật ký nghiệp vụ và nội dung quảng cáo |
| AI | Gợi ý chuyên khoa, gợi ý khung giờ và trợ lý bác sĩ có truy xuất hồ sơ bằng RAG; có công tắc bật/tắt, đồng ý xử lý dữ liệu và giới hạn sử dụng |

Các khoản thu/hoàn tại quầy là bản ghi nghiệp vụ trong ứng dụng. Xác nhận chi hoàn không tự chuyển tiền qua ngân hàng; phiếu thu không phải hóa đơn thuế. AI hỗ trợ người sử dụng và cần được đánh giá riêng trước khi áp dụng vào hoạt động khám thực tế.

## Vai trò

| Vai trò | Mã | Phạm vi chính |
| --- | --- | --- |
| Bệnh nhân | `user` | Quản lý lịch, thanh toán và hồ sơ được cấp quyền của mình/người phụ thuộc |
| Bác sĩ | `doctor` | Quản lý ca được phân công, ghi hồ sơ, lịch làm việc và sử dụng trợ lý AI khi được cho phép |
| Lễ tân | `receptionist` | Quản lý thông tin bệnh nhân, tiếp nhận, check-in và danh sách chờ |
| Thu ngân | `cashier` | Ghi nhận thu, đề nghị/xác nhận hoàn và xử lý đối soát theo quyền |
| Quản trị | `admin` | Quản lý tài khoản, cấu hình, lịch làm việc, nghỉ phép và duyệt nghiệp vụ tài chính |

API kiểm tra vai trò và quyền truy cập dữ liệu. Lễ tân/thu ngân có phạm vi thông tin riêng; hồ sơ nháp chưa được công bố cho bệnh nhân. Xem [quy trình nghiệp vụ](docs/CLINIC_WORKFLOWS.md) để biết chi tiết từng thao tác.

## Công nghệ

| Thành phần | Công nghệ |
| --- | --- |
| Frontend | React 19, TypeScript, Vite 6, Tailwind CSS 4, Motion, Lucide React |
| Backend | NestJS 11, TypeScript, TypeORM, Passport/JWT, bcrypt |
| Database | PostgreSQL 16, pgvector; migration SQL có phiên bản và checksum |
| Redis | Redis 7.4, dùng cho giới hạn request chia sẻ và phối hợp tác vụ nền khi được cấu hình |
| Tích hợp | PayOS, Supabase Storage, SendGrid, OpenAI |
| Kiểm thử | Jest, Supertest, Node.js test runner |
| Triển khai | Docker cho backend; cấu hình Vercel cho frontend, hướng dẫn Render cho API; GitHub Actions cho CI và kiểm tra sau deploy |

## Cấu trúc thư mục

```text
SmartHospital/
├── sh.client/
│   ├── src/
│   │   ├── api/                 # HTTP client và hợp đồng dữ liệu frontend
│   │   ├── components/          # Đặt lịch, dashboard, phòng khám, AI...
│   │   ├── contexts/
│   │   └── utils/
│   ├── scripts/                 # Build, metadata triển khai, smoke trình duyệt
│   └── .env.example
├── sh.server/
│   ├── src/                     # Module nghiệp vụ NestJS và TypeORM entities
│   ├── migrations/              # Nguồn migration dùng để tạo/nâng cấp database
│   ├── schema/                  # SQL tham chiếu thiết kế database
│   ├── scripts/                 # Migration, backup/restore, startup triển khai
│   ├── test/                    # Integration test với database/Redis riêng
│   ├── docker-compose.yml       # PostgreSQL + Redis cho local
│   └── .env.example
├── docs/                        # Nghiệp vụ, vận hành, triển khai và QA
├── scripts/                     # Kiểm tra phiên bản và sức khỏe sau deploy
└── .github/workflows/           # CI và xác minh triển khai
```

## Chạy trên máy local

### 1. Chuẩn bị

- **Node.js 22.x** và npm, theo `engines` của cả hai package.
- **Docker Desktop** đang chạy để khởi động PostgreSQL và Redis.
- Một dự án **Supabase** với URL, secret key phía server và bucket Storage để tải ảnh.

Các lệnh dưới đây dùng **PowerShell**, bắt đầu tại thư mục gốc repository. Frontend và backend cài dependency riêng; không có lệnh `npm install` chung tại thư mục gốc.

```powershell
node --version
npm --version
docker version
```

### 2. Tạo cấu hình môi trường

Chỉ sao chép khi chưa có `.env` để giữ cấu hình hiện tại:

```powershell
if (!(Test-Path sh.server/.env)) {
    Copy-Item sh.server/.env.example sh.server/.env
}
if (!(Test-Path sh.client/.env)) {
    Copy-Item sh.client/.env.example sh.client/.env
}
```

Trong `sh.server/.env`, giữ nhóm `POSTGRES_*` mặc định nếu dùng Docker Compose đi kèm. Cấu hình thêm:

```dotenv
PORT=3000
CLIENT_APP_URL=http://localhost:5431
JWT_SECRET=<secret-ngau-nhien-rieng>
SUPABASE_URL=<url-du-an-supabase>
SUPABASE_SECRET_KEY=<secret-key-phia-server>
SUPABASE_STORAGE_BUCKET=smart-hospital
AI_ENABLED=false
```

Thay các giá trị trong `<...>` bằng cấu hình của bạn. Có thể tạo chuỗi ngẫu nhiên cho `JWT_SECRET` bằng lệnh sau rồi chép kết quả vào `.env`:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
```

**Supabase hiện là điều kiện khởi động backend:** `S3UploadService` báo lỗi ngay nếu thiếu URL hoặc secret key, kể cả khi chưa sử dụng chức năng upload. Chuẩn bị bucket theo tên đã cấu hình; dịch vụ lưu public URL của ảnh sau khi upload.

Trong `sh.client/.env`:

```dotenv
VITE_API_URL=http://localhost:3000
VITE_CLINIC_NAME="Phòng khám"
```

Các biến `VITE_*` được đưa vào mã JavaScript công khai. Chỉ cấu hình API key, thông tin database và secret Supabase ở backend.

### 3. Khởi động database và chạy migration

```powershell
Set-Location sh.server
npm ci
docker compose up -d
docker compose ps
npm run db:migrate
```

Đợi PostgreSQL báo `healthy` trước khi chạy migration. Compose khởi động PostgreSQL trên cổng **5432** và Redis trên cổng **6379**, theo giá trị mặc định.

Backend đặt `synchronize: false`, vì vậy cần chạy migration trước khi sử dụng API. `db:migrate` áp dụng lần lượt các file `migrations/*.sql` và lưu lịch sử vào `schema_migrations`. File trong `schema/` phục vụ tham chiếu thiết kế, không dùng để nâng cấp database đang có dữ liệu.

### 4. Chạy backend

Trong terminal đang ở `sh.server`:

```powershell
npm run dev
```

API: **http://localhost:3000**. Mở terminal khác tại thư mục gốc để kiểm tra:

```powershell
Invoke-RestMethod http://localhost:3000/health/live
Invoke-RestMethod http://localhost:3000/health/ready
```

Kết quả mong đợi lần lượt là `status: ok` và `status: ready`. Readiness kiểm tra kết nối, các phần schema cần thiết và lịch sử migration; nếu cấu hình Redis thì kiểm tra cả Redis.

### 5. Chạy frontend

Mở terminal khác tại thư mục gốc:

```powershell
Set-Location sh.client
npm ci
npm run dev
```

Truy cập **http://localhost:5431**. Frontend chọn màn hình qua query parameter `view`; ví dụ màn tìm bác sĩ là `/?view=search`.

### 6. Tài khoản và dữ liệu đầu tiên

Migration không tạo sẵn tài khoản quản trị, bác sĩ hay dữ liệu demo. Đăng ký trên giao diện tạo tài khoản bệnh nhân với vai trò `user`.

Để khởi tạo **quản trị đầu tiên trong database local mới**, đăng ký tài khoản của bạn, sau đó mở `psql` từ thư mục `sh.server` bằng thông tin Compose mặc định:

```powershell
docker compose exec postgres psql -U sh_user -d smart_hospital
```

Thay email ví dụ dưới đây bằng email vừa đăng ký rồi chạy SQL:

```sql
UPDATE users
SET role = 'admin', token_version = token_version + 1
WHERE email = 'your-admin@example.test' AND role = 'user'
RETURNING id, email, role;
```

Lệnh phải trả về đúng tài khoản cần cấp quyền. Thoát `psql` bằng `\q`, đăng nhập lại trên web, rồi dùng chức năng quản trị để tạo tài khoản nhân viên, chuyên khoa, bác sĩ và lịch làm việc. Nếu đã thay tên user/database trong `.env`, dùng giá trị tương ứng khi mở `psql`.

## Cấu hình các dịch vụ

Xem thêm [backend `.env.example`](sh.server/.env.example) và [frontend `.env.example`](sh.client/.env.example). Bảng dưới đây ghi theo mã nguồn hiện tại:

| Nhóm biến backend | Mục đích và yêu cầu |
| --- | --- |
| `POSTGRES_*` hoặc `DATABASE_URL` | Kết nối PostgreSQL. `DATABASE_URL` được ưu tiên nếu có; database cần hỗ trợ extension `vector` và `pgcrypto` |
| `JWT_SECRET` | Khóa ký token. Production yêu cầu secret riêng có ít nhất 32 ký tự; nên cấu hình cả khi chạy local |
| `CLIENT_APP_URL` | Origin frontend cho CORS, liên kết email và luồng thanh toán; local dùng `http://localhost:5431` |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_STORAGE_BUCKET` | Upload ảnh; URL và secret key bắt buộc khi khởi động backend hiện tại |
| `PAYOS_CLIENT_ID`, `PAYOS_API_KEY`, `PAYOS_CHECKSUM_KEY`, `PUBLIC_API_URL` | Thanh toán PayOS và URL API công khai; webhook nhận tại `/payments/payos-webhook` |
| `SENDGRID_API_KEY`, `MAIL_FROM` | Gửi email đặt lại mật khẩu và nhắc lịch; `MAIL_FROM` dùng địa chỉ người gửi đã cấu hình với SendGrid |
| `OPENAI_API_KEY`, `OPENAI_CHAT_MODEL`, `OPENAI_EMBEDDING_MODEL` | Cấu hình provider và model AI phía server |
| `AI_ENABLED`, `AI_REQUESTS_PER_HOUR`, `AI_DAILY_REQUEST_LIMIT`, `AI_RAG_MAX_DISTANCE` | Công tắc triển khai và giới hạn AI; vẫn cần quản trị bật tính năng và người liên quan đồng ý xử lý dữ liệu |
| `REDIS_URL`, `REDIS_REQUIRED`, `REDIS_KEY_PREFIX`, `REDIS_TIMEOUT_MS` | Redis cho quota chia sẻ và phối hợp job; local có thể dùng `redis://127.0.0.1:6379` |
| `POSTGRES_SSL`, `TRUST_PROXY_HOPS` | Xác minh TLS database và số reverse proxy được tin cậy; cấu hình theo hạ tầng triển khai |

**Email đang dùng SendGrid.** Nhóm `SMTP_*` còn được chú thích trong `.env.example` không được `MailService` hiện tại sử dụng. Khi cần gửi thư, thêm `SENDGRID_API_KEY` và `MAIL_FROM` vào môi trường backend.

PayOS, email và OpenAI không bắt buộc để API khởi động, nhưng các chức năng phụ thuộc cần được cấu hình và kiểm tra riêng. Luồng đặt lịch trực tuyến có thanh toán cần PayOS để tạo checkout. Frontend không dùng Gemini và không cần key AI trong biến `VITE_*`.

Để `REDIS_URL` trống và `REDIS_REQUIRED=false` nếu chưa dùng Redis; giới hạn request sử dụng PostgreSQL. Khi đã cấu hình Redis, lỗi kết nối không âm thầm chuyển sang cơ chế quota khác.

## Kiểm tra và build

Chạy các lệnh tại thư mục tương ứng:

| Thư mục | Lệnh | Nội dung |
| --- | --- | --- |
| `sh.client` | `npm run lint` | Kiểm tra kiểu TypeScript |
| `sh.client` | `npm test` | Kiểm thử cấu hình deployment và các hàm nghiệp vụ frontend |
| `sh.client` | `npm run build` | Kiểm tra TypeScript và build vào `dist/` |
| `sh.client` | `npm run build:deploy` | Build kèm kiểm tra API URL cho triển khai |
| `sh.server` | `npm run test:scripts` | Kiểm thử script migration và startup |
| `sh.server` | `npm run test:ci` | Unit test Jest, chạy tuần tự |
| `sh.server` | `npm run test:integration` | Integration test; cần PostgreSQL/pgvector và Redis riêng cho kiểm thử |
| `sh.server` | `npm run build` | Build NestJS vào `dist/` |
| Gốc repository | `node --test scripts/verify-deployment.test.mjs` | Kiểm thử script xác minh triển khai bằng fixture |

Integration test dùng `TEST_DATABASE_URL` và `TEST_REDIS_URL`. Dùng database local riêng có tên chứa `test` và Redis dành cho kiểm thử; các suite tạo/dọn dữ liệu của chúng. Tham khảo cấu hình dịch vụ trong [CI workflow](.github/workflows/ci.yml). Một số suite bỏ qua khi thiếu biến, còn suite phối hợp job yêu cầu Redis; không xem test bị skip là kiểm thử thành công với database.

Kiểm thử nghiệp vụ dùng mock cho các provider bên ngoài. Kết quả test/build không xác nhận giao dịch PayOS, email hay AI thực tế đã hoạt động. Kịch bản smoke trình duyệt dùng fixture được mô tả tại [QA record](docs/qa/clinic-browser-smoke-2026-11-02.md).

## Triển khai và vận hành

- **Frontend Vercel:** hỗ trợ Root Directory ở gốc repository hoặc `sh.client`, dùng cấu hình `vercel.json` tương ứng. Đặt `VITE_API_URL` thành URL HTTPS của backend rồi build bằng `build:deploy`.
- **Backend Render:** Root Directory `sh.server`, Build Command `npm ci && npm run build`, Start Command `npm run start:deploy`, Health Check Path `/health/ready`. Script startup chạy migration trước khi mở API và dừng nếu migration lỗi.
- **Docker:** có [Dockerfile backend](sh.server/Dockerfile). Compose đi kèm dùng cho PostgreSQL/Redis; ứng dụng frontend/backend được chạy riêng. Lệnh mặc định trong Dockerfile và `start:prod` chỉ mở API, không chạy migration.
- **CI:** GitHub Actions kiểm tra script, unit/integration test và build với PostgreSQL/pgvector, Redis riêng.
- **Sau deploy:** Render/Vercel triển khai qua Git integration; workflow CD kiểm tra phiên bản, readiness và frontend sau CI thành công. Workflow này không kích hoạt triển khai.

Trước khi nâng cấp database có dữ liệu, backup và thử migration/khôi phục trên bản sao theo [hướng dẫn vận hành](docs/OPERATIONS.md). Không sửa migration đã áp dụng hoặc dùng reset để xử lý lỗi schema. Thử nghiệm bằng dữ liệu giả cho đến khi hoàn tất nghiệm thu nghiệp vụ, phân quyền và các tích hợp cần sử dụng.

## Xử lý lỗi thường gặp

| Hiện tượng | Kiểm tra |
| --- | --- |
| Thiếu `SUPABASE_URL` hoặc secret key | Điền cấu hình Supabase phía backend; dịch vụ upload được tạo ngay khi API khởi động |
| `/health/ready` trả 503 | Kiểm tra PostgreSQL, chạy `db:migrate`, kiểm tra Redis nếu đã cấu hình; xem nhóm lỗi trong log backend |
| Không kết nối được PostgreSQL | Chờ container `healthy`; đối chiếu `POSTGRES_*`/`DATABASE_URL`. Nếu đổi cổng, cập nhật cả cấu hình kết nối |
| Trình duyệt không gọi được API/CORS | Đối chiếu `VITE_API_URL` với API đang chạy và `CLIENT_APP_URL` với origin frontend; khởi động lại Vite sau khi sửa `.env` |
| Không gửi được email | Cấu hình `SENDGRID_API_KEY`, `MAIL_FROM` và người gửi SendGrid; các biến SMTP cũ không bật gửi thư |
| Không có bác sĩ hoặc khung giờ | Database mới chưa có dữ liệu demo; tạo chuyên khoa, bác sĩ và lịch làm việc bằng tài khoản quản trị |
| Không tạo được checkout hoặc AI đang tắt | Kiểm tra cấu hình PayOS; với AI, kiểm tra key backend, công tắc môi trường/quản trị và đồng ý xử lý dữ liệu |
| `SELF_SIGNED_CERT_IN_CHAIN` với database hosted | Cấu hình CA tin cậy theo [hướng dẫn triển khai](docs/DEPLOYMENT.md); giữ xác minh chứng chỉ TLS |

## Tài liệu liên quan

- [Quy trình sử dụng và quyền từng vai trò](docs/CLINIC_WORKFLOWS.md)
- [Migration, backup/restore và vận hành](docs/OPERATIONS.md)
- [Triển khai Vercel/Render và cấu hình TLS](docs/DEPLOYMENT.md)
- [Xác minh phiên bản sau deploy](docs/CD.md)
- [Ghi nhận các phần triển khai ngày 02/11/2026](docs/IMPLEMENTATION_STATUS.md)
- [Phạm vi kiểm tra giao diện bằng fixture](docs/qa/clinic-browser-smoke-2026-11-02.md)

## Giấy phép

Repository hiện chưa có file `LICENSE`; package backend khai báo `UNLICENSED`. Cần xác nhận quyền sử dụng và phân phối với chủ sở hữu dự án.
