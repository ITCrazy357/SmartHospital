# Hướng dẫn chạy SmartHospital trên máy local

Hướng dẫn chạy **dev** trên máy: backend + frontend + PostgreSQL (Docker). Khi chuẩn bị thử nghiệm tại phòng khám, làm theo [quy trình vận hành, migration và khôi phục](docs/OPERATIONS.md); dùng dữ liệu giả cho tới khi các điều kiện nghiệm thu được đáp ứng.

Dành cho người nhận source (đã xóa `node_modules`, `dist`).

---

## 1. Phần mềm cần có

| Yêu cầu | Ghi chú |
|--------|---------|
| **Node.js + npm** | Node.js **22**, npm đi kèm. |
| **Docker Desktop** | Bật Docker trước khi chạy database. Kiểm tra: `docker version` |

### `npm install` bị lỗi (peer dependency / ERESOLVE)?

Trong **`sh.server`** hoặc **`sh.client`**:

```bash
npm install --legacy-peer-deps
```

Nếu vẫn lỗi:

```bash
npm install --force
```

Ưu tiên **`--legacy-peer-deps`**.

---

## 2. Cấu trúc thư mục

```
SmartHospital/
├── sh.server/          # Backend NestJS + API
│   ├── docker-compose.yml
│   ├── .env.example
│   └── schema/
│       └── smart-hospital-design.sql
├── sh.client/          # Frontend React + Vite
│   └── .env.example
└── HUONG_DAN_CHAY_DU_AN.md
```

---

## 3. Chuẩn bị môi trường (ENV)

### Backend — `sh.server/.env`

```bash
cd sh.server
cp .env.example .env
```

Mặc định trong `.env.example` đã khớp Docker. Quan trọng:

| Biến | Ý nghĩa |
|------|---------|
| `PORT` | API — thường **3000** |
| `POSTGRES_*` | Khớp `docker-compose.yml` |
| `JWT_SECRET` | Chuỗi ký JWT ngẫu nhiên riêng, bắt buộc cấu hình khi triển khai |
| `CLIENT_APP_URL` | Dev: `http://localhost:5431` |

SMTP, PayOS, OpenAI là **tùy chọn** — xem `.env.example`.

### Frontend — `sh.client/.env`

```bash
cd ../sh.client
cp .env.example .env
```

Tối thiểu:

```env
VITE_API_URL=http://localhost:3000
```

**GEMINI_API_KEY**: chỉ khi cần tính năng AI client dùng Gemini.

---

## 4. Database (Docker + PostgreSQL)

NestJS **không** tự tạo bảng (`synchronize: false`). Sau khi container chạy và đã cài dependencies backend, **chạy migration version hóa**.

### Khởi động Postgres

```bash
cd sh.server
docker compose up -d
```

Đợi vài giây. Kiểm tra: `docker ps` — container **`sh-postgres`**.

### Tạo/nâng cấp schema — mọi hệ điều hành

```bash
cd sh.server
npm ci
npm run db:migrate
```

Lệnh dùng POSTGRES_* trong `.env`, áp dụng tuần tự `migrations/*.sql` và lưu lịch sử/checksum. Với DB có sẵn dữ liệu, backup và thử nâng cấp trên bản sao trước. Không dùng file thiết kế ERD để nâng cấp DB cũ. Xem [OPERATIONS.md](docs/OPERATIONS.md).

---

## 5. Chạy Backend

```bash
cd sh.server
npm install
# Nếu lỗi: npm install --legacy-peer-deps
npm run dev
```

API: **http://localhost:3000**

---

## 6. Chạy Frontend

Terminal khác:

```bash
cd sh.client
npm install
# Nếu lỗi: npm install --legacy-peer-deps
npm run dev
```

Web: **http://localhost:5431**

---

## 7. Kiểm tra

1. BE: **http://localhost:3000**
2. FE: **http://localhost:5431**
3. Thử đăng ký / đăng nhập sau khi migration hoàn tất.

---

## 8. Tóm tắt (lần đầu)

1. Cài Node + Docker.  
2. Copy `.env.example` → `.env` trong **`sh.server`** và **`sh.client`**, chỉnh `VITE_API_URL` nếu cần.  
3. `cd sh.server` → `docker compose up -d` → `npm ci` → `npm run db:migrate`.
4. `npm install` (hoặc `--legacy-peer-deps`) → `npm run dev` trong **sh.server**.  
5. `npm install` (hoặc `--legacy-peer-deps`) → `npm run dev` trong **sh.client**.  
6. Mở **http://localhost:5431**.
