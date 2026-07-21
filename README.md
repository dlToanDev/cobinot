

Đây là monorepo dùng pnpm Workspaces và Turborepo, gồm frontend Next.js, backend NestJS và package TypeScript dùng chung.

## Mục Lục

- [Tính năng chính](#tính-năng-chính)
- [Công nghệ](#công-nghệ)
- [Cấu trúc dự án](#cấu-trúc-dự-án)
- [Yêu cầu môi trường](#yêu-cầu-môi-trường)
- [Cài đặt nhanh](#cài-đặt-nhanh)
- [Scripts](#scripts)
- [Database và Prisma](#database-và-prisma)
- [AI Copilot mini](#ai-copilot-mini)
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
- Quản lý ghi danh học viên theo khóa học (tự vào tất cả lớp đang hoạt động của khóa).
- AI Copilot mini: tạo/cập nhật học viên, khóa học, lớp học (WEEKLY/EXAM_PRACTICE), ghi danh học viên vào khóa (tất cả lớp ACTIVE) — mọi thao tác ghi đều qua preview → confirm; kèm tra cứu deterministic (tìm theo keyword, bảng danh sách học viên/lớp theo khóa hoặc toàn hệ thống, lọc lớp theo loại, phân trang 10 dòng/trang).
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

Copilot mini nhận yêu cầu tiếng Việt từ admin.

**Nghiệp vụ GHI dữ liệu** (đều qua preview → confirm, không ghi DB ngay):

1. Tạo học viên
2. Tạo khóa học
3. Tạo lớp học trong khóa — 2 loại: `WEEKLY` (học theo tuần), `EXAM_PRACTICE` (luyện đề)
4. Ghi danh học viên vào **khóa học** (`assign_student_to_course`) — tự thêm vào
   **TẤT CẢ lớp đang hoạt động (ACTIVE)** của khóa; không còn ghi danh theo lớp
5. Cập nhật học viên / khóa học / lớp học (`update_student`, `update_course`, `update_class`)
6. Gán giáo viên: "GV A cầm **khóa** X" (`assign_teacher_to_course`) — phụ trách
   **tất cả lớp ACTIVE** của khóa; "GV A cầm **lớp** B" — chỉ đổi giáo viên lớp
   đó (`update_class`)

**Nghiệp vụ TRA CỨU** (deterministic — chạy được cả khi AI lỗi/hết quota):

- Tìm học viên/khóa/lớp theo keyword; tìm học viên luôn trả **bảng danh sách**
  (kể cả khi chỉ 1 kết quả); nhiều kết quả cho phép chọn bằng số thứ tự ("1"),
  `ID: 93` hoặc tên/mã — chọn xong đi tiếp đúng mạch (ghi danh, xem danh
  sách...), không rơi xuống LLM.
- **Xem chi tiết**: "xem chi tiết lớp X" (thông số + ngày bắt đầu/kết thúc +
  lịch học từng buổi + danh sách học viên), "thông tin khóa Y" (số lớp/học
  viên + danh sách lớp), "chi tiết học viên Z" (hồ sơ + khóa & lớp đang học
  gom theo khóa). Hỗ trợ "lớp X khóa Y" khi trùng tên.
- **Click-để-xem**: bấm vào tên học viên/lớp/khóa trong bất kỳ bảng hoặc card
  nào của chat để mở chi tiết tương ứng — xử lý deterministic, phản hồi tức thì.
- Bảng học viên theo khóa/lớp hoặc **toàn hệ thống**, lọc theo tên/email/SĐT
  ("tìm học viên tuấn trong khóa X"), gộp 1 dòng/học viên (cột Lớp nối tên các
  lớp), phân trang 10 dòng/trang.
- Bảng lớp theo khóa hoặc toàn hệ thống, lọc theo **loại lớp** ("theo tuần"/
  "luyện đề"). Câu không nhắc tới khóa thì mặc định toàn hệ thống; muốn theo
  ngữ cảnh phải nói "khóa này".

**Domain ghi danh: chỉ MỘT cấp — khóa.** DB vẫn lưu `ClassEnrollment` theo lớp
(`UserCourse` là model legacy), nhưng "thêm vào khóa X" = ghi vào **tất cả lớp
`ACTIVE`** của khóa tại thời điểm confirm; chiều ngược lại **tạo lớp mới trong
khóa sẽ TỰ ĐỘNG thêm toàn bộ học viên của khóa vào lớp** nên 2 chiều luôn đồng bộ;
preview liệt kê danh sách lớp sẽ vào; lớp học viên đã có sẵn được skip. Chưa có
lớp `ACTIVE` → gợi ý tạo lớp trước. Nói "thêm A vào **lớp** B" → hệ thống suy
ra khóa của lớp B rồi ghi danh cả khóa. REST `POST /enrollments` cũng dùng đúng
logic này (không còn auto-tạo "lớp default"); endpoint thêm học viên vào 1 lớp
(`POST /classes/:id/students`) đã bị gỡ — lớp chỉ còn tạo/sửa/tìm kiếm-xem.

Xem chi tiết trong:

- [docs/AI_AGENT_ARCHITECTURE.md](docs/AI_AGENT_ARCHITECTURE.md) — kiến trúc AI agent hiện tại
- [docs/MANUAL_TEST_GHI_DANH_COPILOT.md](docs/MANUAL_TEST_GHI_DANH_COPILOT.md) — kịch bản test tay

### Scope

Trong mini mode (`AGENT_MINI_MODE=true`), các tool ngoài danh sách mini
(`delete_students`, `delete_courses`, `close_class`,
`remove_student_from_class`, `remove_student_from_course_classes`,
`get_class_students`) bị **ẩn khỏi LLM và bị chặn ở backend** (cả khi tạo
pending lẫn khi confirm; pending cũ chứa tool bị cấm sẽ bị hủy). Riêng
`assign_student_to_class` đã bị **xóa hẳn khỏi hệ thống**; pending cũ chứa tool
này khi confirm sẽ bị hủy kèm hướng dẫn ghi danh theo khóa. User yêu cầu
ngoài phạm vi sẽ nhận câu trả lời "Tính năng này chưa được bật trong bản
Copilot mini."

### Tool list (mini)

- READ: `search_student`, `get_student_detail`, `search_course`, `get_course_detail`, `get_course_classes`, `search_class`, `get_class_detail`
- WRITE: `create_student`, `create_course`, `create_class`, `update_student`, `update_course`, `update_class`, `assign_teacher_to_course`, `assign_student_to_course`
- Đặc biệt: `ask_clarification`

Danh sách này khớp 1-1 với `MINI_AGENT_TOOL_NAMES` trong
`apps/api/src/ai-agent/tool-definitions.ts`.

### Preview / Confirm flow

Mọi thao tác ghi dữ liệu đều đi qua:

```text
Tin nhắn người dùng
-> Load session state + lịch sử chat
-> DeterministicIntentService parse rule tiếng Việt trước (không tốn token);
   câu phức tạp/mơ hồ mới rơi xuống AgentRunnerService (LLM tool-calling)
-> READ tìm dữ liệu trả kết quả ngay; WRITE tạo pending_write
-> Backend lưu pending_action (kèm idempotency_key) + trả preview_card (KHÔNG ghi DB ở /turns)
-> User bấm Xác nhận -> POST /confirm { idempotencyKey } -> ToolRegistryService.execute -> service nghiệp vụ -> DB
-> User bấm Hủy -> POST /cancel -> clear pending_action, không ghi DB
```

Agent **không bao giờ tự execute** WRITE trong `/turns`. Confirm lặp lại với
cùng `idempotencyKey` (double-click) không ghi DB lần 2. Khi có `pending_action`,
FE khóa composer (phase `PREVIEW`) — user chỉ thao tác qua card Xác nhận/Hủy/sửa form.

### Session lifecycle

- `POST /copilot/sessions`: tạo session mới, state sạch.
- `GET /copilot/sessions/current`: lấy session ACTIVE mới nhất (tạo mới nếu chưa có / quá TTL).
- `PATCH /copilot/sessions/:id/close`: đóng session và clear `pending_action`/context.
- `PATCH /copilot/sessions/:id/title`: đổi tên phiên chat.
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
- [Kiến trúc AI Agent](docs/AI_AGENT_ARCHITECTURE.md)
- [Kịch bản test tay Copilot ghi danh](docs/MANUAL_TEST_GHI_DANH_COPILOT.md)

## Bảo mật

- Không hardcode hoặc commit secret.
- Đổi `JWT_SECRET` trước khi deploy.
- Đổi hoặc tắt tài khoản admin mẫu trước khi chạy production.
- Giới hạn CORS bằng `FRONTEND_URL` phù hợp môi trường.
- Không chạy seed trên dữ liệu production.
- Mọi truy vấn nghiệp vụ phải giữ điều kiện `tenantId`.
