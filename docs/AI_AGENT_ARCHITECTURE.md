# Tài liệu Kiến trúc AI Agent — Hxstu Copilot

> Cập nhật: 2026-07-14  
> Module gốc: `apps/api/src/ai-agent/`

---

## 1. Tổng quan

Hệ thống AI Agent của Hxstu là một **chatbot nghiệp vụ** giúp quản trị viên thao tác với dữ liệu trung tâm đào tạo (học viên, khóa học, lớp học) bằng ngôn ngữ tự nhiên tiếng Việt.

Kiến trúc được thiết kế theo nguyên tắc **"Deterministic First, LLM Second"**:
- Câu lệnh đơn giản (tìm kiếm, tạo với đủ thông tin) → xử lý bằng code regex (không tốn token LLM)
- Câu lệnh phức tạp / thiếu thông tin → mới gọi LLM với tool-calling

```
User Message
     │
     ▼
┌─────────────────────────────┐
│  CopilotService (orchestrator) │
└─────────────┬───────────────┘
              │
     ┌────────▼────────┐     ┌─────────────────────────┐
     │  Deterministic   │────▶│  DeterministicIntentSvc │  (fast path, no LLM)
     │  Intent Check    │     └─────────────────────────┘
     └────────┬────────┘
              │ null (không xử lý được)
              ▼
     ┌────────────────┐      ┌───────────────────────────┐
     │  AgentRunner   │─────▶│  AgentContextBuilderSvc   │  (system prompt)
     │  Service (LLM) │      └───────────────────────────┘
     └───────┬────────┘
             │ tool_call
     ┌───────▼────────┐
     │ READ  │ WRITE  │
     │ tool  │ tool   │
     └───┬───┴───┬────┘
         │       │
┌────────▼──┐  ┌─▼──────────────────┐
│ToolExecutor│  │ToolRegistryService  │  (WRITE = pending, user confirms)
│ Service    │  │ (audit log + DB)    │
└────────────┘  └────────────────────┘
```

---

## 2. Cấu trúc file

```
apps/api/src/ai-agent/
├── ai-agent.module.ts              # NestJS Module, wires tất cả services
├── decision.types.ts               # Tất cả TypeScript types/interfaces chung
├── agent-context-builder.service.ts # Xây dựng system prompt cho LLM
├── agent-runner.service.ts         # Vòng lặp LLM chính (tool-calling loop)
├── tool-executor.service.ts        # Thực thi READ tools (không ghi DB)
├── tool-registry.service.ts        # Thực thi WRITE tools (ghi DB + audit log)
├── tool-definitions.ts             # Schema định nghĩa tools cho LLM (OpenAI format)
├── deterministic-intent.service.ts # Xử lý intent không cần LLM (regex/heuristic)
├── agent-formatters.ts             # Format kết quả thành text tiếng Việt
├── data/                           # Dữ liệu tĩnh (nếu có)
├── dto/                            # DTO cho API
└── utils/                          # Utilities
```

---

## 3. File chi tiết

### 3.1. `ai-agent.module.ts` — Module chính

**Vai trò:** NestJS Module khai báo và kết nối tất cả services của AI Agent.

```typescript
@Module({
  imports: [AiModule, UsersModule, CoursesModule, EnrollmentsModule],
  providers: [
    AgentContextBuilderService,
    AgentRunnerService,
    DeterministicIntentService,
    ToolExecutorService,
    ToolRegistryService,
  ],
  exports: [AgentRunnerService, ToolRegistryService, DeterministicIntentService],
})
export class AiAgentModule {}
```

| Import | Mục đích |
|--------|----------|
| `AiModule` | Provider LLM (OpenAI-compatible API) |
| `UsersModule` | CRUD học viên |
| `CoursesModule` | CRUD khóa học + lớp học |
| `EnrollmentsModule` | Ghi danh học viên |

**Chỉ 3 service được export** sang `CopilotModule`:
- `AgentRunnerService` — để gọi LLM
- `ToolRegistryService` — để confirm/execute WRITE tool
- `DeterministicIntentService` — để fast-path xử lý intent

---

### 3.2. `decision.types.ts` — Kiểu dữ liệu chung

**Vai trò:** Single source of truth cho tất cả types. Không có logic, chỉ định nghĩa interfaces.

#### AiToolName — Danh sách 22 tools

```
READ tools (8):              WRITE tools (13):              Đặc biệt (1):
─────────────                ────────────────               ─────────────
search_student               create_student                 ask_clarification
get_student_detail           update_student
search_course                delete_students
get_course_detail            create_course
get_course_classes           update_course
search_class                 delete_courses
get_class_detail             create_class
get_class_students           update_class
                             close_class
                             assign_student_to_class
                             assign_student_to_course
                             remove_student_from_class
                             remove_student_from_course_classes
```

#### AiIntent
Superset của `AiToolName`, thêm: `'confirm' | 'cancel' | 'unknown'`

#### EntityOption — Entity đã được resolve
```typescript
interface EntityOption {
  id: number;        // ID trong DB
  value: number;     // Alias của id (dùng cho UI)
  label: string;     // Tên hiển thị
  description: string; // Thông tin phụ (phone | email | code)
  metadata: unknown; // Row gốc từ DB
}
```

#### PendingAction — WRITE tool đang chờ user confirm
```typescript
interface PendingAction {
  tool_name: AiToolName;
  input: Record<string, unknown>;     // Input thực sự sẽ gửi lên DB
  display_input?: Record<string, unknown>; // Hiển thị cho user
  summary: string;                    // Text mô tả ngắn
  intent: AiIntent;
  status?: 'waiting_more_info' | 'waiting_confirm';
  severity?: 'default' | 'danger';    // 'danger' cho delete/close
  idempotency_key?: string;           // Chống double-submit
}
```

#### PendingClarification — Hỏi thêm thông tin
```typescript
interface PendingClarification {
  type?: 'missing_fields' | 'target_disambiguation';
  intent?: AiIntent | string;
  missing_fields: string[];
  message?: string;
}
```

#### Các context đặc biệt

| Type | Khi nào dùng |
|------|-------------|
| `DuplicateStudentContext` | Email/SĐT đã tồn tại khi tạo học viên mới |
| `PendingEnrollmentContext` | User ghi danh vào khóa, hệ thống cần chọn lớp |
| `PendingClassCreationContext` | Đang tạo lớp nhưng chưa có courseId hoặc title |

#### DecisionContext — Trạng thái phiên chat (lưu DB)
```typescript
interface DecisionContext {
  last_intent?: AiIntent;
  
  // Entity đang được chọn/vừa tạo
  selected_student_id?, selected_course_id?, selected_class_id?
  last_selected_student?, last_selected_course?, last_selected_class?
  last_created_student?, last_created_course?, last_created_class?
  
  // Danh sách ứng viên từ lần search gần nhất
  last_candidates?: { students?, courses?, classes? }
  
  // Các trạng thái đặc biệt
  pending_action?           // WRITE tool chờ confirm
  pending_clarification?    // Đang hỏi thêm info
  duplicate_student_context?
  pending_enrollment_context?
  pending_class_creation?
  
  last_executed_idempotency_key? // Chống double-submit
}
```

---

### 3.3. `agent-context-builder.service.ts` — Xây dựng System Prompt

**Vai trò:** Chuyển `DecisionContext` thành system prompt dạng text để gửi cho LLM.

**Method duy nhất:** `buildSystemPrompt(context: DecisionContext): string`

#### Cấu trúc system prompt được build

```
[1] Nếu MINI MODE: chèn phần giới hạn 7 nghiệp vụ ở đầu

[2] Identity + Quy tắc cốt lõi
    - Không bịa ID, email, SĐT
    - Dùng READ tool trước khi WRITE
    - WRITE tool chỉ tạo preview, không ghi DB ngay

[3] Quy tắc tạo học viên
    - Parse "tên, email, ngày" tách đúng field
    - Email trùng → ask_clarification, KHÔNG update_student

[4] Quy tắc tạo khóa học
    - title không bắt buộc (nếu trống vẫn mở form)
    - Ngày VN dd/mm/yyyy → YYYY-MM-DD

[5] Quy tắc ghi danh vào lớp
    - Luôn ghi danh cấp LỚP (assign_student_to_class)
    - Nếu nhiều kết quả → ask_clarification

[6] Quy tắc tạo lớp
    - 2 loại: WEEKLY / EXAM_PRACTICE
    - courseId bắt buộc, tìm qua search_course nếu chưa có

[7] Quy tắc update

[8] Nếu FULL MODE: thêm quy tắc close_class, remove

[9] Tham chiếu hội thoại
    - "học viên vừa tạo" = last_created_student
    - "người thứ 2" = last_candidates.students[1]

[10] Ngữ cảnh phiên chat (từ context)
     - last_created_student: Nguyễn Văn A (ID: 42)
     - selected_course: IELTS 6.5 (ID: 7)
     - last_candidates.students: 1. An (ID: 3)  2. Bình (ID: 5)

[11] Pending states (nếu có)
     - pending_action: tool + input + summary
     - duplicate_student_context: học viên trùng + hướng xử lý
     - pending_enrollment_context: danh sách lớp để chọn
     - pending_class_creation: trạng thái tạo lớp 2 bước
     - pending_clarification: intent + missing fields
```

#### Mini Mode
Khi `isAgentMiniMode()` = true (đọc từ env), LLM chỉ được dùng 7 tool:
`create_student`, `create_course`, `create_class`, `assign_student_to_class`, `update_student`, `update_course`, `update_class`

---

### 3.4. `agent-runner.service.ts` — Vòng lặp LLM chính

**Vai trò:** Điều phối cuộc trò chuyện với LLM, xử lý tool-calling loop.

**Method chính:** `run(input: AgentRunInput): Promise<AgentRunResult>`

```typescript
interface AgentRunInput {
  userMessage: string;
  sessionHistory: ChatMessage[];  // Lịch sử chat
  context: DecisionContext;       // State phiên hiện tại
  tenantId: number;
  userId: number;
  sessionId: number;
}
```

#### Luồng xử lý chi tiết

```
run(input)
  │
  ├─ Lấy 12 tin nhắn gần nhất từ sessionHistory
  ├─ Build system prompt (AgentContextBuilderService)
  ├─ Lấy danh sách tool (getConfiguredAgentTools)
  │
  └─ LOOP tối đa 5 lần (MAX_TOOL_LOOPS)
       │
       ├─ gọi LLM: aiModel.callWithTools(systemPrompt, messages, tools)
       │
       ├─ Nếu modelResult.type === 'error'
       │    └─ return { type: 'text', llmUnavailable: true }
       │
       ├─ Nếu không có tool call (LLM trả text thuần)
       │    └─ return { type: 'text', message: text hoặc formatReadResult }
       │
       ├─ Nếu tool = ask_clarification
       │    └─ return { type: 'clarification', clarification, contextPatch }
       │
       ├─ Nếu tool là READ tool (search_*, get_*)
       │    ├─ Gọi toolExecutor.executeRead(tenantId, toolName, args)
       │    ├─ Thêm kết quả vào messages (role: 'tool')
       │    └─ continue loop (LLM tiếp tục với dữ liệu vừa đọc)
       │
       ├─ Nếu tool là WRITE tool (create_*, update_*, delete_*, assign_*, etc.)
       │    ├─ Build PendingAction (CHƯA ghi DB)
       │    └─ return { type: 'pending_write', pendingAction, contextPatch }
       │
       └─ Tool không hỗ trợ → return clarification

  Nếu loop kết thúc mà không return sớm:
    └─ return { type: 'text', message: kết quả read gần nhất }
```

#### AgentRunResult — 3 loại kết quả

| type | Ý nghĩa | CopilotService làm gì |
|------|---------|----------------------|
| `text` | LLM trả lời thuần | Hiển thị message bubble |
| `clarification` | Cần thêm thông tin | Hiển thị câu hỏi + lưu pending_clarification |
| `pending_write` | Action chờ confirm | Hiển thị preview card + nút Xác nhận/Hủy |

#### Helper methods quan trọng

| Method | Vai trò |
|--------|---------|
| `buildClarification(args)` | Parse output của LLM khi gọi `ask_clarification` tool |
| `summarizeWriteTool(toolName, args)` | Tạo text mô tả ngắn cho preview card ("Tạo khóa học: IELTS 6.5, ngày bắt đầu: 10/07/2026") |
| `isDangerTool(toolName)` | `delete_students`, `delete_courses`, `close_class` → severity = 'danger' |
| `messageFromReadResult(lastReadResult)` | Format kết quả READ cuối cùng → text tiếng Việt (qua agent-formatters) |
| `contextPatchFromReadResult(lastReadResult)` | Cập nhật DecisionContext từ kết quả READ (last_candidates, last_selected_*) |
| `toOptions(rows)` | Convert array DB rows → EntityOption[] (tối đa 10) |
| `toSingleOption(row)` | Convert 1 DB row → EntityOption |

---

### 3.5. `tool-executor.service.ts` — Thực thi READ tools

**Vai trò:** Tầng adapter duy nhất giữa AgentRunner và domain services cho các thao tác **đọc dữ liệu**.

**Method chính:** `executeRead(tenantId, toolName, args): Promise<unknown>`

#### Map tool → service method

| Tool | Service call |
|------|-------------|
| `search_student` | `usersService.searchStudents(tenantId, keyword)` |
| `get_student_detail` | `usersService.getStudentDetail(tenantId, userId)` |
| `search_course` | `coursesService.searchCourses(tenantId, keyword)` |
| `get_course_detail` | `coursesService.getCourseDetail(tenantId, courseId)` |
| `get_course_classes` | `coursesService.findClassesForCourse(tenantId, courseId)` |
| `search_class` | `coursesService.searchClasses(tenantId, keyword, {courseId, type, status})` |
| `get_class_detail` | `coursesService.getClassDetail(tenantId, classId)` |
| `get_class_students` | `coursesService.getClassStudents(tenantId, classId)` |

Guard trước khi thực thi:
1. `isReadTool(toolName)` — chỉ cho phép READ tool
2. `assertToolAllowedInCurrentMode(toolName)` — kiểm tra mini/full mode

---

### 3.6. `tool-registry.service.ts` — Thực thi WRITE tools

**Vai trò:** Thực thi WRITE tools với đầy đủ audit trail. **Đây là nơi duy nhất thực sự ghi DB**.

**Method chính:** `execute(sessionId, actor, toolName, input): Promise<unknown>`

#### Luồng thực thi WRITE

```
execute(sessionId, actor, toolName, input)
  │
  ├─ Guard 1: isWriteTool(toolName) — từ chối nếu không phải WRITE
  ├─ Guard 2: assertToolAllowedInCurrentMode — kiểm tra mini/full mode
  ├─ Guard 3 (update_student): nếu session intent là 'create_student'
  │    └─ Throw 400: "Đang muốn tạo mới, không được update học viên cũ"
  │         (Ngăn LLM tự sửa học viên khi email/SĐT trùng)
  │
  ├─ Tạo aiAgentAction record { status: 'PENDING' }
  │
  ├─ executeWriteTool(tenantId, toolName, input)
  │    └─ switch/case → gọi đúng domain service method
  │
  ├─ Nếu thành công:
  │    ├─ Update aiAgentAction { status: 'SUCCESS', outputJson }
  │    └─ writeAuditLog(actor, toolName, output)
  │
  └─ Nếu lỗi:
       ├─ Update aiAgentAction { status: 'FAILED', errorMessage }
       └─ Rethrow lỗi
```

#### Map tool → service method (WRITE)

| Tool | Service call |
|------|-------------|
| `create_student` | `usersService.createStudent(tenantId, dto)` |
| `update_student` | `usersService.updateStudent(tenantId, userId, dto)` |
| `delete_students` | `usersService.deleteStudents(tenantId, {ids, all})` |
| `create_course` | `coursesService.createCourse(tenantId, dto)` |
| `update_course` | `coursesService.updateCourse(tenantId, courseId, dto)` |
| `delete_courses` | `coursesService.deleteCourses(tenantId, {ids, all})` |
| `create_class` | `coursesService.createClass(tenantId, dto)` |
| `update_class` | `coursesService.updateClass(tenantId, classId, dto)` |
| `close_class` | `coursesService.changeClassStatus(tenantId, classId, 'CLOSED')` |
| `assign_student_to_class` | `coursesService.addStudentToClass(tenantId, classId, dto)` |
| `assign_student_to_course` | `assignStudentToCourse(...)` (nội bộ, map sang class) |
| `remove_student_from_class` | `coursesService.removeStudentFromClass(...)` |
| `remove_student_from_course_classes` | `coursesService.removeStudentFromCourseClasses(...)` |

**Lưu ý về date normalization:** `optionalDateString` trả `undefined` cho string rỗng → service bỏ qua field đó, không ghi đè giá trị cũ trong DB.

---

### 3.7. `tool-definitions.ts` — Schema cho LLM

**Vai trò:** Định nghĩa schema OpenAI function-calling format cho tất cả 22 tools.

#### Functions quan trọng

| Function | Vai trò |
|----------|---------|
| `getConfiguredAgentTools()` | Trả danh sách tool theo mode (mini: 7 tools, full: 22 tools) |
| `isReadTool(toolName)` | Kiểm tra có phải READ tool không |
| `isWriteTool(toolName)` | Kiểm tra có phải WRITE tool không |
| `isAgentMiniMode()` | Đọc env `AGENT_MINI_MODE=true` |
| `isToolAllowedInMiniMode(toolName)` | Allowlist 7 tools cho mini mode |
| `assertToolAllowedInCurrentMode(toolName)` | Throw 400 nếu tool bị chặn bởi mode |

#### AgentToolDefinition structure
```typescript
interface AgentToolDefinition {
  type: 'function';
  function: {
    name: AiToolName;
    description: string;  // LLM dùng description để chọn tool đúng
    parameters: {
      type: 'object';
      properties: Record<string, { type, description, enum? }>;
      required?: string[];
    };
  };
}
```

---

### 3.8. `deterministic-intent.service.ts` — Fast Path (No LLM)

**Vai trò:** Xử lý các intent phổ biến bằng regex + heuristic, không tốn token LLM. Đây là service lớn nhất (~2800 dòng).

**Method chính:** `resolve(userMessage, context, tenantId): Promise<DeterministicOutcome | null>`

Trả `null` = không xử lý được → CopilotService chuyển sang AgentRunnerService.

#### DeterministicOutcome — 7 loại kết quả

| type | UI render |
|------|----------|
| `message` | Text bubble bình thường |
| `clarification` | Text hỏi thêm info |
| `pending_write` | Preview card + nút Xác nhận/Hủy |
| `student_form` | Form điền sẵn tạo học viên |
| `course_form` | Form điền sẵn tạo khóa học |
| `student_table` | Bảng danh sách học viên |
| `class_table` | Bảng danh sách lớp học |

#### Regex constants quan trọng

```typescript
SEARCH_VERB_RE  // tìm, kiếm, search, tra cứu, liệt kê, danh sách
CREATE_VERB_RE  // tạo, thêm, create, add, đăng ký
CREATE_CLASS_VERB_RE // tạo, mở, create, open
STUDENT_RE      // hoc vien, hv, hs, student, learner
COURSE_RE       // khoa hoc, khoa, course, chuong trinh
CLASS_RE        // lop hoc, lop, class
MODIFY_VERB_RE  // sua, cap nhat, chinh sua, update, doi, xoa, delete
```

#### Luồng resolve (tóm tắt)

```
resolve(message, context, tenantId)
  │
  ├─ Normalize text (bỏ dấu tiếng Việt, lowercase)
  │
  ├─ Kiểm tra trạng thái đặc biệt trong context:
  │   ├─ duplicate_student_context? → xử lý flow trùng học viên
  │   ├─ pending_enrollment_context? → user đang chọn lớp
  │   ├─ pending_class_creation? → user đang trả lời tên lớp/khóa
  │   └─ pending_clarification? → user đang trả lời câu hỏi
  │
  ├─ Phát hiện confirm/cancel ("ok", "xác nhận", "hủy", "không")
  │   └─ Trả 'message' với contextPatch xóa pending
  │
  ├─ Phát hiện search intent (SEARCH_VERB_RE + entity RE)
  │   └─ handleSearch(tenantId, entity, keyword)
  │        ├─ runSearch → searchStudents/searchCourses/searchClasses
  │        ├─ formatCandidateList → text tiếng Việt
  │        └─ Trả 'message' + cập nhật last_candidates
  │
  ├─ Phát hiện create student (CREATE_VERB_RE + STUDENT_RE)
  │   └─ Parse fullName/email/phone/birthDate từ message
  │       ├─ Nếu trùng email/SĐT → 'pending_write' với DuplicateStudentContext
  │       └─ Nếu OK → 'student_form' hoặc 'pending_write'
  │
  ├─ Phát hiện create course (CREATE_VERB_RE + COURSE_RE)
  │   └─ Parse title, startDate, expireDate
  │       └─ Trả 'course_form' hoặc 'pending_write'
  │
  ├─ Phát hiện create class (CREATE_CLASS_VERB_RE + CLASS_RE)
  │   └─ handleCreateClass(...)
  │       ├─ Parse type (WEEKLY/EXAM_PRACTICE), title, dates, teacher
  │       ├─ Nếu thiếu courseId → search_course, nếu 1 kết quả → auto-chọn
  │       ├─ Nếu nhiều khóa → 'clarification' chọn khóa
  │       └─ Khi đủ courseId + title → 'pending_write' create_class
  │
  ├─ Phát hiện assign student to class
  │   └─ Multi-step: find student → find class → build pending_write
  │
  ├─ Phát hiện view student list
  │   └─ Trả 'student_table' hoặc 'class_table'
  │
  └─ Không match → return null → fall through to LLM
```

#### Helper methods

| Method | Vai trò |
|--------|---------|
| `chooseFrom(entity, rows)` | Khi search trả nhiều kết quả → clarification yêu cầu chọn |
| `notFound(entity, keyword)` | Không tìm thấy → message thân thiện |
| `toOptions(rows)` | Convert DB rows → EntityOption[] |
| `parseTeacherName(message)` | Trích tên giáo viên từ câu |
| `hasContactSignal(tokens)` | Phát hiện email/SĐT trong câu |
| `cleanText(value)` | Bỏ dấu phẩy/khoảng trắng đầu cuối |

---

### 3.9. `agent-formatters.ts` — Format text tiếng Việt

**Vai trò:** Pure functions (không có DB, không có dependency), format dữ liệu thành text tiếng Việt thân thiện. Tối đa 10 items trong danh sách.

| Function | Input → Output |
|----------|----------------|
| `formatDateForVi(value)` | Date/string → "DD/MM/YYYY" |
| `formatStudentOption(student, index)` | DB row → "1. Nguyễn Văn A\n   - Email: a@gmail.com\n   - SĐT: 09..." |
| `formatCourseOption(course, index)` | DB row → "1. IELTS 6.5\n   - Mã khóa: IELTS65\n..." |
| `formatClassOption(courseClass, index)` | DB row → "1. Lớp tối 2-4-6\n   - Mã lớp: ...\n..." |
| `formatCandidateList(type, rows)` | rows → Full Vietnamese list với header + ask prompt |
| `formatReadResultMessage(toolName, result)` | toolName + result → Formatted message hoặc null |
| `formatSingle(type, result)` | Single DB row → "Thông tin học viên:\n\nNguyễn Văn A\n   - Email:..." |

---

## 4. Luồng tổng hợp — Từ message đến kết quả

### 4.1. User gõ "tìm học viên tên An"

```
CopilotService.sendMessage("tìm học viên tên An")
  │
  ├─ Load session + DecisionContext từ DB
  │
  ├─ DeterministicIntentService.resolve(...)
  │   ├─ normalize: "tim hoc vien ten an"
  │   ├─ Match SEARCH_VERB_RE: ✓ ("tim")
  │   ├─ Match STUDENT_RE: ✓ ("hoc vien")
  │   ├─ keyword = "an"
  │   └─ handleSearch(tenantId, 'student', 'an')
  │        ├─ usersService.searchStudents(tenantId, 'an') → [An1, An2, An3]
  │        ├─ formatCandidateList('student', rows) → "Tôi tìm thấy 3 học viên:..."
  │        └─ return { type: 'message', message, contextPatch: { last_candidates } }
  │
  ├─ DeterministicOutcome không null → KHÔNG gọi LLM
  │
  └─ CopilotService lưu turn + cập nhật DecisionContext
       └─ Trả về message bubble: "Tôi tìm thấy 3 học viên phù hợp: 1. An Nguyễn..."
```

### 4.2. User gõ "thêm học viên vừa tìm vào lớp IELTS tối"

```
CopilotService.sendMessage("thêm học viên vừa tìm vào lớp IELTS tối")
  │
  ├─ DecisionContext có: last_candidates.students = [An1, An2, An3]
  │
  ├─ DeterministicIntentService.resolve(...)
  │   ├─ Phức tạp (nhiều entity, tham chiếu ngữ cảnh) → return null
  │
  ├─ null → gọi AgentRunnerService.run(...)
  │
  ├─ AgentContextBuilderService.buildSystemPrompt(context)
  │   └─ Prompt bao gồm:
  │       "- last_candidates.students:
  │          1. An Nguyễn (ID: 3) - 09xxx | an@gmail.com
  │          2. An Trần (ID: 7) - 09yyy | an2@gmail.com
  │          3. An Lê (ID: 12)"
  │
  ├─ LLM call 1: gọi search_class({ keyword: "IELTS tối" })
  │
  ├─ toolExecutor.executeRead('search_class', args)
  │   └─ coursesService.searchClasses(tenantId, 'IELTS tối') → [Lớp IELTS 6.5 tối 2-4-6]
  │
  ├─ Thêm kết quả vào messages, tiếp tục loop
  │
  ├─ LLM call 2: gọi ask_clarification({ intent: 'assign_student_to_class',
  │               missingFields: ['userId'],
  │               message: 'Có 3 học viên tên An. Bạn chọn học viên nào?' })
  │
  └─ return { type: 'clarification', ... }
       └─ CopilotService hiển thị câu hỏi + lưu pending_clarification
```

### 4.3. User chọn "1" (học viên số 1) → "ok tạo đi"

```
CopilotService nhận "1"
  │
  ├─ DeterministicIntentService.resolve("1", context với pending_clarification)
  │   ├─ Phát hiện pending_clarification.intent = 'assign_student_to_class'
  │   ├─ Parse "1" → index 0 → last_candidates.students[0] = An Nguyễn (ID: 3)
  │   └─ Đã có classId từ search trước → build PendingAction assign_student_to_class
  │        └─ return { type: 'pending_write', pending: { tool_name, input, summary } }
  │
  └─ CopilotService hiển thị preview card:
       "Thêm học viên vào lớp
        Học viên: An Nguyễn (#3)
        Lớp: IELTS 6.5 tối 2-4-6 (#15)
        [Xác nhận] [Hủy]"

User bấm [Xác nhận]:
  │
  ├─ CopilotService.confirmAction(sessionId, actor)
  │
  └─ ToolRegistryService.execute(sessionId, actor, 'assign_student_to_class', input)
       ├─ Tạo aiAgentAction { status: 'PENDING' }
       ├─ coursesService.addStudentToClass(tenantId, classId, { userId: 3, ... })
       ├─ Update aiAgentAction { status: 'SUCCESS' }
       ├─ writeAuditLog(...)
       └─ return kết quả → CopilotService hiển thị "Đã thêm học viên vào lớp ✓"
```

---

## 5. Cơ chế an toàn

### 5.1. Chống hallucinated ID
- System prompt: "Không tự bịa ID, email, SĐT"
- ToolExecutorService: validate `requireNumber`, `requireString` → throw 400 ngay
- WRITE tool không execute ngay: luôn phải qua confirm step

### 5.2. Chống double-submit
- `PendingAction.idempotency_key` sinh UUID khi tạo pending
- `DecisionContext.last_executed_idempotency_key` lưu key vừa thực thi
- Nếu confirm cùng key lần 2 → reject

### 5.3. Chống update nhầm khi tạo mới
- `ToolRegistryService.execute`: nếu session `last_intent === 'create_student'` → block `update_student`
- System prompt: "Email trùng KHÔNG phải lệnh update"

### 5.4. Severity system
- `isDangerTool()`: `delete_students`, `delete_courses`, `close_class` → `severity: 'danger'`
- UI render preview card màu đỏ cảnh báo

---

## 6. Mini Mode vs Full Mode

| Mode | Bật bằng | Tool được phép |
|------|----------|----------------|
| Mini | `AGENT_MINI_MODE=true` | 7 tools: create/update student/course/class + assign_student_to_class |
| Full | Mặc định | Tất cả 22 tools |

Mini mode block: `delete_students`, `delete_courses`, `close_class`, `remove_*`, `assign_student_to_course`

---

## 7. DB Tables liên quan

| Table | Dùng bởi | Mục đích |
|-------|----------|----------|
| `aiAgentSession` | CopilotService | Lưu lịch sử chat + DecisionContext |
| `aiAgentSessionMessage` | CopilotService | Từng tin nhắn trong phiên |
| `aiAgentAction` | ToolRegistryService | Log mỗi WRITE tool execution (PENDING → SUCCESS/FAILED) |
| `aiAgentAuditLog` | ToolRegistryService | Audit trail cho compliance |
| `aiCopilotTurnEvent` | CopilotService | Event log mỗi turn (analytics) |
