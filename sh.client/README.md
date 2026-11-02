# SmartHospital frontend

React + Vite. Yêu cầu Node.js 22.

```sh
npm ci
npm run dev
npm run lint
npm run build
```

Copy `.env.example` thành `.env` và cấu hình `VITE_API_URL` trỏ API NestJS. Biến `VITE_*` là công khai trong trình duyệt, không đặt API key hay thông tin bí mật vào đây. AI đi qua backend, cần cấu hình và đồng ý xử lý dữ liệu ở server.

Hướng dẫn chạy: [hướng dẫn dự án](../HUONG_DAN_CHAY_DU_AN.md). Quy trình nghiệp vụ, vai trò và cách dùng: [Clinic workflows](../docs/CLINIC_WORKFLOWS.md).

Trước triển khai, cấu hình tên, liên hệ thực của phòng khám và URL chính sách trong `.env.example`. Các thông tin chưa cấu hình không được thay bằng dữ liệu liên hệ giả.

Kịch bản kiểm tra trình duyệt dùng toàn bộ dữ liệu giả: `scripts/clinic-browser-smoke.cjs`. Xem giới hạn và cách chạy tại [QA record](../docs/qa/clinic-browser-smoke-2026-11-02.md).
