
# Plan: Làm lại luồng ghi danh — "Thêm vào khóa" = vào TẤT CẢ lớp trong khóa

> Ngày tạo: 2026-07-20 · Sửa: 2026-07-21
> Trạng thái: CHỜ DUYỆT (chưa code)
> Quyết định gốc: **xóa hẳn "thêm học viên vào lớp" trên TOÀN HỆ THỐNG**
> (Copilot + REST + UI quản trị). Ghi danh chỉ còn một cấp duy nhất: **khóa**
> → tự ghi vào **tất cả lớp ACTIVE** của khóa. Với **lớp** chỉ giữ lại:
> tạo lớp, sửa lớp, tìm kiếm/xem lớp.

---

## Phạm vi & nguyên tắc

- Áp dụng **toàn hệ thống**, không chỉ Copilot:
  - **Copilot**: xóa tool `assign_student_to_class`.
  - **REST**: xóa endpoint `POST /classes/:id/students` (thêm HV vào lớp);
    `POST /enrollments` (ghi danh khóa) sửa lại để ghi vào **tất cả lớp
    ACTIVE** thay vì 1 lớp default như hiện tại.
  - **UI quản trị**: xóa nút/modal "+ Thêm học viên" ở trang chi tiết lớp;
    trỏ người dùng sang trang ghi danh theo khóa (`/enrollments/[courseId]`).
- Thao tác với **lớp** chỉ còn (cả Copilot lẫn REST/UI): **tạo**
  (`create_class`), **sửa** (`update_class`, `close_class`), **tìm kiếm/xem**
  (`search_class`, `get_class_detail`, `get_class_students`,
  `get_course_classes`).
- `assign_student_to_course` trở thành **tool ghi danh duy nhất** của agent,
  ngữ nghĩa mới: ghi vào **tất cả lớp ACTIVE** tại thời điểm confirm.
- `assign_student_to_class` bị **XÓA HOÀN TOÀN**: xóa tool definition, executor
  trong registry, case validate, title UI — không giữ lại gì. Session cũ còn
  pending tool này → tự hủy pending với message thân thiện; lịch sử cũ render
  title fallback chung ("Thao tác không còn hỗ trợ").
- Mọi thứ vẫn qua **preview → confirm**; preview BẮT BUỘC liệt kê danh sách
  lớp sẽ vào (chốt an toàn khi 1 confirm tạo N bản ghi).
- Gỡ học viên khỏi lớp (`remove_student_from_class`,
  `DELETE /classes/:id/students/:studentId`) **tạm giữ** để xử lý ngoại lệ —
  xem mục "điểm cần chốt".

---

## Phase 1 — Tầng thực thi (nền tảng, làm trước)

### `apps/api/src/ai-agent/tool-registry.service.ts` — viết lại `assignStudentToCourse`

1. Validate học viên + khóa (giữ nguyên).
2. Lấy lớp `ACTIVE` của khóa; 0 lớp → `COURSE_HAS_NO_ACTIVE_CLASS` (giữ nguyên).
3. **Bỏ** nhánh `COURSE_HAS_MULTIPLE_CLASSES` và bỏ param `classId` — không còn
   chọn lớp.
4. Đổi check "đã ghi danh": chỉ lỗi `STUDENT_ALREADY_ASSIGNED_TO_COURSE` khi đã
   có mặt ở **tất cả** lớp ACTIVE.
5. Loop từng lớp: đã có `ClassEnrollment` → đánh dấu `skippedExisting`; chưa có
   → `CoursesService.addStudentToClass` (vẫn qua service nghiệp vụ, không
   Prisma trực tiếp). Trả `{ enrolled[], skippedExisting[], course, student }`.
6. Hỗ trợ **bulk** (`userIds`): users × classes, kết quả per-user-per-class.
7. **Xóa executor `assignStudentToClass`** khỏi registry (không còn tool nào
   gọi tới).

> Logic "ghi 1 user vào tất cả lớp ACTIVE của khóa" nên tách thành **một hàm
> dùng chung** (vd `enrollUserToAllActiveClasses` trong `CoursesService`) để
> cả tool registry lẫn REST `POST /enrollments` cùng gọi — tránh 2 bản copy.

### `apps/api/src/enrollments/enrollments.service.ts` — REST ghi danh khóa

- `create` (đằng sau `POST /enrollments`): **bỏ** logic tìm/tự tạo "default
  class" rồi ghi 1 `ClassEnrollment` duy nhất; thay bằng gọi hàm dùng chung
  ghi vào **tất cả lớp ACTIVE**.
- Khóa 0 lớp ACTIVE → trả lỗi yêu cầu tạo lớp trước (bỏ auto-create default
  class — xem điểm cần chốt #6), nhất quán với `COURSE_HAS_NO_ACTIVE_CLASS`
  bên Copilot.
- Response đổi sang dạng per-class `{ enrolled[], skippedExisting[] }`;
  cập nhật `enrollments.controller.ts` + DTO tương ứng.

### `apps/api/src/courses/classes.controller.ts` — gỡ endpoint thêm HV vào lớp

- **Xóa** route `POST /classes/:id/students` + `AddStudentToClassDto`
  (file dto xóa luôn nếu không còn ai dùng).
- `CoursesService.addStudentToClass` hạ xuống thành helper nội bộ cho hàm
  ghi-cả-khóa (không còn controller nào expose).
- Giữ `GET /classes/:id/students` (xem danh sách) và
  `DELETE /classes/:id/students/:studentId` (gỡ HV — xem điểm cần chốt).

### `apps/api/src/copilot/copilot.service.ts` — phía confirm

- `buildToolResultMessage` case `assign_student_to_course`: message mới liệt kê
  từng lớp (*"Đã thêm vào 2 lớp: A, B · 1 lớp đã có sẵn: C"*).
- `handleConfirmError`: xóa nhánh `COURSE_HAS_MULTIPLE_CLASSES` → clarification
  chọn lớp — không còn phát sinh.
- `validatePendingRequired`: giữ case `assign_student_to_course`
  (userId + courseId, không bắt classId); **xóa luôn** case
  `assign_student_to_class`.
- Confirm gặp pending `assign_student_to_class` cũ (session trước khi deploy):
  hủy pending + trả message *"Thao tác ghi danh theo lớp không còn hỗ trợ —
  hãy thêm học viên vào khóa"* thay vì thực thi.

---

## Phase 2 — Deterministic (rule tiếng Việt)

### `apps/api/src/ai-agent/deterministic-intent.service.ts`

1. `enrollIntoResolvedCourse`: bỏ logic "1 lớp → preview class / nhiều lớp →
   hỏi chọn". Thay bằng: có ≥1 lớp ACTIVE → build pending
   `assign_student_to_course` với `display_input.classes = [danh sách lớp]`,
   summary *"Ghi danh A vào N lớp của khóa X: …"*. 0 lớp → message gợi ý tạo
   lớp (giữ nguyên, đã có patch context khóa).
2. **Câu "thêm A vào lớp B"** (parseEnroll target class): resolve lớp B → suy
   ra khóa của nó → đi vào `enrollIntoResolvedCourse` của khóa đó; message
   preview nói rõ *"Hệ thống ghi danh theo khóa: A sẽ vào tất cả N lớp của
   khóa Y (gồm lớp B)"*. Nhiều lớp trùng tên B → vẫn hỏi chọn lớp **chỉ để
   xác định khóa**.
3. Dọn state machine: `pending_enrollment_context.candidateClasses` chỉ còn
   dùng cho case 2 (chọn lớp để suy khóa); `candidateStudents` /
   `candidateCourses` giữ nguyên, đích sau khi chọn đổi thành enroll-cả-khóa.
4. `buildEnrollPending`: đổi sang build tool `assign_student_to_course`
   (không còn classId đơn).
5. Suggestions (`buildPostCreateSuggestions` bên copilot.service): "vừa tạo
   lớp → thêm HV vào **lớp**" đổi thành "thêm HV vào **khóa** (tất cả lớp)";
   action đổi tool tương ứng.

---

## Phase 3 — LLM path + mini mode

### `apps/api/src/ai-agent/tool-definitions.ts`

- **Xóa hẳn definition** `assign_student_to_class` (schema + description);
  `MINI_AGENT_TOOL_NAMES` thay bằng `assign_student_to_course`.
- Gỡ `assign_student_to_class` khỏi `decision.types.ts` (union tool name) và
  mọi type/map liên quan.
- Description tool `assign_student_to_course` viết lại: "Ghi danh học viên vào
  khóa — tự thêm vào TẤT CẢ lớp ACTIVE".

### `apps/api/src/ai-agent/agent-context-builder.service.ts`

- Xóa rule "Ghi danh LUÔN ở cấp LỚP, hỏi lại lớp cụ thể"; thay bằng rule mới +
  ví dụ few-shot mới ("Thêm An vào khóa IELTS" → gọi `assign_student_to_course`
  luôn, không hỏi lớp).

### `apps/api/src/ai-agent/agent-runner.service.ts`

- `summarizeWriteTool`: *"Ghi danh học viên #X vào khóa #Y (tất cả lớp đang
  hoạt động)"*.

---

## Phase 4 — Frontend + dọn dẹp

### UI quản trị (trang lớp + trang ghi danh)

- `apps/web/src/app/courses/[courseId]/classes/[classId]/page.tsx`: **xóa**
  nút "+ Thêm học viên", modal chọn học viên và call
  `POST /classes/:id/students`; tab "Học viên" chỉ còn xem danh sách + gỡ.
  Thêm hint/link *"Thêm học viên tại trang ghi danh khóa"* trỏ sang
  `/enrollments/[courseId]`.
- `apps/web/src/app/enrollments/[courseId]/page.tsx`: form ghi danh nói rõ
  *"Học viên sẽ được thêm vào tất cả N lớp đang hoạt động của khóa"* — hiển
  thị danh sách lớp trước khi xác nhận; kết quả hiển thị per-class
  (Đã thêm / Đã có sẵn) theo response mới.

### Copilot UI

- `apps/web/src/app/copilot/EditablePreviewCard.tsx`: title "Ghi danh vào khóa
  học (tất cả lớp trong khóa)"; render **danh sách lớp đích** read-only từ
  `display_input.classes`; bỏ field chọn lớp.
- `apps/web/src/app/copilot/page.tsx` + `ResultBlocks.tsx`: card kết quả ghi
  danh hiển thị per-class (Đã thêm / Đã có sẵn); title "Đã ghi danh vào N lớp
  trong khóa".
- `apps/web/src/app/copilot/CopilotUI.tsx`: title kết quả tương ứng; **xóa**
  title/case `assign_student_to_class` — lịch sử session cũ rơi vào title
  fallback chung (kiểm tra đã có fallback cho tool name lạ, chưa có thì thêm).
- Xóa mọi đường sinh `assign_student_to_class` còn sót (suggestion,
  `pendingActionFromSuggestion`, quick action nếu có) và mọi tham chiếu trong
  `EditablePreviewCard.tsx` / `page.tsx`. Sau bước này grep toàn repo
  `assign_student_to_class` chỉ còn khớp ở test hủy-pending-cũ (nếu có).

---

## Phase 5 — Test + docs

### Unit test

- Sửa/viết lại (~10-12 test hiện có) trong `deterministic-intent.service.spec.ts`
  + `copilot.service.spec.ts`: các test "1 lớp → assign_student_to_class",
  "nhiều lớp → chọn lớp", multi-class clarification sau confirm.
- Test mới:
  - Registry ghi đủ N lớp ACTIVE.
  - Skip lớp học viên đã có sẵn, vẫn ghi lớp còn lại.
  - Bỏ qua lớp CLOSED/không ACTIVE.
  - Đã có mặt ở tất cả lớp → `STUDENT_ALREADY_ASSIGNED_TO_COURSE`.
  - Khóa 0 lớp ACTIVE → `COURSE_HAS_NO_ACTIVE_CLASS`.
  - Bulk nhiều học viên × nhiều lớp.
  - "Thêm A vào lớp B" → chuyển hướng sang khóa của B, preview liệt kê đủ lớp.
  - Confirm message liệt kê per-class.
  - Pending `assign_student_to_class` cũ → confirm bị hủy kèm message hướng
    sang ghi danh theo khóa (không thực thi).
  - `tool-definitions.spec.ts` / `agent-runner.service.spec.ts`: cập nhật —
    tool `assign_student_to_class` không còn tồn tại.
  - `enrollments.service.spec.ts` / `enrollments.controller.spec.ts`:
    `POST /enrollments` ghi đủ N lớp ACTIVE, skip lớp đã có, bỏ aut
    -create
    default class (khóa 0 lớp → lỗi), response per-class.
  - Controller test: `POST /classes/:id/students` không còn tồn tại (404).

### Docs

- `docs/AI_AGENT_ARCHITECTURE.md`: sửa mục "Domain ghi danh" — sơ đồ mới:
  `khóa → TẤT CẢ lớp ACTIVE → N ClassEnrollment`.
- `README.md`: mục AI Copilot mini — đổi tool list + mô tả hành vi ghi danh.
- `docs/MANUAL_TEST_GHI_DANH_COPILOT.md`: viết lại nhóm TC ghi danh (case
  chuẩn: khóa 3 lớp ACTIVE + 1 CLOSED → confirm xong soi `ClassEnrollment`
  phải có đúng 3 bản ghi mới). Thêm nhóm TC cho REST/UI quản trị: trang chi
  tiết lớp không còn nút thêm học viên; ghi danh từ `/enrollments/[courseId]`
  tạo đủ bản ghi cho mọi lớp ACTIVE.

---

## Rủi ro / điểm cần chốt trước khi làm

1. **Ngược brief cũ của leader** ("ghi danh luôn ở cấp lớp, hỏi lại lớp cụ
   thể") — đây là đổi domain, không phải bug fix. **Cần leader duyệt trước khi
   bắt đầu Phase 2.**
2. **1 confirm = N bản ghi** — preview liệt kê danh sách lớp là chốt an toàn
   bắt buộc, không phải nice-to-have.
3. **Session cũ** còn pending/lịch sử `assign_student_to_class`: tool bị xóa
   hẳn nên confirm cũ KHÔNG được thực thi — hủy pending + message hướng sang
   ghi danh theo khóa; lịch sử chat cũ render bằng title fallback, chấp nhận
   hiển thị chung chung (đã chốt đánh đổi này khi quyết định xóa hẳn tool).
4. "Tất cả lớp" = lớp ACTIVE **tại thời điểm confirm** — lớp mở sau này KHÔNG
   tự có học viên, phải ghi danh bổ sung (ghi rõ trong docs tránh hiểu nhầm).
5. Field phụ (`joinedAt`, `expireDate`, `note`) áp **chung cho mọi lớp**.
6. **`POST /enrollments` hiện tự tạo "default class"** khi khóa chưa có lớp
   rồi ghi vào đó. Plan đề xuất **bỏ** hành vi này (khóa 0 lớp → lỗi, yêu cầu
   tạo lớp trước) để nhất quán với Copilot — nhưng đây là breaking change cho
   client đang dựa vào auto-create. **Cần chốt trước Phase 1.**
7. **Gỡ học viên khỏi lớp** (`remove_student_from_class`,
   `remove_student_from_course_classes`, `DELETE /classes/:id/students/:id`)
   đề xuất **giữ nguyên** để xử lý ngoại lệ (HV nghỉ 1 lớp nhưng vẫn học lớp
   khác). Nếu muốn gỡ cũng theo cấp khóa luôn thì báo lại để mở rộng plan.

## Thứ tự thực hiện

Phase 1 → 2 → 3 → 4 → 5. Sau mỗi phase chạy lại 3 suite:

```bash
cd apps/api
npx jest copilot.service.spec deterministic-intent.service.spec agent-runner.service.spec enrollments.service.spec enrollments.controller.spec
```

Ước lượng khối lượng: ~9 file backend (thêm `enrollments.service.ts`,
`enrollments.controller.ts`, `classes.controller.ts`, `decision.types.ts`),
~5 file frontend (thêm trang chi tiết lớp + trang ghi danh khóa),
3 file docs, ~25-30 test sửa/mới.
