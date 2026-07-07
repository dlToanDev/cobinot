# Hxstu

Hxstu là hệ thống quản lý trung tâm đào tạo cho

Đây là monorepo dùng pnpm Workspaces và Turborepo, gồm frontend Next.js, backend NestJS và package TypeScript dùng chung.

## Mục Lục

- [Tính năng chính](#tính-năng-chính)
- [Công nghệ](#công-nghệ)
- [Cấu trúc dự án](#cấu-trúc-dự-án)
- [Yêu cầu môi trường](#yêu-cầu-môi-trường)
- [Cài đặt nhanh](#cài-đặt-nhanh)
- [Scripts](#scripts)
- [Database và Prisma](#database-và-prisma)
- [AI Copilot](#ai-copilot)
- [Routes giao diện](#routes-giao-diện)
- [Kiểm tra trước khi bàn giao](#kiểm-tra-trước-khi-bàn-giao)
- [Xử lý lỗi thường gặp](#xử-lý-lỗi-thường-gặp)
- [Tài liệu bổ sung](#tài-liệu-bổ-sung)
- [Bảo mật](#bảo-mật)

## Tính năng chính

- Đăng nhập admin bằng JWT.
- Quản lý học viên: tạo, sửa, đổi trạng thái, xóa đơn lẻ hoặc xóa hàng loạt.
- Quản lý khóa học và trạng thái khóa học.
- Quản lý lớp học thuộc khóa học, học viên trong lớp và trạng thái lớp.
- Quản lý ghi danh học viên vào khóa học/lớp học.
- AI Copilot mini hỗ trợ 5 nghiệp vụ: tạo học viên, tạo khóa học, cập nhật khóa học, tạo lớp học, ghi danh học viên vào khóa (mọi thao tác ghi đều qua preview → confirm).
- Lưu phiên chat, lịch sử tin nhắn, action log, audit log và turn event của Copilot.
- Cô lập dữ liệu theo trung tâm thông qua `tenantId`.

## Công nghệ

| Thành phần | Công nghệ                                        |
| ---------- | ------------------------------------------------ |
| Monorepo   | pnpm Workspaces, Turborepo                       |
| Frontend   | Next.js 16, React 19, TypeScript, Tailwind CSS 4 |
| Backend    | NestJS 11, TypeScript                            |
| Database   | PostgreSQL 15, Prisma 5                          |
| Auth       | Passport, JWT, bcrypt                            |
| AI         | OpenAI-compatible provider, fallback rule-based  |
| Test       | Jest                                             |

## Cấu trúc dự án

```text
hxstu/
├── apps/
│   ├── api/                         # NestJS REST API
│   │   ├── prisma/
│   │   │   ├── migrations/          # Prisma migrations
│   │   │   ├── schema.prisma        # Database schema
│   │   │   └── seed.ts              # Dữ liệu mẫu local
│   │   └── src/
│   │       ├── ai-agent/            # AI agent, tool definitions, context và runner
│   │       ├── auth/                # Login, JWT strategy, guards
│   │       ├── common/              # Decorators và helper dùng chung
│   │       ├── copilot/             # Session, message, confirm/cancel, log
│   │       ├── courses/             # Khóa học và lớp học
│   │       ├── enrollments/         # Ghi danh
│   │       ├── prisma/              # Prisma service/module
│   │       ├── tenants/             # Trung tâm đào tạo
│   │       └── users/               # Admin và học viên
│   └── web/                         # Next.js App Router
│       └── src/
│           ├── app/                 # Pages/routes
│           ├── components/          # Component dùng chung
│           └── lib/                 # API client và tiện ích
├── docs/                            # Tài liệu kỹ thuật bổ sung
├── packages/
│   └── shared/                      # Enum, type, schema dùng chung
├── scripts/                         # Script tiện ích local
├── docker-compose.yml               # PostgreSQL local
├── pnpm-workspace.yaml
└── turbo.json
```

## Yêu cầu môi trường

- Node.js 20 trở lên.
- pnpm 11.x.
- Docker và Docker Compose nếu chạy PostgreSQL bằng container.
- Git.

Kiểm tra nhanh:

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

Biến môi trường mặc định trong `.env.example`:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5435/hxstu_db?schema=public"
PORT=3001
JWT_SECRET="super-secret-key-change-in-production"
FRONTEND_URL="http://localhost:3000"

# AI Provider (chuẩn OpenAI-compatible). Đổi provider chỉ bằng các biến AI_*.
AI_PROVIDER="openai-compatible"       # hoặc "fallback" (chạy hoàn toàn bằng rule/DB)
AI_BASE_URL="https://api.openai.com/v1"
AI_API_KEY=""
AI_MODEL="gpt-4o-mini"
AI_TIMEOUT_MS="30000"
AI_MAX_RETRIES="2"
AI_MAX_TOKENS="2000"
AI_ENABLE_FALLBACK="true"             # fallback DB khi AI lỗi/hết quota

# Copilot mini
AGENT_MINI_MODE="true"
COPILOT_SESSION_TTL_HOURS="24"
```

Frontend mặc định gọi API tại `http://localhost:3001`. Nếu cần đổi API URL, tạo `apps/web/.env.local`:

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

Container PostgreSQL dùng cổng nội bộ `5432` và map ra host tại `localhost:5435`.

### 4. Chuẩn bị database

Tạo Prisma Client:

```bash
pnpm --filter api exec prisma generate
```

Áp dụng migration đã có:

```bash
pnpm --filter api exec prisma migrate deploy
```

Nếu cần dữ liệu mẫu local:

```bash
pnpm --filter api exec prisma db seed
```

Tài khoản admin mẫu sau khi seed:

```text
Email: admin@hxstu.edu.vn
Mật khẩu: admin123
```

> Lưu ý: `seed.ts` xóa dữ liệu hiện có trước khi tạo dữ liệu mẫu. Chỉ chạy seed trên môi trường phát triển.

### 5. Chạy ứng dụng

Chạy frontend và backend cùng lúc:

```bash
pnpm dev
```

Hoặc chạy riêng từng app:

```bash
pnpm --filter api dev
pnpm --filter web dev
```

Địa chỉ mặc định:

- Frontend: <http://localhost:3000>
- Backend API: <http://localhost:3001>
- PostgreSQL: `localhost:5435`

## Scripts

### Monorepo

```bash
pnpm dev       # Chạy toàn bộ workspace ở chế độ development
pnpm build     # Build toàn bộ workspace
pnpm lint      # Lint toàn bộ workspace
pnpm test      # Chạy test toàn bộ workspace có script test
```

### Backend

```bash
pnpm --filter api dev
pnpm --filter api build
pnpm --filter api test
pnpm --filter api test:e2e
pnpm --filter api exec jest --runInBand
```

Script lint của backend có `--fix`, nên có thể tự sửa file:

```bash
pnpm --filter api lint
```

### Frontend

```bash
pnpm --filter web dev
pnpm --filter web build
pnpm --filter web lint
pnpm --filter web start
```

### Shared package

```bash
pnpm --filter @hxstu/shared build
```

### Script tiện ích

```bash
./scripts/dev.sh
./scripts/db-migrate.sh
./scripts/db-seed.sh
```

## Database và Prisma

Các model chính trong `apps/api/prisma/schema.prisma`:

- `Tenant`: trung tâm đào tạo.
- `User`: admin và học viên.
- `Course`: khóa học.
- `CourseClass`: lớp học thuộc khóa học.
- `ClassEnrollment`: học viên trong lớp.
- `ClassSession`, `ClassAssignment`, `AssignmentSubmission`: lịch học, bài tập, bài nộp.
- `AiAgentSession`, `AiAgentSessionMessage`, `AiAgentAction`, `AiAgentAuditLog`, `AiCopilotTurnEvent`: dữ liệu phục vụ Copilot.

Command Prisma thường dùng:

```bash
pnpm --filter api exec prisma generate
pnpm --filter api exec prisma migrate dev --name ten_migration
pnpm --filter api exec prisma migrate deploy
pnpm --filter api exec prisma db seed
pnpm --filter api exec prisma studio
```

## AI Copilot mini

Copilot mini nhận yêu cầu tiếng Việt từ admin. Bản mini **chỉ hỗ trợ 5 nghiệp vụ**:

1. Tạo học viên
2. Tạo khóa học
3. Cập nhật khóa học (đổi tên, mã, cấp độ, mô tả, ngày bắt đầu/kết thúc của khóa đang chọn/vừa tạo)
4. Tạo lớp học trong khóa (chỉ cần khóa + tên lớp, các field phụ để trống/cập nhật sau)
5. Ghi danh học viên vào khóa

Xem chi tiết trong:

- [docs/COPILOT_AGENT_ARCHITECTURE.md](docs/COPILOT_AGENT_ARCHITECTURE.md)
- [docs/COPILOT_MINI_ACCEPTANCE_CHECKLIST.md](docs/COPILOT_MINI_ACCEPTANCE_CHECKLIST.md)
- [docs/COPILOT_MINI_MANUAL_TEST_SCRIPT.md](docs/COPILOT_MINI_MANUAL_TEST_SCRIPT.md)

### Scope

Trong mini mode (`AGENT_MINI_MODE=true`), các tool sửa/xóa/đóng (`update_student`,
`delete_students`, `delete_courses`, `update_class`,
`close_class`, `remove_student_from_*`) bị **ẩn khỏi LLM và bị chặn ở backend**.

### Tool list (mini)

- READ: `search_student`, `get_student_detail`, `search_course`, `get_course_detail`, `get_course_classes`
- WRITE: `create_student`, `create_course`, `update_course`, `create_class`, `assign_student_to_course`
- Đặc biệt: `ask_clarification`

### Preview / Confirm flow

Mọi thao tác ghi dữ liệu đều đi qua:

```text
Tin nhắn người dùng
-> Load session state + lịch sử chat
-> AgentRunnerService gọi tool (READ tìm dữ liệu; WRITE tạo pending_write)
-> Backend lưu pending_action + trả preview_card (KHÔNG ghi DB ở /turns)
-> User bấm Xác nhận -> POST /confirm -> ToolRegistryService.execute -> service nghiệp vụ -> DB
-> User bấm Hủy -> POST /cancel -> clear pending_action, không ghi DB
```

Agent **không bao giờ tự execute** WRITE trong `/turns`.

### Session lifecycle

- `POST /copilot/sessions`: tạo session mới, state sạch.
- `GET /copilot/sessions/current`: lấy session ACTIVE mới nhất (tạo mới nếu chưa có / quá TTL).
- `PATCH /copilot/sessions/:id/close`: đóng session và clear `pending_action`/context.
- "Chat mới" ở FE gọi close session cũ + tạo session mới → context không carry-over.

### Mini mode & config

- `AGENT_MINI_MODE` (mặc định `true`): `true` chỉ expose tool mini; `false` expose full tool.
- `COPILOT_SESSION_TTL_HOURS` (mặc định `24`): tự đóng session ACTIVE quá cũ khi bootstrap.
- Provider AI: cấu hình qua `AI_PROVIDER`, `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`
  (chuẩn OpenAI-compatible); `AI_ENABLE_FALLBACK` bật fallback DB khi AI lỗi/hết quota.

Các thao tác ghi của Copilot được lưu vào action log và audit log để truy vết.

### Test commands

```bash
pnpm --filter api test
pnpm --filter api build
pnpm --filter web build
```

## Routes giao diện

| Route                                   | Chức năng                          |
| --------------------------------------- | ---------------------------------- |
| `/login`                                | Đăng nhập                          |
| `/dashboard`                            | Tổng quan                          |
| `/students`                             | Quản lý học viên                   |
| `/courses`                              | Quản lý khóa học                   |
| `/courses/[courseId]/classes`           | Quản lý lớp học của khóa học       |
| `/courses/[courseId]/classes/[classId]` | Chi tiết lớp và học viên trong lớp |
| `/enrollments`                          | Danh sách ghi danh                 |
| `/enrollments/[courseId]`               | Ghi danh theo khóa học             |
| `/copilot`                              | AI Copilot                         |
| `/copilot/sessions`                     | Danh sách phiên Copilot            |
| `/copilot/actions`                      | Nhật ký action của Copilot         |
| `/copilot/audit-logs`                   | Audit log của Copilot              |

## API chính

Các controller backend nằm trong `apps/api/src`:

- `POST /auth/login`, `GET /auth/me`
- `/students`
- `/courses`
- `/classes`
- `/enrollments`
- `/copilot/sessions`
- `/copilot/actions`
- `/copilot/audit-logs`

Frontend dùng `apps/web/src/lib/api-client.ts` để gắn `Authorization: Bearer <token>` từ local storage vào request.

## Kiểm tra trước khi bàn giao

Với thay đổi backend:

```bash
pnpm --filter api test
pnpm --filter api build
```

Với thay đổi frontend:

```bash
pnpm --filter web lint
pnpm --filter web build
```

Với thay đổi toàn repo:

```bash
pnpm lint
pnpm build
pnpm test
```

Build frontend có thể cần mạng trong lần đầu nếu Next.js phải tải font hoặc dependency phụ.

## Xử lý lỗi thường gặp

### API không kết nối được PostgreSQL

- Kiểm tra container bằng `docker compose ps`.
- Khi dùng Docker Compose của repo, `DATABASE_URL` phải dùng cổng host `5435`.
- Chạy lại `pnpm --filter api exec prisma generate` sau khi cài dependencies.
- Nếu schema chưa có trong database, chạy `pnpm --filter api exec prisma migrate deploy`.

### Frontend gọi sai API

- Kiểm tra `NEXT_PUBLIC_API_URL` trong `apps/web/.env.local`.
- Restart frontend sau khi đổi biến môi trường.

### Không đăng nhập được bằng tài khoản mẫu

- Đảm bảo đã chạy `pnpm --filter api exec prisma db seed`.
- Kiểm tra `.env` trỏ đúng database local.
- Lưu ý seed sẽ xóa dữ liệu hiện có trong database đang trỏ tới.

### Copilot không gọi được AI provider

- Kiểm tra `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL` (hoặc đặt `AI_PROVIDER="fallback"` để chạy không cần AI).
- Kiểm tra `AGENT_MINI_MODE` (mặc định `true`) nếu muốn bật/tắt phạm vi tool mini.
- Restart backend sau khi đổi `.env`.
- Nếu provider lỗi, backend trả message lỗi mềm cho user (không crash).

### Dữ liệu Copilot hoặc card cũ không đổi sau khi cập nhật giao diện

Nội dung assistant đã được lưu trong lịch sử chat. Hãy tạo phiên Copilot mới hoặc gửi lại yêu cầu để nhận response theo logic mới.

## Tài liệu bổ sung

- [Hướng dẫn setup chi tiết](docs/SetUp.md)
- [AI Agent Service Flow](docs/AiAgentServiceFlow.md)

## Bảo mật

- Không hardcode hoặc commit secret.
- Đổi `JWT_SECRET` trước khi deploy.
- Đổi hoặc tắt tài khoản admin mẫu trước khi chạy production.
- Giới hạn CORS bằng `FRONTEND_URL` phù hợp môi trường.
- Không chạy seed trên dữ liệu production.
- Mọi truy vấn nghiệp vụ phải giữ điều kiện `tenantId`.
