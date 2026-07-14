"use client";

import React from "react";
import { ChevronRight } from "lucide-react";

/**
 * Các block hiển thị kết quả tool (tool_result) dạng key-value sạch,
 * dùng chung cho cả modal xác nhận. Không dump JSON thô.
 */

export const FIELD_LABELS: Record<string, string> = {
  id: "ID",
  tenantId: "Tenant",
  fullName: "Họ và tên",
  name: "Tên",
  title: "Tên",
  email: "Email",
  phone: "Số điện thoại",
  role: "Vai trò",
  roleInCourse: "Vai trò trong khóa",
  roleInClass: "Vai trò trong lớp",
  status: "Trạng thái",
  address: "Địa chỉ",
  birthDate: "Ngày sinh",
  startDate: "Ngày bắt đầu",
  endDate: "Ngày kết thúc",
  expireDate: "Ngày kết thúc",
  joinedAt: "Ngày vào lớp",
  endedAt: "Ngày kết thúc",
  createdAt: "Ngày tạo",
  updatedAt: "Cập nhật lần cuối",
  description: "Mô tả",
  level: "Cấp độ",
  courseId: "Mã khóa học",
  courseCode: "Mã khóa",
  userId: "Mã học viên",
  studentId: "Mã học viên",
  studentName: "Tên học viên",
  studentEmail: "Email học viên",
  courseName: "Khóa học",
  courseTitle: "Khóa học",
  classId: "Mã lớp",
  className: "Tên lớp",
  classCode: "Mã lớp",
  classType: "Loại lớp",
  type: "Loại lớp",
  teacherName: "Giáo viên",
  activeStudents: "Học viên bị ảnh hưởng",
  studentCount: "Số học viên",
  totalMembers: "Số thành viên",
  classCount: "Số lớp",
  memberCount: "Số thành viên",
  sessions: "Buổi học bị ảnh hưởng",
  assignments: "Bài tập/đề bị ảnh hưởng",
  affectedClasses: "Các lớp bị ảnh hưởng",
  classes: "Danh sách lớp",
  reason: "Lý do",
  scheduleNote: "Ghi chú lịch học",
  keyword: "Từ khóa",
  enrollStudentName: "Học viên ghi danh",
  deletedCount: "Số bản ghi đã xóa",
  enrollmentDeletedCount: "Số ghi danh đã xóa",
};

const HIDDEN_FIELDS = new Set(["password"]);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function formatFieldLabel(key: string) {
  if (FIELD_LABELS[key]) return FIELD_LABELS[key];

  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/_/g, " ")
    .replace(/^./, (letter) => letter.toUpperCase());
}

export function formatFieldValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "Chưa có";
  if (typeof value === "boolean") return value ? "Có" : "Không";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") {
    if (key === "roleInCourse" || key === "roleInClass" || key === "role") {
      const roleLabels: Record<string, string> = {
        STUDENT: "Học viên",
        TEACHER: "Giáo viên",
        HOMEROOM_TEACHER: "Chủ nhiệm",
      };
      return roleLabels[value.toUpperCase()] || value;
    }

    if (key === "classType" || key === "type") {
      if (value === "EXAM_PRACTICE") return "Luyện đề";
      if (value === "WEEKLY") return "Học theo tuần";
    }

    const isDateField = /date|at$/i.test(key);
    const date = isDateField ? new Date(value) : null;

    if (date && !Number.isNaN(date.getTime())) {
      if (/date$/i.test(key) && !/at$/i.test(key)) {
        return date.toLocaleDateString("vi-VN");
      }

      return date.toLocaleString("vi-VN");
    }

    return value;
  }

  return JSON.stringify(value);
}

function statusBadgeClass(status: unknown) {
  if (String(status).toUpperCase() === "ACTIVE") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  return "border-zinc-200 bg-zinc-50 text-zinc-600";
}

type KVEntry = { label: string; value: React.ReactNode; mono?: boolean };

/** Danh sách key-value: label trái cố định, value phải, scan nhanh. */
function KeyValueRows({ entries }: { entries: KVEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <dl className="divide-y divide-zinc-100">
      {entries.map((entry, index) => (
        <div key={`${entry.label}-${index}`} className="flex gap-3 py-1.5">
          <dt className="w-28 shrink-0 text-xs leading-5 text-zinc-500">
            {entry.label}
          </dt>
          <dd
            className={`min-w-0 flex-1 break-words text-[13px] leading-5 text-zinc-800 ${
              entry.mono ? "font-mono text-xs leading-5" : ""
            }`}
          >
            {entry.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Card bao ngoài cho một bản ghi kết quả. */
function ResultCardShell({
  title,
  id,
  badge,
  children,
}: {
  title: string;
  id?: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white px-4 py-3">
      <div className="flex flex-wrap items-center gap-2 pb-1.5">
        <h4 className="min-w-0 break-words text-sm font-semibold text-zinc-900">
          {title}
        </h4>
        {id && (
          <span className="rounded-md bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px] font-medium text-zinc-500">
            #{id}
          </span>
        )}
        {badge}
      </div>
      {children}
    </div>
  );
}

/** Chip nhỏ có thể bấm để xem chi tiết một thực thể liên quan. */
function LinkChip({
  label,
  meta,
  onClick,
}: {
  label: string;
  meta?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className="inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2 py-1 text-left text-xs text-zinc-700 transition enabled:cursor-pointer enabled:hover:border-zinc-300 enabled:hover:bg-zinc-50"
    >
      <span className="truncate font-medium">{label}</span>
      {meta && <span className="truncate text-[11px] text-zinc-400">{meta}</span>}
    </button>
  );
}

function pushIf(
  entries: KVEntry[],
  label: string,
  value: unknown,
  key: string,
  options?: { mono?: boolean; keepEmpty?: boolean },
) {
  const isEmpty = value === null || value === undefined || value === "";
  if (isEmpty && !options?.keepEmpty) return;
  entries.push({
    label,
    value: isEmpty ? (
      <span className="text-zinc-400">Chưa có</span>
    ) : (
      formatFieldValue(key, value)
    ),
    mono: options?.mono,
  });
}

// ---- Học viên ---------------------------------------------------------------

function StudentResultBlock({
  record,
  onSelect,
}: {
  record: Record<string, unknown>;
  onSelect?: (msg: string) => void;
}) {
  const name = String(record.fullName || record.name || "Chưa có tên");
  const idValue = record.id !== undefined ? String(record.id) : undefined;

  const entries: KVEntry[] = [];
  pushIf(entries, "Email", record.email, "email", { keepEmpty: true });
  pushIf(entries, "Số điện thoại", record.phone, "phone");
  pushIf(entries, "Ngày sinh", record.birthDate, "birthDate");
  pushIf(entries, "Địa chỉ", record.address, "address");

  const classes = Array.isArray(record.classes)
    ? (record.classes as Record<string, unknown>[])
    : [];

  return (
    <ResultCardShell title={name} id={idValue}>
      <KeyValueRows entries={entries} />
      {classes.length > 0 && (
        <div className="mt-2 border-t border-zinc-100 pt-2">
          <div className="mb-1.5 text-[11px] font-medium text-zinc-500">
            Lớp đang tham gia ({classes.length})
          </div>
          <div className="flex flex-wrap gap-1.5">
            {classes.map((c, idx) => {
              const className = String(c.className || c.name || "Chưa có tên");
              const classId = c.classId || c.id;
              const classCode = c.classCode || c.code;
              return (
                <LinkChip
                  key={`student-class-${String(classId ?? idx)}`}
                  label={className}
                  meta={classCode ? String(classCode) : undefined}
                  onClick={
                    onSelect && classId
                      ? () =>
                          onSelect(
                            `Xem chi tiết lớp học ${className} #${String(classId)}`,
                          )
                      : undefined
                  }
                />
              );
            })}
          </div>
        </div>
      )}
    </ResultCardShell>
  );
}

// ---- Lớp học ----------------------------------------------------------------

function getStudentFromEnrollment(record: Record<string, unknown>) {
  const student = isRecord(record.student) ? record.student : record;
  return {
    name: String(student.fullName || student.name || "Chưa có tên"),
    email: student.email ? String(student.email) : "",
    id: student.id,
  };
}

function ClassResultBlock({
  record,
  onSelect,
}: {
  record: Record<string, unknown>;
  onSelect?: (msg: string) => void;
}) {
  const title = String(record.title || "Chưa có tên");
  const idValue = record.id !== undefined ? String(record.id) : undefined;
  const course = isRecord(record.course) ? record.course : null;
  const count = isRecord(record._count)
    ? (record._count as Record<string, number>)
    : undefined;
  const studentCount =
    Number(
      record.studentCount ??
        record.totalMembers ??
        count?.students ??
        count?.enrollments ??
        0,
    ) || 0;
  const students = Array.isArray(record.students)
    ? record.students
    : Array.isArray(record.enrollments)
      ? record.enrollments
      : [];
  const startDate = record.startDate
    ? formatFieldValue("startDate", record.startDate)
    : "";
  const endDate = record.endDate
    ? formatFieldValue("endDate", record.endDate)
    : "";

  const entries: KVEntry[] = [];
  pushIf(entries, "Mã lớp", record.classCode, "classCode", { mono: true });
  pushIf(
    entries,
    "Khóa học",
    course ? course.title || course.courseCode : undefined,
    "courseName",
  );
  pushIf(entries, "Loại lớp", record.type, "type");
  pushIf(entries, "Giáo viên", record.teacherName, "teacherName");
  if (studentCount > 0) {
    entries.push({ label: "Sĩ số", value: `${studentCount} học viên` });
  }
  if (startDate || endDate) {
    entries.push({
      label: "Thời gian",
      value: `${startDate || "?"} – ${endDate || "?"}`,
    });
  }
  pushIf(entries, "Mô tả", record.description, "description");

  return (
    <ResultCardShell
      title={title}
      id={idValue}
      badge={
        record.status !== undefined ? (
          <span
            className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${statusBadgeClass(record.status)}`}
          >
            {formatFieldValue("status", record.status)}
          </span>
        ) : undefined
      }
    >
      <KeyValueRows entries={entries} />
      {students.length > 0 && (
        <div className="mt-2 border-t border-zinc-100 pt-2">
          <div className="mb-1.5 text-[11px] font-medium text-zinc-500">
            Học viên trong lớp ({students.length})
          </div>
          <div className="flex flex-wrap gap-1.5">
            {students.map((item: unknown, index: number) => {
              const member = getStudentFromEnrollment(
                isRecord(item) ? item : {},
              );
              return (
                <LinkChip
                  key={`class-member-${String(member.id ?? index)}`}
                  label={member.name}
                  meta={member.email || undefined}
                  onClick={
                    onSelect && member.id
                      ? () =>
                          onSelect(
                            `Xem chi tiết học viên ${member.name} #${String(member.id)}`,
                          )
                      : undefined
                  }
                />
              );
            })}
          </div>
        </div>
      )}
    </ResultCardShell>
  );
}

// ---- Khóa học ---------------------------------------------------------------

function CourseResultBlock({
  record,
  onSelect,
}: {
  record: Record<string, unknown>;
  onSelect?: (msg: string) => void;
}) {
  const title = String(record.title || record.name || "Chưa có tên");
  const idValue = record.id !== undefined ? String(record.id) : undefined;
  const count = isRecord(record._count)
    ? (record._count as Record<string, number>)
    : undefined;
  const classCount = Number(record.classCount ?? count?.classes ?? 0) || 0;
  const studentCount =
    Number(record.studentCount ?? record.totalMembers ?? count?.students ?? 0) ||
    0;
  const classesList = Array.isArray(record.classes)
    ? (record.classes as Record<string, unknown>[])
    : [];

  const entries: KVEntry[] = [];
  pushIf(entries, "Mã khóa", record.courseCode || record.code, "courseCode", {
    mono: true,
  });
  pushIf(entries, "Cấp độ", record.level, "level");
  // Khóa học không có ngày bắt đầu/kết thúc — ngày chỉ hiển thị ở lớp học.
  if (classCount > 0) entries.push({ label: "Số lớp", value: String(classCount) });
  if (studentCount > 0) {
    entries.push({ label: "Số học viên", value: String(studentCount) });
  }
  pushIf(entries, "Mô tả", record.description, "description");

  return (
    <ResultCardShell title={title} id={idValue}>
      <KeyValueRows entries={entries} />
      {classesList.length > 0 && (
        <div className="mt-2 border-t border-zinc-100 pt-2">
          <div className="mb-1.5 text-[11px] font-medium text-zinc-500">
            Lớp học thuộc khóa ({classesList.length})
          </div>
          <div className="space-y-1">
            {classesList.map((c) => {
              const classId = String(c.id ?? "");
              const classTitle = String(c.title || c.classCode || "Chưa có tên");
              const classCode = String(c.classCode || "");
              const total = isRecord(c._count)
                ? Number(c._count.enrollments || c.studentCount || 0)
                : Number(c.studentCount || 0);
              return (
                <button
                  key={classId || classTitle}
                  type="button"
                  disabled={!onSelect}
                  onClick={() =>
                    onSelect?.(`Xem chi tiết lớp học ${classTitle} #${classId}`)
                  }
                  className="group flex w-full items-center gap-2 rounded-xl border border-zinc-100 bg-zinc-50/60 px-2.5 py-1.5 text-left transition enabled:cursor-pointer enabled:hover:border-zinc-200 enabled:hover:bg-zinc-50"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-zinc-800">
                      {classTitle}
                    </span>
                    <span className="mt-0.5 flex items-center gap-2 text-[11px] text-zinc-400">
                      {classCode && <span className="font-mono">{classCode}</span>}
                      <span>{total} học viên</span>
                    </span>
                  </span>
                  {c.status !== undefined && (
                    <span
                      className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${statusBadgeClass(c.status)}`}
                    >
                      {formatFieldValue("status", c.status)}
                    </span>
                  )}
                  {onSelect && (
                    <ChevronRight
                      size={14}
                      className="shrink-0 text-zinc-300 transition group-hover:text-zinc-500"
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </ResultCardShell>
  );
}

// ---- Ghi danh ---------------------------------------------------------------

export function EnrollmentResultBlock({
  data,
  title,
}: {
  data: unknown;
  title?: string;
}) {
  if (!isRecord(data)) return <GenericResultBlock data={data} />;

  const user = isRecord(data.user) ? data.user : null;
  const course = isRecord(data.course) ? data.course : null;
  const courseClass = isRecord(data.courseClass) ? data.courseClass : null;
  const studentName = String(
    user?.fullName || user?.name || data.userId || "Chưa rõ",
  );
  const targetName = String(
    courseClass?.title ||
      course?.title ||
      course?.name ||
      data.classId ||
      data.courseId ||
      "Chưa rõ",
  );
  const role = data.roleInClass || data.roleInCourse || "STUDENT";
  const joinedAt = data.joinedAt || data.createdAt;

  const entries: KVEntry[] = [
    { label: "Học viên", value: studentName },
    { label: courseClass ? "Lớp học" : "Khóa học", value: targetName },
    { label: "Vai trò", value: formatFieldValue("roleInClass", role) },
  ];
  pushIf(entries, "Ngày ghi danh", joinedAt, "joinedAt");

  return (
    <ResultCardShell
      title={title || "Thông tin ghi danh"}
      id={data.id !== undefined ? String(data.id) : undefined}
    >
      <KeyValueRows entries={entries} />
    </ResultCardShell>
  );
}

// ---- Bảng danh sách học viên --------------------------------------------------

type StudentTableRow = {
  id: number;
  fullName: string;
  email?: string | null;
  phone?: string | null;
  className?: string | null;
  classType?: string | null;
  roleInClass?: string | null;
  joinedAt?: string | null;
};

/** Bảng học viên trong khóa/lớp (response type "student_table" từ copilot). */
export function StudentTableBlock({
  title,
  message,
  students,
}: {
  title?: string;
  message?: string;
  students: StudentTableRow[];
}) {
  const rows = Array.isArray(students) ? students : [];
  const withClassColumn = rows.some((row) => row.className);
  const formatDate = (value?: string | null) => {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? "—"
      : date.toLocaleDateString("vi-VN");
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white">
      <div className="flex items-center justify-between gap-2 border-b border-zinc-100 px-4 py-2.5">
        <div className="min-w-0">
          <h4 className="truncate text-[13px] font-semibold text-zinc-900">
            {title || "Danh sách học viên"}
          </h4>
          {message && (
            <p className="mt-0.5 text-xs leading-4 text-zinc-500">{message}</p>
          )}
        </div>
        <span className="shrink-0 rounded-md bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-zinc-500">
          {rows.length}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="border-b border-zinc-100 bg-zinc-50/60 text-[11px] uppercase tracking-wide text-zinc-500">
              <th className="px-4 py-2 font-medium">#</th>
              <th className="px-3 py-2 font-medium">Họ tên</th>
              <th className="px-3 py-2 font-medium">Email</th>
              <th className="px-3 py-2 font-medium">SĐT</th>
              {withClassColumn && (
                <th className="px-3 py-2 font-medium">Lớp</th>
              )}
              <th className="px-3 py-2 font-medium">Ngày vào lớp</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {rows.map((row, index) => (
              <tr key={`${row.id}-${row.className || index}`}>
                <td className="px-4 py-2 text-zinc-400">{index + 1}</td>
                <td className="px-3 py-2">
                  <span className="font-medium text-zinc-900">
                    {row.fullName}
                  </span>
                  <span className="ml-1.5 font-mono text-[10px] text-zinc-400">
                    #{row.id}
                  </span>
                  {row.roleInClass && row.roleInClass !== "STUDENT" && (
                    <span className="ml-1.5 rounded bg-amber-50 px-1 py-0.5 text-[10px] font-medium text-amber-700">
                      {row.roleInClass}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-zinc-600">{row.email || "—"}</td>
                <td className="px-3 py-2 text-zinc-600">{row.phone || "—"}</td>
                {withClassColumn && (
                  <td className="px-3 py-2 text-zinc-600">
                    {row.className || "—"}
                    {row.classType && (
                      <span className="ml-1 rounded bg-zinc-100 px-1 py-0.5 text-[10px] text-zinc-500">
                        {row.classType === "EXAM_PRACTICE"
                          ? "Luyện đề"
                          : "Theo tuần"}
                      </span>
                    )}
                  </td>
                )}
                <td className="px-3 py-2 text-zinc-600">
                  {formatDate(row.joinedAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---- Bảng danh sách lớp học -----------------------------------------------------

type ClassTableRow = {
  id: number;
  title: string;
  classCode?: string | null;
  type?: string | null;
  teacherName?: string | null;
  studentCount?: number;
  status?: string | null;
  courseTitle?: string | null;
  startDate?: string | null;
  endDate?: string | null;
};

/** Bảng lớp học của khóa (response type "class_table" từ copilot). */
export function ClassTableBlock({
  title,
  message,
  classes,
}: {
  title?: string;
  message?: string;
  classes: ClassTableRow[];
}) {
  const rows = Array.isArray(classes) ? classes : [];
  // Cột "Khóa" chỉ hiện khi bảng gộp lớp từ nhiều khóa khác nhau.
  const courseTitles = new Set(rows.map((row) => row.courseTitle || ""));
  const withCourseColumn = courseTitles.size > 1;

  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white">
      <div className="flex items-center justify-between gap-2 border-b border-zinc-100 px-4 py-2.5">
        <div className="min-w-0">
          <h4 className="truncate text-[13px] font-semibold text-zinc-900">
            {title || "Danh sách lớp học"}
          </h4>
          {message && (
            <p className="mt-0.5 text-xs leading-4 text-zinc-500">{message}</p>
          )}
        </div>
        <span className="shrink-0 rounded-md bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-zinc-500">
          {rows.length}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="border-b border-zinc-100 bg-zinc-50/60 text-[11px] uppercase tracking-wide text-zinc-500">
              <th className="px-4 py-2 font-medium">#</th>
              <th className="px-3 py-2 font-medium">Tên lớp</th>
              <th className="px-3 py-2 font-medium">Loại</th>
              {withCourseColumn && (
                <th className="px-3 py-2 font-medium">Khóa</th>
              )}
              <th className="px-3 py-2 font-medium">Giáo viên</th>
              <th className="px-3 py-2 font-medium">Sĩ số</th>
              <th className="px-3 py-2 font-medium">Trạng thái</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {rows.map((row, index) => (
              <tr key={row.id}>
                <td className="px-4 py-2 text-zinc-400">{index + 1}</td>
                <td className="px-3 py-2">
                  <span className="font-medium text-zinc-900">{row.title}</span>
                  {row.classCode && (
                    <span className="ml-1.5 font-mono text-[10px] text-zinc-400">
                      {row.classCode}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                      row.type === "EXAM_PRACTICE"
                        ? "bg-amber-50 text-amber-700"
                        : "bg-sky-50 text-sky-700"
                    }`}
                  >
                    {row.type === "EXAM_PRACTICE" ? "Luyện đề" : "Theo tuần"}
                  </span>
                </td>
                {withCourseColumn && (
                  <td className="px-3 py-2 text-zinc-600">
                    {row.courseTitle || "—"}
                  </td>
                )}
                <td className="px-3 py-2 text-zinc-600">
                  {row.teacherName || "Chưa phân công"}
                </td>
                <td className="px-3 py-2 text-zinc-600">
                  {row.studentCount ?? 0}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                      row.status === "ACTIVE"
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-zinc-100 text-zinc-500"
                    }`}
                  >
                    {row.status === "ACTIVE"
                      ? "Đang hoạt động"
                      : row.status || "—"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---- Xóa dữ liệu ------------------------------------------------------------

export function DeleteResultBlock({ data }: { data: unknown }) {
  const record = isRecord(data) ? data : {};
  const entries: KVEntry[] = [
    {
      label: "Đã xóa",
      value: `${Number(record.deletedCount ?? 0)} bản ghi`,
    },
  ];
  if (record.enrollmentDeletedCount !== undefined) {
    entries.push({
      label: "Ghi danh đã xóa",
      value: `${Number(record.enrollmentDeletedCount ?? 0)} bản ghi`,
    });
  }
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white px-4 py-2">
      <KeyValueRows entries={entries} />
    </div>
  );
}

// ---- Fallback ---------------------------------------------------------------

function GenericResultBlock({ data }: { data: unknown }) {
  if (!isRecord(data)) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-[13px] text-zinc-700">
        {formatFieldValue("value", data)}
      </div>
    );
  }

  const entries: KVEntry[] = Object.entries(data)
    .filter(
      ([key, value]) =>
        !HIDDEN_FIELDS.has(key) &&
        value !== undefined &&
        value !== null &&
        value !== "" &&
        !isRecord(value) &&
        !Array.isArray(value),
    )
    .map(([key, value]) => ({
      label: formatFieldLabel(key),
      value: formatFieldValue(key, value),
    }));

  const title = String(
    data.fullName || data.name || data.title || "Thông tin chi tiết",
  );

  return (
    <ResultCardShell
      title={title}
      id={data.id !== undefined ? String(data.id) : undefined}
    >
      <KeyValueRows entries={entries} />
    </ResultCardShell>
  );
}

// ---- Dispatcher ---------------------------------------------------------------

function ProfileBlock({
  data,
  toolName,
  onSelect,
}: {
  data: unknown;
  toolName?: string;
  onSelect?: (msg: string) => void;
}) {
  if (!isRecord(data)) return <GenericResultBlock data={data} />;

  let record = data;

  const isStudent =
    record.fullName !== undefined ||
    record.student !== undefined ||
    (toolName && toolName.toLowerCase().includes("student"));
  if (isStudent) {
    if (isRecord(record.student)) record = record.student;
    return <StudentResultBlock record={record} onSelect={onSelect} />;
  }

  const isClass =
    record.classCode !== undefined ||
    (toolName &&
      (toolName.toLowerCase().includes("class") || toolName === "create_class"));
  if (isClass) return <ClassResultBlock record={record} onSelect={onSelect} />;

  const isCourse =
    record.courseCode !== undefined ||
    toolName === "create_course" ||
    toolName === "search_course";
  if (isCourse) return <CourseResultBlock record={record} onSelect={onSelect} />;

  return <GenericResultBlock data={record} />;
}

export function ProfileResultBlocks({
  data,
  toolName,
  onSelect,
}: {
  data: unknown;
  toolName?: string;
  onSelect?: (msg: string) => void;
}) {
  if (Array.isArray(data)) {
    if (data.length === 0) {
      return (
        <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-500">
          Không có dữ liệu phù hợp.
        </div>
      );
    }
    return (
      <div className="space-y-2">
        {data.map((item, index) => (
          <ProfileBlock
            key={
              isRecord(item) && item.id !== undefined
                ? `profile-${String(item.id)}`
                : `profile-${index}`
            }
            data={item}
            toolName={toolName}
            onSelect={onSelect}
          />
        ))}
      </div>
    );
  }

  return <ProfileBlock data={data} toolName={toolName} onSelect={onSelect} />;
}

// ---- Tóm tắt input cho modal xác nhận -----------------------------------------

export function ActionInputSummary({ input }: { input: unknown }) {
  if (!isRecord(input)) return <GenericResultBlock data={input} />;

  const entries: KVEntry[] = Object.entries(input)
    .filter(
      ([key, value]) =>
        !HIDDEN_FIELDS.has(key) &&
        value !== undefined &&
        value !== null &&
        value !== "",
    )
    .map(([key, value]) => ({
      label: formatFieldLabel(key),
      value:
        isRecord(value) || Array.isArray(value)
          ? JSON.stringify(value)
          : formatFieldValue(key, value),
    }));

  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50/60 px-3.5 py-1">
      <KeyValueRows entries={entries} />
    </div>
  );
}
