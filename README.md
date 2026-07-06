# Hxstu — DLT Center

Hệ thống quản lý trung tâm đào tạo gồm quản lý học viên, khóa học, lớp học/ghi danh và AI Copilot hỗ trợ thao tác bằng ngôn ngữ tự nhiên.

Đây là monorepo sử dụng pnpm Workspaces và Turborepo, chứa frontend Next.js, backend NestJS và package TypeScript dùng chung.

## Chức năng chính

- Đăng nhập và phân quyền quản trị bằng JWT.
- Quản lý hồ sơ học viên.
- Quản lý khóa học, ngày bắt đầu và ngày kết thúc.
- Ghi danh học viên, vai trò trong lớp và thời gian tham gia.
- AI Copilot hỗ trợ tìm, tạo, cập nhật và ghi danh bằng câu chat.
- Lưu lịch sử hội thoại, hành động AI và audit log.
- Cô lập dữ liệu theo trung tâm (`tenant`).

## Công nghệ

| Thành phần | Công nghệ |
|---|---|
| Monorepo | pnpm Workspaces, Turborepo |
| Frontend | Next.js 16, React 19, TypeScript, Tailwind CSS 4 |
| Backend | NestJS 11, TypeScript, Prisma 5 |
| Database | PostgreSQL 15 |
| Xác thực | Passport, JWT, bcrypt |
| AI | Agent tool-calling với OpenAI hoặc Gemini, có fallback mỏng |
| Kiểm thử | Jest |

## Cấu trúc dự án

```text
hxstu/
├── apps/
│   ├── api/                         # NestJS REST API
│   │   ├── prisma/
│   │   │   ├── migrations/          # Prisma migrations
│   │   │   ├── schema.prisma        # Database schema
│   │   │   └── seed.ts              # Dữ liệu mẫu
│   │   └── src/
│   │       ├── ai-agent/             # Agent prompt, tool definitions, fallback NLU và tools
│   │       ├── auth/                 # Đăng nhập, JWT, guards
│   │       ├── copilot/              # Session, message, confirm và audit
│   │       ├── courses/              # Nghiệp vụ khóa học
│   │       ├── enrollments/          # Nghiệp vụ ghi danh/lớp học
│   │       ├── prisma/               # Prisma service/module
│   │       ├── tenants/              # Trung tâm đào tạo
│   │       └── users/                # Admin và học viên
│   └── web/                          # Next.js App Router
│       └── src/
│           ├── app/                  # Các trang và routes
│           ├── components/           # UI dùng chung
│           └── lib/                  # API client và tiện ích
├── packages/
│   └── shared/                       # Enum, type và schema dùng chung
├── docs/                             # Tài liệu thiết kế
├── docker-compose.yml                # PostgreSQL local
├── pnpm-workspace.yaml
└── turbo.json
```

## Yêu cầu môi trường

- Node.js 20 trở lên.
- pnpm 11.
- Docker và Docker Compose nếu chạy PostgreSQL bằng container.

Kiểm tra phiên bản:

```bash
node --version
pnpm --version
docker --version
```

## Cài đặt nhanh

### 1. Cài dependencies

Chạy tại thư mục gốc:

```bash
pnpm install
```

### 2. Tạo file môi trường

```bash
cp .env.example .env
```

Cấu hình mẫu khi dùng PostgreSQL từ `docker-compose.yml`:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5435/hxstu_db?schema=public"
PORT=3001
JWT_SECRET="thay-bang-chuoi-bi-mat-dai-va-ngau-nhien"
FRONTEND_URL="http://localhost:3000"

# Chỉ cần cấu hình một provider AI. Có thể bỏ trống cả hai để dùng fallback.
OPENAI_API_KEY=""
GEMINI_API_KEY=""
USE_AGENT_ORCHESTRATOR="true"
OPENAI_AGENT_MODEL="gpt-4o-mini"
GEMINI_AGENT_MODEL="gemini-flash-latest"
```

Frontend mặc định gọi `http://localhost:3001`. Nếu API chạy ở địa chỉ khác, tạo `apps/web/.env.local`:

```env
NEXT_PUBLIC_API_URL="http://localhost:3001"
```

Không commit `.env`, `.env.local` hoặc API key thật.

### 3. Khởi động PostgreSQL

```bash
docker compose up -d postgres
```

Kiểm tra container:

```bash
docker compose ps
```

PostgreSQL trong container chạy cổng `5432` và được ánh xạ ra `localhost:5435`.

### 4. Chuẩn bị database

```bash
pnpm --filter api exec prisma generate
pnpm --filter api exec prisma migrate deploy
```

Nếu cần dữ liệu mẫu:

```bash
pnpm --filter api exec prisma db seed
```

> Cảnh báo: file seed hiện xóa dữ liệu hiện có trước khi tạo dữ liệu mẫu. Chỉ chạy trên database phát triển.

### 5. Chạy ứng dụng

Chạy đồng thời frontend và backend:

```bash
pnpm dev
```

Hoặc chạy riêng từng ứng dụng:

```bash
pnpm --filter api dev
pnpm --filter web dev
```

Địa chỉ mặc định:

- Frontend: <http://localhost:3000>
- Backend: <http://localhost:3001>
- PostgreSQL: `localhost:5435`

## Tài khoản mẫu

Sau khi chạy seed:

```text
Email: admin@hxstu.edu.vn
Mật khẩu: admin123
```

Tài khoản này chỉ dùng cho môi trường phát triển.

## Scripts

### Toàn monorepo

```bash
pnpm dev       # Chạy các workspace ở chế độ development
pnpm build     # Build toàn bộ workspace
pnpm lint      # Lint toàn bộ workspace
pnpm test      # Chạy test toàn bộ workspace
```

### Backend

```bash
pnpm --filter api dev
pnpm --filter api build
pnpm --filter api test
pnpm --filter api exec jest --runInBand
pnpm --filter api test:e2e
```

Lưu ý: script lint của backend có `--fix` và có thể tự sửa định dạng file.

### Frontend

```bash
pnpm --filter web dev
pnpm --filter web build
pnpm --filter web lint
pnpm --filter web start
```

### Package dùng chung

```bash
pnpm --filter @hxstu/shared build
```

## Prisma và database

Tạo Prisma Client sau khi schema thay đổi:

```bash
pnpm --filter api exec prisma generate
```

Tạo migration mới trong môi trường phát triển:

```bash
pnpm --filter api exec prisma migrate dev --name ten_migration
```

Áp dụng migration đã có:

```bash
pnpm --filter api exec prisma migrate deploy
```

Mở Prisma Studio:

```bash
pnpm --filter api exec prisma studio
```

## AI Copilot

Copilot sử dụng kiến trúc hybrid:

```text
Tin nhắn
→ Chuẩn hóa ngôn ngữ
→ AI/rule nhận diện intent và entity
→ Resolve tham chiếu từ session
→ Đối chiếu dữ liệu thật
→ Policy chọn tool được phép
→ Hiển thị preview
→ Người dùng xác nhận
→ Thực thi và ghi audit log
```

Các tham chiếu như “học viên vừa tạo”, “người này”, “lớp này” và “người thứ hai” được resolve từ trạng thái phiên chat. AI không tự tạo database ID và không trực tiếp ghi dữ liệu.

Mặc định Copilot chạy theo luồng agent tool-calling (`USE_AGENT_ORCHESTRATOR=true`). Nếu có `OPENAI_API_KEY`, hệ thống ưu tiên OpenAI; nếu không có hoặc provider lỗi, hệ thống thử Gemini rồi fallback về parser theo rule. Các thao tác ghi dữ liệu luôn cần bản xem trước và xác nhận.

Có thể tắt agent path bằng `USE_AGENT_ORCHESTRATOR=false` để dùng luồng NLU + DecisionEngine cũ. Khi bật mặc định, backend dùng `AgentOrchestratorService`, tool definitions và context builder mới; các thao tác ghi/xóa vẫn bị ép qua preview xác nhận trước khi chạy.

Tài liệu thiết kế chi tiết: [AI context và tool routing](docs/AI_CONTEXT_TOOL_ROUTING_DESIGN.md).

## Routes giao diện

| Route | Chức năng |
|---|---|
| `/login` | Đăng nhập |
| `/dashboard` | Tổng quan |
| `/students` | Quản lý học viên |
| `/courses` | Quản lý khóa học |
| `/enrollments` | Danh sách lớp học/ghi danh |
| `/copilot` | AI Copilot |
| `/copilot/actions` | Nhật ký tool |
| `/copilot/audit-logs` | Audit log |

## Kiểm tra trước khi bàn giao

```bash
pnpm --filter api exec jest --runInBand
pnpm --filter api build
pnpm --filter web lint
pnpm --filter web build
```

Build frontend cần kết nối mạng nếu `next/font` phải tải Google Fonts lần đầu.

## Xử lý lỗi thường gặp

### API không kết nối được PostgreSQL

- Kiểm tra `docker compose ps`.
- Khi dùng Docker Compose của repo, `DATABASE_URL` phải dùng cổng host `5435`.
- Chạy lại `pnpm --filter api exec prisma generate` sau khi cài dependencies.

### Frontend gọi sai API

Kiểm tra `NEXT_PUBLIC_API_URL` trong `apps/web/.env.local`, sau đó restart frontend.

### Copilot không dùng AI provider

- Kiểm tra một trong hai biến `OPENAI_API_KEY` hoặc `GEMINI_API_KEY`.
- Kiểm tra `USE_AGENT_ORCHESTRATOR`; mặc định là `true` để dùng agent tool-calling.
- Restart backend sau khi thay đổi `.env`.
- Khi agent/provider lỗi, backend fallback về parser cũ cho một số câu lệnh phổ biến.

### Card cũ không thay đổi sau khi cập nhật giao diện

Nội dung assistant đã được lưu trong lịch sử. Hãy gửi lại yêu cầu hoặc tạo phiên chat mới để nhận response theo định dạng mới.

## Tài liệu bổ sung

- [Thiết lập dự án](docs/SetUp.md)
- [Thiết kế AI context và tool routing](docs/AI_CONTEXT_TOOL_ROUTING_DESIGN.md)
- [Kiến trúc và từng bước hoạt động của Copilot Agent](docs/COPILOT_AGENT_ARCHITECTURE.md)

## Lưu ý bảo mật

- Không hardcode hoặc commit secret.
- Đổi `JWT_SECRET` và tài khoản mẫu trước khi triển khai thật.
- Giới hạn CORS bằng `FRONTEND_URL` phù hợp môi trường.
- Không chạy seed trên dữ liệu production.
- Mọi truy vấn nghiệp vụ phải giữ điều kiện tenant.
