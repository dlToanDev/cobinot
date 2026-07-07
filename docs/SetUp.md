# Hướng dẫn thiết lập và chạy dự án (Setup & Run Guide)

Tài liệu này hướng dẫn chi tiết các bước cài đặt môi trường và vận hành dự án `hxstu` (Monorepo Next.js + NestJS + PostgreSQL).

---

## 1. Yêu cầu hệ thống (Prerequisites)

Trước khi chạy dự án, hãy đảm bảo máy tính của bạn đã cài đặt các công cụ sau:

1.  **Node.js**: Phiên bản LTS khuyến nghị (v20 hoặc mới hơn).
2.  **pnpm**: Phiên bản 11.x (đã cài đặt trên máy của bạn). Nếu chưa cài đặt, chạy lệnh:
    ```bash
    npm install -g pnpm
    ```
3.  **Docker & Docker Compose**: Để chạy cơ sở dữ liệu PostgreSQL một cách nhanh chóng.
4.  **Git**: Để quản lý mã nguồn.

---

## 2. Các bước cài đặt và khởi chạy dự án

### Bước 2.1: Cài đặt thư viện dependencies
Tại thư mục gốc của dự án (`/home/toan/Dltoan/Code/iter/hxstu `), chạy lệnh sau để tải toàn bộ thư viện cho Frontend, Backend và Shared package:
```bash
pnpm install
```

### Bước 2.2: Khởi động Cơ sở dữ liệu (Database)
Sử dụng Docker Compose để tạo container PostgreSQL.
```bash
docker compose up -d
```
> [!NOTE]
> Cổng PostgreSQL của container đã được cấu hình sang **5435** ở phía host (máy của bạn) để tránh xung đột với PostgreSQL chạy ngầm sẵn ở cổng mặc định 5432.

### Bước 2.3: Đồng bộ cấu trúc Database (Migrations)
Chạy script tự động chạy Prisma migrations để tạo cấu trúc 9 bảng dữ liệu trong PostgreSQL:
```bash
./scripts/db-migrate.sh
```
*(Hoặc chạy lệnh thủ công: `pnpm --filter api exec prisma migrate dev`)*

### Bước 2.4: Khởi động hệ thống ở chế độ phát triển
Chạy lệnh sau để khởi động đồng thời cả ứng dụng Frontend (Next.js) và Backend (NestJS):
```bash
./scripts/dev.sh
```
*(Hoặc chạy lệnh thủ công: `pnpm run dev`)*

Hệ thống sẽ chạy tại các cổng mặc định sau:
*   **Frontend**: [http://localhost:3000](http://localhost:3000)
*   **Backend (API Server)**: [http://localhost:3001](http://localhost:3001)

---

## 3. Xử lý sự cố thường gặp (Troubleshooting)

### Lỗi xung đột cổng `address already in use` khi chạy Docker
Nếu bạn nhận được thông báo lỗi:
`failed to bind host port 0.0.0.0:5432/tcp: address already in use`
*   **Nguyên nhân**: Cổng `5432` đang bị chiếm bởi một tiến trình PostgreSQL khác đang chạy trực tiếp trên máy của bạn.
*   **Giải pháp**: Dự án đã được đổi cấu hình cổng host sang **5435**. Bạn chỉ cần chạy lại `docker compose up -d`.

### Lỗi kết nối Database `P1000: Authentication failed`
*   **Nguyên nhân**: Thông tin tài khoản trong file `.env` hoặc cổng kết nối bị sai.
*   **Giải pháp**: Đảm bảo tệp tin `.env` ở thư mục gốc và `apps/api/.env` đều sử dụng đúng chuỗi kết nối:
    ```env
    DATABASE_URL="postgresql://postgres:postgres@localhost:5435/hxstu_db?schema=public"
    ```
