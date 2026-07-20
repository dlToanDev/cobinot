# Tài liệu Kiến trúc AI Agent — Hxstu Copilot

> Cập nhật: 2026-07-20
> Module gốc: `apps/api/src/ai-agent/` + `apps/api/src/copilot/`

---

## 1. Tổng quan

Hệ thống AI Agent của Hxstu là một **chatbot nghiệp vụ** giúp quản trị viên thao tác với dữ liệu trung tâm đào tạo (học viên, khóa học, lớp học) bằng ngôn ngữ tự nhiên tiếng Việt.

Ba nguyên tắc thiết kế:

1. **Deterministic First, LLM Second** — câu lệnh nhận diện được bằng rule (tìm kiếm, tạo, ghi danh, xem danh sách, trả lời chọn từ danh sách) xử lý thẳng bằng code + database, không tốn token và **không chết khi AI lỗi/hết quota**. Chỉ câu phức tạp/mơ hồ mới gọi LLM tool-calling.
2. **WRITE luôn qua preview → confirm** — không tool ghi nào execute trong `/turns`. Turn chỉ tạo `pending_action` + preview card; user bấm Xác nhận (`/confirm`) mới ghi DB.
3. **Mạch hội thoại giữ ở backend (state machine)** — mọi câu hỏi chọn (chọn học viên/khóa/lớp trùng tên, nhập tên lớp còn thiếu...) đều lưu context vào session state để câu trả lời "1"/"ID: 93"/tên được xử lý deterministic, không rơi xuống LLM.

### Domain ghi danh: Khóa ≠ Lớp

**Course (khóa)** là chương trình học; **Class (lớp)** là lớp cụ thể mở trong khóa (có lịch, có status). Học viên **không ghi danh trực tiếp vào khóa** — mọi ghi danh đều là bản ghi `ClassEnrollment` gắn với một **lớp**:

```
"Ghi danh vào khóa" = chọn lớp ACTIVE trong khóa → tạo ClassEnrollment
```

- Tool `assign_student_to_course` chỉ là đường tắt: tìm lớp `ACTIVE` trong khóa → đúng 1 lớp thì ghi danh luôn; nhiều lớp thì trả `COURSE_HAS_MULTIPLE_CLASSES` để user chọn; không có lớp thì trả `COURSE_HAS_NO_ACTIVE_CLASS`.
- Chỉ lớp `status = ACTIVE` mới ghi danh được (guard nằm ở `CoursesService.addStudentToClass`; bước chọn lớp trong `assignStudentToCourse` cũng chỉ nhận `ACTIVE` để không fail muộn).
- **Không có enrollment cấp Course.** Model `UserCourse` là legacy, không còn là nguồn chân lý — nguồn chân lý là `ClassEnrollment`.
- UI/docs khi nói "ghi danh vào khóa" phải hiểu (và ghi rõ) là "chọn lớp trong khóa rồi ghi danh vào lớp".

---

## 2. Flow một turn chat

```
User message → POST /copilot/sessions/:id/turns
     │
     ▼
CopilotService.createTurn (orchestrator)
     │
     ├─ 1. pending_action + "ok/hủy"           → confirm() / cancel()
     ├─ 2. duplicate_student_context           → state machine trùng email/SĐT
     ├─ 3. pending_enrollment_context          → chọn học viên / KHÓA / lớp để ghi danh tiếp
     ├─ 4. pending_class_creation              → trả lời tên khóa / tên lớp khi tạo lớp
     ├─ 5. last_candidates.courses (safety net)→ "1"/"ID 93"/tên → chốt khóa; nếu có
     │      pending_course_choice thì trả LUÔN bảng danh sách (không dừng ở "đã chọn")
     ├─ 6. pending_action + user chat bổ sung  → merge vào bản nháp (draft patch)
     ├─ 7. DeterministicIntentService.resolve  → rule tiếng Việt (không LLM)
     ├─ 8. AgentRunnerService.run              → LLM tool-calling (READ loop / WRITE pending)
     └─ 9. LLM lỗi/hết quota                   → deterministic.fallbackSearch (tìm thẳng DB)
     │
     ▼
pending_write → lưu pending_action + preview_card   ← CHƯA ghi DB
     │
User bấm Confirm → POST .../confirm
     │
     ├─ idempotency: double-click không ghi 2 lần; key cũ (bản nháp đã thay) bị chặn
     ├─ guard mini mode: pending chứa tool bị cấm → hủy
     ├─ validatePendingRequired: thiếu field bắt buộc → trả validation_error, GIỮ pending
     ▼
ToolRegistryService.execute → UsersService / CoursesService → Prisma → DB
     └─ lỗi ghi danh (nhiều lớp / đã ghi danh / không có lớp ACTIVE) → handleConfirmError
```

`validatePendingRequired` cover: `create_student` (fullName), `create_course` (title), `create_class` (courseId + title + classType), `assign_student_to_class` (userId/userIds + classId), `assign_student_to_course` (userId + courseId; classId KHÔNG bắt buộc — execute tự resolve lớp).

---

## 3. Cấu trúc file

```
apps/api/src/
├── ai/                          # AI provider adapter (OpenAI-compatible)
│   └── providers/openai-compatible.provider.ts   # fetch + timeout + retry, stream:false
├── ai-agent/
│   ├── decision.types.ts        # AiToolName (22 tool), DecisionContext, PendingAction,
│   │                            #   PendingEnrollmentContext, pending_course_choice...
│   ├── tool-definitions.ts      # Schema tool cho LLM; FULL vs MINI list; guard mini mode
│   ├── agent-context-builder.service.ts  # Build system prompt (rule domain, ví dụ)
│   ├── agent-runner.service.ts  # Vòng lặp LLM: READ execute ngay, WRITE trả pending
│   ├── tool-executor.service.ts # Thực thi READ tools
│   ├── tool-registry.service.ts # Thực thi WRITE tools (sau confirm) + audit log
│   ├── deterministic-intent.service.ts   # Rule tiếng Việt (fast path, no LLM)
│   └── agent-formatters.ts      # Format danh sách candidates / kết quả đọc
└── copilot/
    └── copilot.service.ts       # Orchestrator: turn, confirm/cancel, state machines
```

---

## 4. DeterministicIntentService — fast path

Nhận diện và xử lý **không cần LLM**:

| Nhóm | Ví dụ câu | Xử lý |
| --- | --- | --- |
| Tìm kiếm | "tìm học viên An" | search DB, trả danh sách candidates (chọn được bằng số/ID/tên) |
| Tạo học viên | "tạo học viên Nguyễn A, a@gmail.com" | parse tên/email/SĐT/ngày sinh/địa chỉ → preview |
| Tạo khóa / lớp | "tạo lớp Test33 trong khóa X" | resolve khóa (theo tên hoặc ngữ cảnh) → preview; thiếu tên thì hỏi và LƯU draft |
| Ghi danh | "thêm A vào lớp/khóa X", "thêm A, B và C vào lớp X" | resolve học viên (1 người/gộp nhiều người) + đích → preview hoặc hỏi chọn |
| Xem DS học viên | "xem ds học viên khóa X", "tìm học viên tuấn trong khóa X", "tìm tất cả học viên" | bảng `student_table`: theo khóa/lớp/**toàn hệ thống**, lọc keyword tên/email/SĐT, gộp 1 dòng/học viên |
| Xem DS lớp | "xem ds lớp khóa X", "ds lớp theo tuần trong cả hệ thống" | bảng `class_table`: theo khóa/**toàn hệ thống**, lọc **loại lớp** (WEEKLY/EXAM_PRACTICE) |
| Cập nhật | "sửa tên lớp X thành Y", "chuyển lớp X sang luyện đề" | preview update_class (đổi đúng field, không đụng field khác) |

Quy tắc ngữ cảnh quan trọng:

- **Không nhắc tới khóa → không tự lấy khóa ngữ cảnh.** "xem ds lớp luyện đề" = toàn hệ thống; muốn theo ngữ cảnh phải nói "khóa này".
- `resolveContextCourse` ưu tiên `selected_course_id`, và chỉ dùng label của option khi đúng id (tránh ghép id mới với tên khóa cũ).
- Khi khóa được nhắc tới nhưng chưa có lớp (`COURSE_HAS_NO_ACTIVE_CLASS` hoặc nhánh "khóa chưa có lớp nào"), khóa đó được ghi vào `selected_course_id`/`last_selected_course` để câu tiếp theo "tạo lớp trong khóa này" trỏ đúng khóa.

### Nhiều kết quả trùng tên → state machine, KHÔNG rơi xuống LLM

| Tình huống | Context lưu | Lượt trả lời "1"/"ID 93"/tên |
| --- | --- | --- |
| Nhiều HỌC VIÊN trùng tên khi ghi danh | `pending_enrollment_context.candidateStudents` (+ đích ghi danh gốc) | chọn 1 hoặc nhiều ("1,3,5") → đi tiếp đích ghi danh |
| Nhiều KHÓA trùng tên khi ghi danh | `pending_enrollment_context.candidateCourses` (+ học viên đã resolve) | chốt khóa → liệt kê lớp: 1 lớp → preview luôn; nhiều → chọn lớp |
| Nhiều LỚP trùng tên | `pending_enrollment_context.candidateClasses` | chốt lớp → preview `assign_student_to_class` |
| Nhiều KHÓA khi xem danh sách | `last_candidates.courses` + `pending_course_choice` (intent gốc + keyword/loại lớp) | chốt khóa → trả **luôn** bảng học viên/lớp (`listCourseStudents` / `listCourseClasses`) |
| Danh sách khóa từ nguồn bất kỳ (kể cả LLM) | `last_candidates.courses` | safety net trong CopilotService: chốt khóa + gợi ý bước tiếp |

`resolveClassChoice` (CopilotService) hiểu: số thứ tự ("1", "số 2", "khóa 2"), `ID: 93`/`id 93`, tên hoặc `classCode`/`courseCode`.

---

## 5. AgentRunnerService — vòng lặp LLM

- Build system prompt từ `AgentContextBuilderService` (rule domain: ghi danh luôn ở cấp lớp, ví dụ few-shot, context phiên).
- Loop tool-calling: **READ tool execute ngay** (kết quả đưa lại vào messages), **WRITE tool dừng loop** trả `pending_write` (không execute). `ask_clarification` trả clarification.
- `contextPatchFromReadResult`: kết quả READ được ghi vào state — `search_course` ra đúng 1 khóa → set `last_selected_course`/`selected_course_id`; `get_course_classes` → set `selected_course_id`; các search khác → `last_candidates`.
- `sanitizeModelText`: chặn model "bịa" đã ghi thành công khi chưa execute write nào.
- LLM lỗi/hết quota → `llmUnavailable` → CopilotService gọi `fallbackSearch` (tìm thẳng DB, message có tiền tố "AI đang tạm hết quota...").

---

## 6. ToolRegistryService — thực thi WRITE (sau confirm)

- Map tool → service nghiệp vụ (`UsersService`, `CoursesService`, `EnrollmentsService`) — không gọi Prisma trực tiếp cho nghiệp vụ.
- `assignStudentToCourse`: validate học viên + khóa → check đã ghi danh (query `ClassEnrollment` qua khóa) → resolve lớp **ACTIVE** (0 lớp → `COURSE_HAS_NO_ACTIVE_CLASS`; >1 → `COURSE_HAS_MULTIPLE_CLASSES` kèm danh sách lớp) → `addStudentToClass`.
- Ghi `AiAgentAction` + `AiAgentAuditLog` cho mọi write để truy vết.

---

## 7. Tool list

22 tool (`AiToolName` trong `decision.types.ts`):

- **READ**: `search_student`, `get_student_detail`, `search_course`, `get_course_detail`, `get_course_classes`, `search_class`, `get_class_detail`, `get_class_students`
- **WRITE**: `create_student`, `update_student`, `delete_students`, `create_course`, `update_course`, `delete_courses`, `create_class`, `update_class`, `close_class`, `assign_student_to_class`, `assign_student_to_course`, `remove_student_from_class`, `remove_student_from_course_classes`
- **Đặc biệt**: `ask_clarification`

### Mini mode (`AGENT_MINI_MODE`, mặc định true)

`MINI_AGENT_TOOL_NAMES` = 7 READ + `create_student|create_course|create_class|update_student|update_course|update_class|assign_student_to_class` + `ask_clarification`.

Guard 3 lớp: (1) chỉ expose tool mini cho LLM; (2) `assertToolAllowedInCurrentMode` chặn ở backend khi tạo pending; (3) confirm chặn + hủy pending cũ chứa tool bị cấm.

---

## 8. Session state (DecisionContext) — các field chính

| Field | Vai trò |
| --- | --- |
| `pending_action` | WRITE đang chờ confirm (kèm `idempotency_key`) |
| `last_executed_idempotency_key` | chống double-submit: confirm lặp lại trả idempotent |
| `pending_clarification` | câu hỏi đang chờ trả lời (missing_fields) |
| `pending_enrollment_context` | mạch ghi danh: `userId/userIds`, `candidateStudents`, `candidateCourses`, `candidateClasses`, đích gốc |
| `pending_course_choice` | intent gốc khi hỏi chọn khóa lúc XEM DANH SÁCH (`list_students`/`list_classes` + `studentKeyword`/`classKeyword`/`classType`) |
| `pending_class_creation` | draft tạo lớp (khóa/tên/loại/ngày) chờ bổ sung |
| `duplicate_student_context` | phát hiện trùng email/SĐT khi tạo học viên |
| `selected_course_id` / `last_selected_course` / `last_created_course` | khóa trong ngữ cảnh ("khóa này") |
| `selected_class_id` / `last_selected_class` / `last_created_class` | lớp trong ngữ cảnh |
| `last_candidates` | danh sách students/courses/classes vừa hiển thị để chọn |

---

## 9. Frontend (`apps/web/src/app/copilot/`)

- `page.tsx` — trang chat: render các response type (`preview_card`, `tool_result`, `clarification`, `student_table`, `class_table`, `text_message`...), gọi API turns/confirm/cancel.
- `CopilotUI.tsx` — khung chat, card kết quả, suggestions.
- `EditablePreviewCard.tsx` — preview card chỉnh sửa được trước khi Confirm (đổi field ngay trên form).
- `ResultBlocks.tsx` — `StudentTableBlock` / `ClassTableBlock`: bảng danh sách với header + đếm số lượng, badge loại lớp & trạng thái (không gãy dòng), mã lớp/ID xuống dòng phụ, **phân trang client-side 10 dòng/trang** (`TABLE_PAGE_SIZE`, dùng chung `TableHeader`/`TablePagination`).

Khi có `pending_action`, composer bị khóa (phase PREVIEW) — user chỉ thao tác qua card Xác nhận/Hủy/sửa form.

---

## 10. Cấu hình & kiểm thử

Env chính (xem `.env.example`): `AI_PROVIDER`, `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`, `AI_TIMEOUT_MS`, `AI_MAX_RETRIES`, `AI_MAX_TOKENS`, `AI_ENABLE_FALLBACK`, `AGENT_MINI_MODE`, `COPILOT_SESSION_TTL_HOURS`.

Test:

```bash
pnpm --filter api test          # toàn bộ
npx jest copilot.service.spec deterministic-intent.service.spec agent-runner.service.spec
```

Ba suite trên cover: preview/confirm/idempotency, validate pending, state machine chọn học viên/khóa/lớp, continuation xem danh sách, parser tiếng Việt (ghi danh, tạo lớp, xem danh sách + lọc loại lớp/hệ thống), guard mini mode, fallback quota.

Kịch bản test tay: [MANUAL_TEST_GHI_DANH_COPILOT.md](./MANUAL_TEST_GHI_DANH_COPILOT.md).
