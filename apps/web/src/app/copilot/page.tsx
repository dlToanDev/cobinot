"use client";

import React, { useCallback, useEffect, useMemo, useState, useRef } from "react";
import {
  Bot,
  AlertTriangle,
  Calendar,
  Hash,
  LoaderCircle,
  Mail,
  MapPin,
  MessageSquare,
  PanelLeft,
  Phone,
  Plus,
  SendHorizontal,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserRound,
  GraduationCap,
  BookOpen,
  Users,
  Award,
  ChevronRight,
  Clock,
  Search,
} from "lucide-react";
import { apiClient } from "@/lib/api-client";
import {
  getActiveCopilotSessionId,
  setActiveCopilotSessionId,
} from "@/lib/copilot-session-storage";
import Navbar from "../../components/Navbar";
import EditablePreviewCard from "./EditablePreviewCard";
import StudentCreateForm from "./StudentCreateForm";
import CourseCreateForm from "./CourseCreateForm";

type CopilotSession = {
  id: number;
  title?: string | null;
  status: string;
  updatedAt: string;
  state?: {
    pending_action?: any;
  } | null;
};

type CopilotMessage = {
  id: number;
  role: "assistant" | "user" | string;
  content: string;
};

const buildPendingPreviewMessage = (
  sessionId: number,
  pendingAction: any,
): CopilotMessage => ({
  id: -sessionId,
  role: "assistant",
  content: JSON.stringify({
    type: "preview_card",
    status: pendingAction.status,
    title: "Kiểm tra lại yêu cầu",
    message:
      pendingAction.status === "validation_error"
        ? "Mình vẫn giữ bản nháp này. Bạn sửa các trường còn lỗi rồi xác nhận lại nhé."
        : "Mình vẫn giữ bản nháp này. Bạn kiểm tra lại rồi bấm Xác nhận nhé.",
    fields: Object.entries(pendingAction.display_input || pendingAction.input || {}).map(
      ([label, value]) => ({ label, value }),
    ),
    tool_name: pendingAction.tool_name,
    input: pendingAction.input || {},
    display_input: pendingAction.display_input,
    pending_action: pendingAction,
    missingFields:
      pendingAction.tool_name === "create_class" &&
      !Number(pendingAction.input?.courseId || 0)
        ? ["courseId"]
        : [],
    summary: pendingAction.summary,
    severity: pendingAction.severity,
    requires_modal_confirmation: pendingAction.requires_modal_confirmation,
    confirmation_title: pendingAction.confirmation_title,
    confirm_label: pendingAction.confirm_label,
    cancel_label: pendingAction.cancel_label,
    impact: pendingAction.impact,
  }),
});

const readStoredActiveSessionId = () => getActiveCopilotSessionId();

const storeActiveSessionId = (sessionId: number | null) => {
  setActiveCopilotSessionId(sessionId);
};

type SelectionOption = {
  id: number | string;
  label: string;
  description?: string;
  metadata?: Record<string, unknown>;
};

type SuggestionOption = {
  id: number | string;
  label: string;
  entity_type?: "student" | "course" | "class" | "enrollment" | "action";
  reason?: string;
  draft_message?: string;
  action?: SuggestionAction;
  priority?: number;
  metadata?: Record<string, unknown>;
};

type SuggestionAction = {
  type: "suggestion_action";
  action: string;
  input: Record<string, unknown>;
};

type ProactiveSuggestion = {
  id: string;
  title: string;
  message: string;
  intent: string;
  draft_message: string;
  priority?: number;
  kind?:
    | "action"
    | "course_picker"
    | "class_picker"
    | "student_picker"
    | "enrollment_picker";
  options?: SuggestionOption[];
  action?: SuggestionAction;
  reason?: string;
};

type PendingConfirmation = {
  confirmation_title?: string;
  confirm_label?: string;
  cancel_label?: string;
  summary?: string;
  display_input?: Record<string, unknown>;
  input?: Record<string, unknown>;
  impact?: Record<string, unknown>;
};

type CopilotClientSnapshot = {
  sessions: CopilotSession[];
  messages: CopilotMessage[];
  activeSessionId: number | null;
  input: string;
  pendingConfirmation: PendingConfirmation | null;
  scrollTop: number;
};

const copilotClientSnapshot: CopilotClientSnapshot = {
  sessions: [],
  messages: [],
  activeSessionId: null,
  input: "",
  pendingConfirmation: null,
  scrollTop: 0,
};

const FIELD_LABELS: Record<string, string> = {
  id: "ID",
  tenantId: "Tenant",
  fullName: "Họ và tên",
  name: "Tên",
  title: "Tên khóa học",
  email: "Email",
  phone: "Số điện thoại",
  role: "Vai trò",
  roleInCourse: "Vai trò trong lớp",
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
  courseId: "Mã khóa học",
  userId: "Mã học viên",
  studentId: "Mã học viên",
  studentName: "Tên học viên",
  studentEmail: "Email học viên",
  courseName: "Khóa học",
  classId: "Mã lớp",
  className: "Tên lớp",
  classCode: "Mã lớp",
  classType: "Loại lớp",
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
};

const HIDDEN_FIELDS = new Set(["password"]);
const getFieldIcon = (key: string) => {
  const lowerKey = key.toLowerCase();
  if (lowerKey.includes("email")) return <Mail size={14} className="text-blue-500" />;
  if (lowerKey.includes("phone")) return <Phone size={14} className="text-teal-500" />;
  if (lowerKey.includes("studentname") || lowerKey.includes("fullname") || lowerKey.includes("teacher") || lowerKey === "userid") {
    return <UserRound size={14} className="text-indigo-500" />;
  }
  if (lowerKey.includes("coursename") || lowerKey === "courseid" || lowerKey.includes("title")) {
    return <BookOpen size={14} className="text-purple-500" />;
  }
  if (lowerKey.includes("classname") || lowerKey === "classid") return <GraduationCap size={14} className="text-emerald-500" />;
  if (lowerKey.includes("code") || lowerKey === "id") return <Hash size={14} className="text-slate-500" />;
  if (lowerKey.includes("role")) return <Award size={14} className="text-amber-500" />;
  if (lowerKey.includes("date") || lowerKey.includes("joinedat")) return <Calendar size={14} className="text-rose-500" />;
  if (lowerKey.includes("address")) return <MapPin size={14} className="text-cyan-500" />;
  return <ShieldCheck size={14} className="text-slate-400" />;
};

const PROFILE_HEADER_FIELDS = new Set([
  "fullName",
  "name",
  "title",
  "email",
  "phone",
  "role",
  "status",
  "id",
]);
const CONTACT_FIELDS = ["email", "phone", "address"];
const DETAIL_FIELDS = [
  "birthDate",
  "startDate",
  "endDate",
  "createdAt",
  "updatedAt",
  "tenantId",
  "courseId",
  "userId",
  "studentId",
];

function getErrorMessage(err: unknown, fallback: string) {
  if (err && typeof err === "object" && "response" in err) {
    const response = (err as { response?: { data?: { message?: string } } })
      .response;
    return response?.data?.message || fallback;
  }

  return fallback;
}

function makeSessionTitle(content: string) {
  const title = content.replace(/\s+/g, " ").trim();
  if (title.length <= 80) return title;

  return `${title.slice(0, 77)}...`;
}

function formatFieldLabel(key: string) {
  if (FIELD_LABELS[key]) return FIELD_LABELS[key];

  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/_/g, " ")
    .replace(/^./, (letter) => letter.toUpperCase());
}

function formatFieldValue(key: string, value: unknown): string {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function renderNestedValue(key: string, value: unknown): React.ReactNode {
  if (Array.isArray(value)) {
    if (value.length === 0) return <span>Không có</span>;

    return (
      <div className="space-y-1">
        {value.map((item, index) => (
          <div
            key={`${key}-${index}`}
            className="rounded border border-slate-200 bg-slate-50 px-2 py-1"
          >
            {isRecord(item)
              ? renderObjectSummary(item)
              : formatFieldValue(key, item)}
          </div>
        ))}
      </div>
    );
  }

  if (isRecord(value)) {
    return renderObjectSummary(value);
  }

  return <span>{formatFieldValue(key, value)}</span>;
}

function renderObjectSummary(record: Record<string, unknown>) {
  const entries = Object.entries(record).filter(
    ([key]) => !HIDDEN_FIELDS.has(key),
  );

  if (entries.length === 0) {
    return <span>Không có dữ liệu</span>;
  }

  return (
    <div className="space-y-0.5">
      {entries.map(([key, value]) => (
        <div
          key={key}
          className="grid grid-cols-[90px_1fr] gap-2 text-[11px] leading-4"
        >
          <span className="truncate font-semibold text-slate-400">
            {formatFieldLabel(key)}
          </span>
          <span className="min-w-0 break-words text-slate-700">
            {isRecord(value) || Array.isArray(value)
              ? renderNestedValue(key, value)
              : formatFieldValue(key, value)}
          </span>
        </div>
      ))}
    </div>
  );
}

function getRecordTitle(record: Record<string, unknown>, index?: number) {
  const title =
    record.fullName ||
    record.name ||
    record.title ||
    record.email ||
    record.phone;
  if (title) return String(title);
  return index === undefined ? "Thông tin chi tiết" : `Kết quả ${index + 1}`;
}

function getInitials(title: string) {
  const words = title.trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] || "H";
  const last = words.length > 1 ? words[words.length - 1]?.[0] : "";

  return `${first}${last}`.toUpperCase();
}

function getStatusClass(status: unknown) {
  if (String(status).toUpperCase() === "ACTIVE") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }

  return "border-slate-200 bg-slate-50 text-slate-700";
}

function renderStudentProfileCard(record: Record<string, unknown>, onSelect?: (msg: string) => void) {
  const name = String(record.fullName || record.name || "Chưa có tên");
  const email = String(record.email || "Chưa có email");
  const phoneValue = record.phone ? String(record.phone) : "";
  const birthDateValue = formatFieldValue("birthDate", record.birthDate);
  const addressValue = formatFieldValue("address", record.address);
  const idValue = record.id !== undefined ? String(record.id) : "";

  const fieldCount = (phoneValue ? 1 : 0) + 2;
  const gridColsClass = fieldCount === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2";

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-md transition-all duration-300 hover:shadow-lg">
      <div className="relative border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white px-4 py-3.5">
        <div className="absolute top-0 left-0 h-[3px] w-full bg-gradient-to-r from-blue-500 to-indigo-500" />
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-sm font-bold text-white shadow-sm shadow-blue-200">
            {getInitials(name)}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-sm font-extrabold text-slate-900 tracking-tight">
                {name}
              </h3>
              {idValue && (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600 border border-slate-200/50">
                  #{idValue}
                </span>
              )}
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
              <Mail size={11} className="shrink-0 text-slate-400" />
              <span className="truncate">{email}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-slate-50/40 p-3.5 flex flex-col gap-3">
        <div className={`grid grid-cols-1 gap-2.5 ${gridColsClass}`}>
          {phoneValue && (
            <div className="flex items-start gap-2.5 rounded-xl border border-slate-100 bg-white p-3 shadow-xs">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-600">
                <Phone size={14} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Số điện thoại</div>
                <div className="mt-0.5 text-xs font-semibold text-slate-800">{phoneValue}</div>
              </div>
            </div>
          )}
          <div className="flex items-start gap-2.5 rounded-xl border border-slate-100 bg-white p-3 shadow-xs">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
              <Calendar size={14} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Ngày sinh</div>
              <div className="mt-0.5 text-xs font-semibold text-slate-800">{birthDateValue}</div>
            </div>
          </div>
          <div className="flex items-start gap-2.5 rounded-xl border border-slate-100 bg-white p-3 shadow-xs">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
              <MapPin size={14} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Địa chỉ</div>
              <div className="mt-0.5 text-xs font-semibold text-slate-800">{addressValue}</div>
            </div>
          </div>
        </div>

        {Array.isArray(record.classes) && record.classes.length > 0 && (
          <div className="border-t border-slate-200/50 pt-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                <GraduationCap size={13} className="text-slate-400" />
                Lớp học đang tham gia
              </div>
              <span className="rounded-full bg-slate-200/50 px-2 py-0.5 text-[9px] font-bold text-slate-600">
                {record.classes.length} lớp
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {record.classes.map((c: any, idx: number) => {
                const className = String(c.className || c.name || "Chưa có tên");
                const classCode = String(c.classCode || c.code || "");
                const classId = c.classId || c.id;
                const courseName = String(c.courseName || c.courseTitle || "");

                return (
                  <button
                    key={`student-class-${classId ?? idx}`}
                    type="button"
                    onClick={() => {
                      if (onSelect && classId) {
                        onSelect(`Xem chi tiết lớp học ${className} #${classId}`);
                      }
                    }}
                    disabled={!onSelect}
                    className="group flex items-center gap-1.5 rounded-md bg-white hover:bg-indigo-50/50 border border-slate-100 hover:border-indigo-100 px-2.5 py-1 transition-all duration-200 text-left cursor-pointer shadow-2xs"
                  >
                    <div className="flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded bg-indigo-50 text-indigo-500 group-hover:bg-indigo-100 group-hover:text-indigo-600 transition-colors">
                      <BookOpen size={10} />
                    </div>
                    <div className="min-w-0 flex items-center gap-1.5">
                      <span className="text-[11px] font-bold text-slate-700 group-hover:text-indigo-700 transition-colors truncate max-w-[120px] sm:max-w-none">
                        {className}
                      </span>
                      {classCode && (
                        <span className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[8px] font-medium text-slate-500 group-hover:bg-indigo-100/50 group-hover:text-indigo-600 transition-colors truncate max-w-[70px]" title={classCode}>
                          {classCode}
                        </span>
                      )}
                      {courseName && (
                        <span className="hidden sm:inline text-[9px] text-slate-400 border-l border-slate-200 pl-1.5 group-hover:text-indigo-500/70 transition-colors truncate max-w-[100px]" title={courseName}>
                          {courseName}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function renderProfileResult(data: unknown, toolName?: string, onSelect?: (msg: string) => void) {
  if (Array.isArray(data)) {
    if (data.length === 0) {
      return (
        <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-500">
          Không có dữ liệu phù hợp.
        </div>
      );
    }

    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {data.map((item, index) => (
          <React.Fragment key={getProfileKey(item, index)}>
            {renderProfileCard(item, index, toolName, onSelect)}
          </React.Fragment>
        ))}
      </div>
    );
  }

  return renderProfileCard(data, undefined, toolName, onSelect);
}

function renderDeleteResult(data: unknown) {
  const record = isRecord(data) ? data : {};
  const deletedCount = record.deletedCount ?? 0;
  const enrollmentDeletedCount = record.enrollmentDeletedCount ?? 0;

  return (
    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
      {renderProfileField("deletedCount", deletedCount)}
      {renderProfileField("enrollmentDeletedCount", enrollmentDeletedCount)}
    </div>
  );
}

function getProfileKey(data: unknown, index: number) {
  if (data && typeof data === "object" && "id" in data) {
    return `profile-${String((data as { id?: unknown }).id)}`;
  }

  return `profile-${index}`;
}

function renderProfileField(key: string, value: unknown, labelOverride?: string) {
  return (
    <div
      key={key}
      className="min-h-[50px] rounded-md border border-slate-200 bg-white px-2 py-1.5"
    >
      <div className="text-[9px] font-semibold uppercase text-slate-400">
        {labelOverride || formatFieldLabel(key)}
      </div>
      <div className="mt-0.5 min-w-0 break-words text-xs font-medium text-slate-900 leading-snug">
        {renderNestedValue(key, value)}
      </div>
    </div>
  );
}

function getStudentFromEnrollment(record: Record<string, unknown>) {
  const student = isRecord(record.student) ? record.student : record;
  return {
    name: String(student.fullName || student.name || "Chưa có tên"),
    email: String(student.email || "Chưa có email"),
    phone: String(student.phone || ""),
    role: record.roleInClass || record.role || "STUDENT",
    id: student.id,
  };
}

function renderClassProfileCard(record: Record<string, unknown>, onSelect?: (msg: string) => void) {
  const title = String(record.title || "Chưa có tên");
  const classCode = String(record.classCode || "—");
  const classType =
    record.type === "EXAM_PRACTICE" ? "Luyện đề" : "Học theo tuần";
  const teacher = String(record.teacherName || "Chưa có");
  const course = isRecord(record.course) ? record.course : null;
  const courseName = course ? String(course.title || course.courseCode || "") : "—";
  const startDate = formatFieldValue("startDate", record.startDate);
  const endDate = formatFieldValue("endDate", record.endDate);
  const idValue = record.id !== undefined ? String(record.id) : "";
  const description = typeof record.description === "string" ? record.description : "";
  const count = record._count as Record<string, number> | undefined;
  const studentCount =
    Number(record.studentCount ?? record.totalMembers ?? count?.students ?? count?.enrollments ?? 0) || 0;
  const students = Array.isArray(record.students)
    ? record.students
    : Array.isArray(record.enrollments)
      ? record.enrollments
      : [];

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-md transition-all duration-300 hover:shadow-lg">
      <div className="relative border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white px-4 py-3.5">
        <div className="absolute top-0 left-0 h-[3px] w-full bg-gradient-to-r from-emerald-500 to-teal-500" />
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-sm font-bold text-white shadow-sm shadow-emerald-200">
            {getInitials(title)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-sm font-extrabold text-slate-900 tracking-tight">{title}</h3>
              {idValue && (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600 border border-slate-200/50">
                  #{idValue}
                </span>
              )}
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700 border border-blue-100/50">
                <Calendar size={10} className="text-blue-500 shrink-0" />
                {startDate} - {endDate}
              </span>
            </div>
            <div className="mt-1.5 flex items-center gap-2 text-xs text-slate-500">
              <Hash size={11} className="text-slate-400 shrink-0" />
              <span className="truncate font-mono font-medium text-slate-600 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-100">{classCode}</span>
              {record.status !== undefined && (
                <span className={`ml-1 rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${getStatusClass(record.status)}`}>
                  {formatFieldValue("status", record.status)}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-slate-50/40 p-3.5 flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <div className="flex items-start gap-2.5 rounded-xl border border-slate-100 bg-white p-3 shadow-xs">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
              <BookOpen size={16} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Khóa học</div>
              <div className="mt-0.5 truncate text-xs font-semibold text-slate-800">{courseName}</div>
            </div>
          </div>

          <div className="flex items-start gap-2.5 rounded-xl border border-slate-100 bg-white p-3 shadow-xs">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-600">
              <ShieldCheck size={16} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Hình thức học</div>
              <div className="mt-0.5 text-xs font-semibold text-slate-800">{classType}</div>
            </div>
          </div>

          <div className="flex items-start gap-2.5 rounded-xl border border-slate-100 bg-white p-3 shadow-xs">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
              <UserRound size={16} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Giáo viên phụ trách</div>
              <div className={`mt-0.5 text-xs font-semibold ${teacher === "Chưa có" ? "text-slate-400 italic" : "text-slate-800"}`}>
                {teacher}
              </div>
            </div>
          </div>

          <div className="flex items-start gap-2.5 rounded-xl border border-slate-100 bg-white p-3 shadow-xs">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
              <Users size={16} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Sĩ số lớp</div>
              <div className="mt-0.5 text-xs font-semibold text-slate-800">{studentCount} học viên</div>
            </div>
          </div>

          <div className="col-span-1 sm:col-span-2 flex items-start gap-2.5 rounded-xl border border-slate-100 bg-white p-3 shadow-xs">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
              <Clock size={16} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Mô tả lớp học</div>
              <div className={`mt-0.5 text-xs ${description ? "text-slate-800 leading-relaxed" : "text-slate-400 italic"}`}>
                {description || "Chưa có mô tả cho lớp học này"}
              </div>
            </div>
          </div>
        </div>

        {students.length > 0 && (
          <div className="border-t border-slate-200/50 pt-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                <Users size={12} className="text-slate-400" />
                Danh sách học viên
              </div>
              <span className="rounded-full bg-slate-200/50 px-2 py-0.5 text-[9px] font-bold text-slate-600">
                {students.length} thành viên
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {students.map((item: unknown, index: number) => {
                const member = getStudentFromEnrollment(
                  isRecord(item) ? item : {},
                );

                return (
                  <button
                    key={`class-member-${member.id ?? index}`}
                    type="button"
                    onClick={() => {
                      if (onSelect && member.id) {
                        onSelect(`Xem chi tiết học viên ${member.name} #${member.id}`);
                      }
                    }}
                    disabled={!onSelect}
                    className="group flex items-center gap-1.5 rounded-md bg-white hover:bg-indigo-50/50 border border-slate-100 hover:border-indigo-100 px-2.5 py-1 transition-all duration-200 text-left cursor-pointer shadow-2xs"
                  >
                    <div className="flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded bg-indigo-50 text-indigo-500 group-hover:bg-indigo-100 group-hover:text-indigo-600 transition-colors">
                      <UserRound size={10} />
                    </div>
                    <div className="min-w-0 flex items-center gap-1.5">
                      <span className="text-[11px] font-bold text-slate-700 group-hover:text-indigo-700 transition-colors truncate max-w-[120px] sm:max-w-none">
                        {member.name}
                      </span>
                      {member.id !== undefined && (
                        <span className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[8px] font-medium text-slate-500 group-hover:bg-indigo-100/50 group-hover:text-indigo-600 transition-colors">
                          #{String(member.id)}
                        </span>
                      )}
                      {member.email && (
                        <span className="hidden sm:inline text-[9px] text-slate-400 border-l border-slate-200 pl-1.5 group-hover:text-indigo-500/70 transition-colors truncate max-w-[120px]">
                          {member.email}
                        </span>
                      )}
                      {member.phone && (
                        <span className="hidden md:inline text-[9px] text-slate-400 border-l border-slate-200 pl-1.5 group-hover:text-indigo-500/70 transition-colors truncate max-w-[90px]">
                          {member.phone}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function renderCourseProfileCard(record: Record<string, unknown>, onSelect?: (msg: string) => void) {
  const title = String(record.title || record.name || "Chưa có tên");
  const courseCode = String(record.courseCode || record.code || "Chưa có");
  const level = formatFieldValue("level", record.level);
  const description = typeof record.description === "string" ? record.description : "";
  
  const count = record._count as Record<string, number> | undefined;
  const classesCount = Number(record.classCount ?? count?.classes ?? 0) || 0;
  const studentsCount =
    Number(record.studentCount ?? record.totalMembers ?? count?.students ?? 0) || 0;
  const classesList = Array.isArray(record.classes) ? record.classes : [];

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-md transition-all duration-300 hover:shadow-lg">
      <div className="relative border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white px-4 py-3.5">
        <div className="absolute top-0 left-0 h-[3px] w-full bg-gradient-to-r from-indigo-500 to-purple-500" />
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-sm font-bold text-white shadow-sm shadow-indigo-200">
            {getInitials(title)}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-extrabold text-slate-900 tracking-tight">{title}</h3>
            <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
              <Hash size={11} className="text-slate-400 shrink-0" />
              <span className="truncate font-mono font-medium text-slate-600 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-100">{courseCode}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2.5 bg-slate-50/40 p-4">
        <div className="flex flex-col items-center justify-center rounded-xl border border-slate-100 bg-white p-3 shadow-xs text-center transition-all duration-200 hover:border-slate-350">
          <Award size={16} className="text-amber-500 mb-1" />
          <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Cấp độ</div>
          <div className="mt-1 text-sm font-extrabold text-slate-800">{level !== "Chưa có" ? level : "—"}</div>
        </div>

        <div className="flex flex-col items-center justify-center rounded-xl border border-slate-100 bg-white p-3 shadow-xs text-center transition-all duration-200 hover:border-slate-350">
          <BookOpen size={16} className="text-indigo-500 mb-1" />
          <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Lớp học</div>
          <div className="mt-1 text-sm font-extrabold text-slate-800">{classesCount}</div>
        </div>

        <div className="flex flex-col items-center justify-center rounded-xl border border-slate-100 bg-white p-3 shadow-xs text-center transition-all duration-200 hover:border-slate-350">
          <Users size={16} className="text-emerald-500 mb-1" />
          <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Học viên</div>
          <div className="mt-1 text-sm font-extrabold text-slate-800">{studentsCount}</div>
        </div>
      </div>

      {description && (
        <div className="px-4 pb-3 pt-1 text-xs text-slate-600 bg-white border-t border-slate-50">
          <div className="font-bold text-[10px] text-slate-450 uppercase tracking-wider mb-1">Mô tả khóa học</div>
          <p className="leading-relaxed bg-slate-50 p-2 rounded-lg border border-slate-100">{description}</p>
        </div>
      )}

      {classesList.length > 0 && (
        <div className="border-t border-slate-100 bg-white p-4">
          <div className="mb-3 text-[11px] font-extrabold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
            <GraduationCap size={13} className="text-slate-400" />
            Danh sách lớp học thuộc khóa
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {classesList.map((c: any) => (
              <div 
                key={c.id} 
                onClick={() => onSelect?.(`Xem chi tiết lớp học ${c.title || c.classCode} #${c.id}`)}
                className={`group flex items-center justify-between p-3 rounded-xl border border-slate-150 bg-slate-50/50 transition-all duration-350 hover:border-slate-300 hover:shadow-xs ${
                  onSelect ? 'cursor-pointer hover:bg-slate-100/50' : ''
                }`}
              >
                <div className="min-w-0 flex-1 pr-2">
                  <div className="text-xs font-bold text-slate-800 group-hover:text-indigo-600 transition-colors duration-200 truncate">{c.title || c.classCode}</div>
                  <div className="text-[10px] text-slate-500 mt-1 flex items-center gap-1.5">
                    <span className="font-mono bg-white px-1 py-0.5 rounded border border-slate-200/50">{c.classCode}</span>
                    <span className="flex items-center gap-0.5"><Users size={9} /> {c._count?.enrollments || c.studentCount || 0} học viên</span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {c.status && (
                    <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full ${getStatusClass(c.status)}`}>
                      {c.status}
                    </span>
                  )}
                  {onSelect && (
                    <ChevronRight size={14} className="text-slate-400 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-slate-700" />
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function renderProfileCard(data: unknown, index?: number, toolName?: string, onSelect?: (msg: string) => void) {
  if (!data || typeof data !== "object") {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-2.5 text-xs text-slate-700">
        {formatFieldValue("value", data)}
      </div>
    );
  }

  let record = data as Record<string, unknown>;

  // Check if it is a student record
  const isStudent =
    record.fullName !== undefined ||
    record.student !== undefined ||
    (toolName && toolName.toLowerCase().includes("student"));

  if (isStudent) {
    if (record.student && typeof record.student === "object") {
      record = record.student as Record<string, unknown>;
    }
    return renderStudentProfileCard(record, onSelect);
  }

  // Check if it is a class record
  const isClass =
    record.classCode !== undefined ||
    (toolName && (toolName.toLowerCase().includes("class") || toolName === "create_class"));

  if (isClass) {
    return renderClassProfileCard(record, onSelect);
  }

  const isCourse =
    record.courseCode !== undefined ||
    toolName === "create_course" ||
    toolName === "search_course";

  if (isCourse) {
    return renderCourseProfileCard(record, onSelect);
  }

  const entries = Object.entries(record).filter(
    ([key]) => !HIDDEN_FIELDS.has(key),
  );
  const title = getRecordTitle(record, index);
  const contactEntries = CONTACT_FIELDS.filter(
    (key) => key in record && !HIDDEN_FIELDS.has(key),
  ).map((key) => [key, record[key]] as const);
  const detailEntries = DETAIL_FIELDS.filter(
    (key) => key in record && !HIDDEN_FIELDS.has(key),
  ).map((key) => [key, record[key]] as const);
  const extraEntries = entries.filter(
    ([key]) =>
      !PROFILE_HEADER_FIELDS.has(key) &&
      !CONTACT_FIELDS.includes(key) &&
      !DETAIL_FIELDS.includes(key),
  );

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 bg-white px-2.5 py-2">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white">
            {getInitials(title)}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <h3 className="break-words text-xs font-bold text-slate-950">
                {title}
              </h3>
              {record.id !== undefined && (
                <span className="rounded-full border border-slate-200 bg-slate-50 px-1.5 py-px text-[9px] font-semibold text-slate-500">
                  #{formatFieldValue("id", record.id)}
                </span>
              )}
            </div>

            <div className="mt-1 flex flex-wrap gap-1">
              {record.role !== undefined && (
                <span className="rounded-full border border-slate-200 bg-slate-50 px-1.5 py-px text-[9px] font-semibold uppercase text-slate-600">
                  {formatFieldValue("role", record.role)}
                </span>
              )}
              {record.status !== undefined && (
                <span
                  className={`rounded-full border px-1.5 py-px text-[9px] font-semibold uppercase ${getStatusClass(record.status)}`}
                >
                  {formatFieldValue("status", record.status)}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-1.5 bg-slate-50/70 p-1.5">
        {contactEntries.length > 0 && (
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {contactEntries.map(([key, value]) =>
              renderProfileField(key, value),
            )}
          </div>
        )}

        {detailEntries.length > 0 && (
          <div>
            <div className="mb-1 text-[9px] font-semibold uppercase text-slate-400">
              Thông tin hồ sơ
            </div>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {detailEntries.map(([key, value]) =>
                renderProfileField(key, value),
              )}
            </div>
          </div>
        )}

        {extraEntries.length > 0 && (
          <div>
            <div className="mb-1 text-[9px] font-semibold uppercase text-slate-400">
              Thông tin khác
            </div>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {extraEntries.map(([key, value]) =>
                renderProfileField(key, value),
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function getOptionMeta(option: SelectionOption, key: string) {
  const value = option.metadata?.[key];
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "";
}

function renderSelectionMeta(icon: React.ReactNode, value: string) {
  if (!value) return null;

  return (
    <span className="inline-flex min-w-0 items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-600">
      {icon}
      <span className="truncate">{value}</span>
    </span>
  );
}

function renderSelectionOption(
  option: SelectionOption,
  index: number,
  entity: string,
  intent?: string,
  onSelect?: (draftMessage: string) => void,
) {
  const phone = getOptionMeta(option, "phone");
  const email = getOptionMeta(option, "email");
  const address = getOptionMeta(option, "address");
  const courseCode = getOptionMeta(option, "courseCode");
  const classCode = getOptionMeta(option, "classCode");
  const classType = getOptionMeta(option, "classType");
  const courseTitle = getOptionMeta(option, "courseTitle");
  const teacherName = getOptionMeta(option, "teacherName");
  const startDate = getOptionMeta(option, "startDate");
  const endDate = getOptionMeta(option, "endDate");
  const status = getOptionMeta(option, "status");
  const description = getOptionMeta(option, "description");

  const handleClick = () => {
    if (onSelect) {
      let msg = `Chọn ${option.label} #${option.id}`;
      if (entity === "course" && intent === "create_class") {
        msg = `Chọn khóa học ${option.label} #${option.id} để tạo lớp`;
      } else if (
        entity === "student" &&
        intent === "assign_student_to_class"
      ) {
        msg = `Chọn học viên ${option.label} #${option.id} để thêm vào lớp`;
      } else if (entity === "class" && intent === "assign_student_to_class") {
        msg = `Chọn lớp học ${option.label} #${option.id} để thêm học viên`;
      } else if (entity === "course") {
        msg = `Xem chi tiết khóa học ${option.label} #${option.id}`;
      } else if (entity === "class") {
        msg = `Xem chi tiết lớp học ${option.label} #${option.id}`;
      } else if (entity === "student") {
        msg = `Xem chi tiết học viên ${option.label} #${option.id}`;
      }
      onSelect(msg);
    }
  };

  return (
    <div
      key={`${entity}-${option.id}`}
      onClick={handleClick}
      className={`flex items-start gap-3 rounded-xl border border-slate-200 bg-white px-3.5 py-3 shadow-2xs hover:shadow-xs transition-all duration-200 ${
        onSelect 
          ? "cursor-pointer hover:bg-slate-50/80 hover:border-indigo-300" 
          : ""
      }`}
    >
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-indigo-50 border border-indigo-100 text-xs font-bold text-indigo-700">
        {index + 1}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <div className="break-words text-sm font-extrabold text-slate-900">
            {option.label}
          </div>
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-mono font-bold text-slate-500">
            #{option.id}
          </span>
          {status && (
            <span
              className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase ${getStatusClass(status)}`}
            >
              {status}
            </span>
          )}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {renderSelectionMeta(<Hash size={11} />, courseCode)}
          {renderSelectionMeta(<Hash size={11} />, classCode)}
          {renderSelectionMeta(<ShieldCheck size={11} />, classType)}
          {renderSelectionMeta(<Hash size={11} />, courseTitle)}
          {renderSelectionMeta(<UserRound size={11} />, teacherName)}
          {renderSelectionMeta(<Phone size={11} />, phone)}
          {renderSelectionMeta(<Mail size={11} />, email)}
          {renderSelectionMeta(<MapPin size={11} />, address)}
          {renderSelectionMeta(
            <Calendar size={11} />,
            startDate ? formatFieldValue("startDate", startDate) : "",
          )}
          {renderSelectionMeta(
            <Calendar size={11} />,
            endDate ? formatFieldValue("endDate", endDate) : "",
          )}
          {description && (
            <span className="text-xs text-slate-550 italic">{description}</span>
          )}
          {!phone &&
            !email &&
            !address &&
            !courseCode &&
            !classCode &&
            !classType &&
            !courseTitle &&
            !teacherName &&
            !startDate &&
            !endDate &&
            option.description && (
              <span className="text-xs text-slate-500">
                {option.description}
              </span>
            )}
        </div>
      </div>
    </div>
  );
}

function getRecordValue(record: Record<string, unknown>, key: string) {
  return record[key];
}

function getNestedRecord(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return isRecord(value) ? value : null;
}

function renderEnrollmentResult(
  data: unknown,
  title = "Thông tin thêm vào lớp",
) {
  if (!isRecord(data)) return renderProfileResult(data);

  const user = getNestedRecord(data, "user");
  const course = getNestedRecord(data, "course");
  const courseClass = getNestedRecord(data, "courseClass");
  const studentName = String(
    user?.fullName || user?.name || getRecordValue(data, "userId") || ""
  );
  const courseName = String(
    courseClass?.title ||
      course?.title ||
      course?.name ||
      getRecordValue(data, "classId") ||
      getRecordValue(data, "courseId") ||
      ""
  );
  const role = getRecordValue(data, "roleInClass") || getRecordValue(data, "roleInCourse") || "STUDENT";
  const joinedAt = getRecordValue(data, "joinedAt") || getRecordValue(data, "createdAt");

  const formattedJoinedAt = joinedAt ? formatFieldValue("joinedAt", joinedAt) : "Chưa có";
  const roleLabel = role === "STUDENT" ? "Học viên" : role === "TEACHER" ? "Giáo viên" : String(role);

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-md transition-all duration-300 hover:shadow-lg">
      <div className="relative border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white px-4 py-3.5">
        <div className="absolute top-0 left-0 h-[3px] w-full bg-gradient-to-r from-emerald-500 to-green-500" />
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-green-600 text-white shadow-sm shadow-emerald-100">
              <GraduationCap size={16} />
            </div>
            <span className="truncate text-sm font-extrabold text-slate-900 tracking-tight">
              {title}
            </span>
          </div>
          {getRecordValue(data, "id") !== undefined && (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600 border border-slate-200/50">
              #{formatFieldValue("id", getRecordValue(data, "id"))}
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2.5 bg-slate-50/40 p-4 sm:grid-cols-2">
        <div className="flex items-start gap-2.5 rounded-xl border border-slate-100 bg-white p-3 shadow-xs">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
            <UserRound size={16} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-sans">Học viên</div>
            <div className="mt-0.5 text-xs font-semibold text-slate-800">{studentName}</div>
          </div>
        </div>

        <div className="flex items-start gap-2.5 rounded-xl border border-slate-100 bg-white p-3 shadow-xs">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-600">
            <Award size={16} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Vai trò trong lớp</div>
            <div className="mt-0.5 text-xs font-semibold text-slate-800">{roleLabel}</div>
          </div>
        </div>

        <div className="flex items-start gap-2.5 rounded-xl border border-slate-100 bg-white p-3 shadow-xs">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
            <BookOpen size={16} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Lớp học</div>
            <div className="mt-0.5 text-xs font-semibold text-slate-800">{courseName}</div>
          </div>
        </div>

        <div className="flex items-start gap-2.5 rounded-xl border border-slate-100 bg-white p-3 shadow-xs">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
            <Calendar size={16} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Ngày ghi danh</div>
            <div className="mt-0.5 text-xs font-semibold text-slate-800">{formattedJoinedAt}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function renderActionInputSummary(input: unknown) {
  if (!isRecord(input)) return renderProfileResult(input);

  const entries = Object.entries(input).filter(
    ([, value]) => value !== undefined && value !== null && value !== "",
  );

  return (
    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
      {entries.map(([key, value]) => (
        <div
          key={key}
          className="flex items-start gap-2.5 rounded-xl border border-slate-100 bg-white p-3 shadow-xs transition-all duration-200 hover:border-slate-350"
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-50 border border-slate-200/50">
            {getFieldIcon(key)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              {formatFieldLabel(key)}
            </div>
            <div className="mt-0.5 break-words text-xs font-semibold text-slate-800 leading-snug">
              {formatFieldValue(key, value)}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

const QUICK_SUGGESTIONS = [
  {
    label: "Tạo học viên",
    draft: "Tạo học viên mới",
    icon: UserRound,
    color: "text-blue-600 bg-blue-50 border-blue-100 hover:bg-blue-100 hover:text-blue-700 hover:border-blue-200",
  },
  {
    label: "Tạo khóa học",
    draft: "Tạo khóa học mới",
    icon: BookOpen,
    color: "text-indigo-600 bg-indigo-50 border-indigo-100 hover:bg-indigo-100 hover:text-indigo-700 hover:border-indigo-200",
  },
  {
    label: "Tạo lớp học",
    draft: "Tạo lớp học mới",
    icon: GraduationCap,
    color: "text-purple-600 bg-purple-50 border-purple-100 hover:bg-purple-100 hover:text-purple-700 hover:border-purple-200",
  },
  {
    label: "Ghi danh",
    draft: "Ghi danh học viên",
    icon: Plus,
    color: "text-emerald-600 bg-emerald-50 border-emerald-100 hover:bg-emerald-100 hover:text-emerald-700 hover:border-emerald-200",
  },
  {
    label: "Tìm học viên",
    draft: "Tìm kiếm học viên",
    icon: Search,
    color: "text-amber-600 bg-amber-50 border-amber-100 hover:bg-amber-100 hover:text-amber-700 hover:border-amber-200",
  },
  {
    label: "Xem lớp học",
    draft: "Xem danh sách lớp học",
    icon: MessageSquare,
    color: "text-slate-600 bg-slate-50 border-slate-200 hover:bg-slate-100 hover:text-slate-700 hover:border-slate-350",
  },
];

export default function CopilotPage() {
  // Render đầu tiên phải SSR-safe: KHÔNG đọc localStorage/snapshot ở đây (server
  // luôn trả null) để tránh hydration mismatch. Khôi phục session được thực hiện
  // trong useEffect sau khi hydrate (xem effect bootstrap bên dưới).
  const [sessions, setSessions] = useState<CopilotSession[]>([]);
  const [messages, setMessages] = useState<CopilotMessage[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [pendingConfirmation, setPendingConfirmation] =
    useState<PendingConfirmation | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const shouldRestoreScrollRef = useRef(false);
  const didBootstrapRef = useRef(false);

  const activateSession = useCallback((sessionId: number | null) => {
    setActiveSessionId(sessionId);
    storeActiveSessionId(sessionId);
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  }, []);

  useEffect(() => {
    if (shouldRestoreScrollRef.current) {
      window.requestAnimationFrame(() => {
        if (messagesScrollRef.current) {
          messagesScrollRef.current.scrollTop = copilotClientSnapshot.scrollTop;
        }
        shouldRestoreScrollRef.current = false;
      });
      return;
    }

    scrollToBottom();
  }, [messages, sending, scrollToBottom]);

  useEffect(() => {
    copilotClientSnapshot.sessions = sessions;
    copilotClientSnapshot.messages = messages;
    copilotClientSnapshot.activeSessionId = activeSessionId;
    copilotClientSnapshot.input = input;
    copilotClientSnapshot.pendingConfirmation = pendingConfirmation;
  }, [activeSessionId, input, messages, pendingConfirmation, sessions]);

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await apiClient.get("/copilot/sessions");
      const nextSessions = res.data as CopilotSession[];
      setSessions(nextSessions);
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Không thể tải phiên chat"));
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchMessages = useCallback(async (sessionId: number) => {
    setLoadingMessages(true);
    try {
      const [messagesRes, sessionRes] = await Promise.all([
        apiClient.get(`/copilot/sessions/${sessionId}/messages`),
        apiClient.get(`/copilot/sessions/${sessionId}`),
      ]);
      const sessionData = sessionRes.data as CopilotSession;
      // Không dùng session đã CLOSED -> để caller bootstrap session mới.
      if (sessionData?.status && sessionData.status !== "ACTIVE") {
        return false;
      }
      const nextMessages = messagesRes.data as CopilotMessage[];
      const pendingAction = sessionData?.state?.pending_action;
      if (pendingAction) {
        const lastAssistant = [...nextMessages]
          .reverse()
          .find((message) => message.role === "assistant");
        let lastHasPendingPreview = false;
        if (lastAssistant) {
          try {
            const parsed = JSON.parse(lastAssistant.content);
            lastHasPendingPreview = Boolean(
              parsed?.type === "preview_card" && parsed?.pending_action,
            );
          } catch {
            lastHasPendingPreview = false;
          }
        }

        setMessages(
          lastHasPendingPreview
            ? nextMessages
            : [...nextMessages, buildPendingPreviewMessage(sessionId, pendingAction)],
        );
        return true;
      }

      setMessages(nextMessages);
      return true;
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Không thể tải tin nhắn"));
      return false;
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  // Bootstrap an toàn khi reload: hỏi backend session ACTIVE hiện tại (tạo mới
  // nếu chưa có). Không bao giờ dùng session đã CLOSED.
  const bootstrapCurrentSession = useCallback(async () => {
    try {
      const res = await apiClient.get("/copilot/sessions/current");
      const session = res.data as CopilotSession;
      if (session?.id) {
        setSessions((current) =>
          current.some((item) => item.id === session.id)
            ? current
            : [session, ...current],
        );
        activateSession(session.id);
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Không thể khởi tạo phiên chat"));
    }
  }, [activateSession]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchSessions();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [fetchSessions]);

  // Sau khi hydrate (chỉ chạy 1 lần ở client): đọc storage/snapshot rồi khôi phục
  // session, hoặc bootstrap session ACTIVE mới. Đọc localStorage ở đây (không phải
  // trong render) để tránh hydration mismatch.
  useEffect(() => {
    if (didBootstrapRef.current) return;
    didBootstrapRef.current = true;

    const storedId = readStoredActiveSessionId();
    if (!storedId) {
      void bootstrapCurrentSession();
      return;
    }

    const snapshotMatches =
      copilotClientSnapshot.activeSessionId === storedId &&
      copilotClientSnapshot.messages.length > 0;
    if (snapshotMatches) {
      setSessions(copilotClientSnapshot.sessions);
      setMessages(copilotClientSnapshot.messages);
      setInput(copilotClientSnapshot.input);
      setPendingConfirmation(copilotClientSnapshot.pendingConfirmation);
      shouldRestoreScrollRef.current = true;
    } else {
      setLoadingMessages(true);
    }
    // fetchMessages effect sẽ chạy khi activeSessionId set; nếu session CLOSED/
    // không hợp lệ -> fallback bootstrap.
    setActiveSessionId(storedId);
  }, [bootstrapCurrentSession]);

  useEffect(() => {
    if (activeSessionId) {
      const timer = window.setTimeout(() => {
        void fetchMessages(activeSessionId).then((loaded) => {
          if (!loaded) {
            // Session không hợp lệ/đã đóng -> bootstrap session ACTIVE mới.
            activateSession(null);
            setMessages([]);
            void bootstrapCurrentSession();
          }
        });
      }, 0);

      return () => window.clearTimeout(timer);
    }
  }, [activeSessionId, activateSession, fetchMessages, bootstrapCurrentSession]);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) || null,
    [sessions, activeSessionId],
  );

  // Có thao tác WRITE đang chờ confirm/cancel (preview_card + pending_action)?
  // Khi đó khóa composer như FluentGo (phase PREVIEW): user phải bấm Xác nhận /
  // Hủy trước khi gửi tin nhắn mới. Các bước clarification (chọn lớp, nhập lại
  // email...) trả về type khác nên KHÔNG rơi vào đây và vẫn nhập được bình thường.
  const hasPendingPreview = useMemo(() => {
    const lastAssistant = [...messages]
      .reverse()
      .find((message) => message.role === "assistant");
    if (!lastAssistant) return false;
    try {
      const parsed = JSON.parse(lastAssistant.content);
      return Boolean(
        parsed?.type === "preview_card" && parsed?.pending_action,
      );
    } catch {
      return false;
    }
  }, [messages]);
  const composerLocked = sending || hasPendingPreview;

  const startNewSession = useCallback(async () => {
    if (sending) return;
    setError("");
    const previousId = activeSessionId;

    // Đóng session cũ ở backend để clear pending_action/context nguy hiểm.
    // Best-effort: dù đóng lỗi vẫn tạo session mới, không confirm pending cũ.
    if (previousId) {
      try {
        await apiClient.patch(`/copilot/sessions/${previousId}/close`);
      } catch {
        // ignore
      }
    }

    // Reset UI ngay để không thao tác nhầm pending cũ.
    activateSession(null);
    setMessages([]);
    setInput("");
    setPendingConfirmation(null);
    setLoadingMessages(false);

    try {
      const res = await apiClient.post("/copilot/sessions", {});
      const session = res.data as CopilotSession;
      setSessions((current) => [
        session,
        ...current.filter((item) => item.id !== session.id),
      ]);
      activateSession(session.id);
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Không thể tạo cuộc trò chuyện mới"));
    }
  }, [activeSessionId, activateSession, sending]);

  const selectSession = useCallback(
    (sessionId: number) => {
      if (sending) return;
      setError("");
      setPendingConfirmation(null);
      if (sessionId !== activeSessionId) {
        setMessages([]);
        setLoadingMessages(true);
      }
      activateSession(sessionId);
      if (sessionId === activeSessionId) {
        void fetchMessages(sessionId);
      }
    },
    [activeSessionId, activateSession, fetchMessages, sending],
  );

  const deleteSession = async (sessionId: number) => {
    if (sending) return;
    const session = sessions.find((item) => item.id === sessionId);
    const confirmed = window.confirm(
      `Xóa cuộc trò chuyện "${session?.title || `Phiên #${sessionId}`}"?`,
    );
    if (!confirmed) return;

    setError("");
    try {
      await apiClient.delete(`/copilot/sessions/${sessionId}`);
      const remainingSessions = sessions.filter(
        (item) => item.id !== sessionId,
      );
      setSessions(remainingSessions);

      if (activeSessionId === sessionId) {
        activateSession(null);
        setMessages([]);
        setInput("");
        setPendingConfirmation(null);
        setLoadingMessages(false);
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Không thể xóa cuộc trò chuyện"));
    }
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    const content = input.trim();
    if (sending || !content || hasPendingPreview) return;

    let sessionId = activeSessionId;
    setSending(true);
    setError("");

    try {
      if (!sessionId) {
        const sessionRes = await apiClient.post("/copilot/sessions", {
          title: makeSessionTitle(content),
        });
        sessionId = (sessionRes.data as CopilotSession).id;
        setSessions((current) => [sessionRes.data, ...current]);
        activateSession(sessionId);
      }

      if (!sessionId) {
        throw new Error("Không thể xác định phiên chat để gửi tin nhắn");
      }

      setInput("");
      await apiClient.post(`/copilot/sessions/${sessionId}/turns`, { content });
      await fetchMessages(sessionId);
      await fetchSessions();
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Không thể gửi tin nhắn"));
    } finally {
      setSending(false);
    }
  };

  const confirmPendingAction = async (overrideInput?: any) => {
    if (!activeSessionId || sending) return;
    setSending(true);
    setError("");
    try {
      await apiClient.post(`/copilot/sessions/${activeSessionId}/confirm`, {
        input: overrideInput || (pendingConfirmation?.input)
      });
      setPendingConfirmation(null);
      await Promise.all([fetchMessages(activeSessionId), fetchSessions()]);
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Không thể xác nhận thao tác"));
    } finally {
      setSending(false);
    }
  };

  const cancelPendingAction = async () => {
    if (!activeSessionId || sending) return;
    setSending(true);
    setError("");
    try {
      await apiClient.post(`/copilot/sessions/${activeSessionId}/cancel`);
      setPendingConfirmation(null);
      await Promise.all([fetchMessages(activeSessionId), fetchSessions()]);
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Không thể hủy thao tác"));
    } finally {
      setSending(false);
    }
  };

  const applySuggestionDraft = async (
    draftMessage?: string,
    action?: SuggestionAction,
  ) => {
    if (!draftMessage?.trim() || sending) return;
    setSending(true);
    setError("");
    let sessionId = activeSessionId;
    try {
      if (!sessionId) {
        const sessionRes = await apiClient.post("/copilot/sessions", {
          title: makeSessionTitle(draftMessage),
        });
        sessionId = (sessionRes.data as CopilotSession).id;
        setSessions((current) => [sessionRes.data, ...current]);
        activateSession(sessionId);
      }

      if (!sessionId) {
        throw new Error("Không thể xác định phiên chat để gửi tin nhắn");
      }

      setInput("");
      await apiClient.post(`/copilot/sessions/${sessionId}/turns`, {
        content: draftMessage.trim(),
        ...(action ? { action } : {}),
      });
      await fetchMessages(sessionId);
      await fetchSessions();
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Không thể gửi tin nhắn"));
    } finally {
      setSending(false);
    }
  };

  const renderQuickSuggestionChips = () => {
    return (
      <div className="mx-auto mb-3.5 flex max-w-3xl flex-wrap items-center justify-center gap-2 px-1 select-none animate-in fade-in slide-in-from-bottom-2 duration-300">
        {QUICK_SUGGESTIONS.map((s, idx) => {
          const Icon = s.icon;
          return (
            <button
              key={`quick-sug-${idx}`}
              type="button"
              disabled={composerLocked}
              onClick={() => void applySuggestionDraft(s.draft)}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold shadow-2xs transition-all duration-200 hover:scale-102 hover:shadow-xs active:scale-98 disabled:opacity-50 disabled:pointer-events-none cursor-pointer ${s.color}`}
            >
              <Icon size={12} className="shrink-0" />
              <span>{s.label}</span>
            </button>
          );
        })}
      </div>
    );
  };

  const renderSuggestionButton = (
    label: string,
    description: string | undefined,
    draftMessage: string | undefined,
    key: string,
    metadata?: Record<string, unknown>,
    action?: SuggestionAction,
  ) => {
    const courseTitle = metadata?.courseTitle ? String(metadata.courseTitle) : "";
    const displayDescription = courseTitle 
      ? `Khóa học: ${courseTitle}${description ? ` • ${description}` : ""}`
      : description;

    return (
      <button
        key={key}
        type="button"
        onClick={() => {
          void applySuggestionDraft(draftMessage, action);
        }}
        className="group flex w-full min-w-0 items-start gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left transition hover:border-slate-300 hover:bg-slate-50"
      >
        <Sparkles
          size={14}
          className="mt-1 shrink-0 text-slate-400 group-hover:text-slate-700"
        />
        <span className="min-w-0 flex-1">
          <span className="block break-words text-[13px] font-semibold text-slate-900">
            {label}
          </span>
          {displayDescription && (
            <span className="mt-0.5 block break-words text-xs leading-5 text-slate-500">
              {displayDescription}
            </span>
          )}
        </span>
      </button>
    );
  };

  const renderSuggestions = (suggestions: unknown) => {
    if (!Array.isArray(suggestions) || suggestions.length === 0) return null;
    const validSuggestions = suggestions.filter(
      (item): item is ProactiveSuggestion =>
        Boolean(item) && typeof item === "object" && "title" in item,
    );
    if (validSuggestions.length === 0) return null;

    return (
      <div className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50 p-3">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase text-slate-500">
          <Sparkles size={13} />
          Gợi ý tiếp theo
        </div>
        <div className="space-y-2">
          {validSuggestions.map((suggestion) => {
            const options = Array.isArray(suggestion.options)
              ? suggestion.options
              : [];
            if (options.length === 0) {
              return renderSuggestionButton(
                suggestion.title,
                suggestion.message,
                suggestion.draft_message,
                suggestion.id,
                undefined,
                suggestion.action,
              );
            }

            return (
              <div key={suggestion.id} className="space-y-1.5">
                <div className="px-1">
                  <div className="text-[13px] font-semibold text-slate-900">
                    {suggestion.title}
                  </div>
                  <div className="text-xs leading-5 text-slate-500">
                    {suggestion.message}
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-1.5">
                  {options.map((option) =>
                    renderSuggestionButton(
                      option.label,
                      option.reason,
                      option.draft_message || suggestion.draft_message,
                      `${suggestion.id}-${option.id}`,
                      option.metadata,
                      option.action || suggestion.action,
                    ),
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const withSuggestions = (content: React.ReactNode, suggestions: unknown) => (
    <div className="space-y-3">
      {content}
      {renderSuggestions(suggestions)}
    </div>
  );

  const renderAssistantContent = (content: string, canAct = false) => {
    try {
      const data = JSON.parse(content);

      if (data.type === "clarification") {
        return withSuggestions(
          <div className="space-y-3">
            <div className="font-semibold text-amber-700">Cần làm rõ thêm</div>
            <p className="whitespace-pre-line text-sm text-slate-700">{data.message}</p>
            {data.clarification_type === "target_disambiguation" &&
              Array.isArray(data.options) &&
              data.options.length > 0 && (
                <div className="space-y-2">
                  {data.options.map((option: { key: string; label: string }) => (
                    <button
                      key={option.key}
                      type="button"
                      disabled={sending}
                      onClick={() => void applySuggestionDraft(option.key)}
                      className="flex w-full items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-left text-sm font-semibold text-amber-900 transition hover:bg-amber-100 disabled:opacity-50"
                    >
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-xs font-black text-amber-700">
                        {option.key}
                      </span>
                      <span className="min-w-0 break-words">
                        {option.label}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            {data.missing_fields?.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {data.missing_fields.map((field: string) => (
                  <span
                    key={field}
                    className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700"
                  >
                    {field}
                  </span>
                ))}
              </div>
            )}
          </div>,
          data.suggestions,
        );
      }

      if (data.type === "student_create_form") {
        return withSuggestions(
          <StudentCreateForm
            data={data}
            sending={sending}
            canAct={canAct}
            onSubmit={(input) => {
              const name = String(input.fullName || "").trim();
              void applySuggestionDraft(
                name ? `Tạo học viên: ${name}` : "Tạo học viên",
                {
                  type: "suggestion_action",
                  action: "create_student",
                  input,
                },
              );
            }}
          />,
          data.suggestions,
        );
      }

      if (data.type === "course_create_form") {
        return withSuggestions(
          <CourseCreateForm
            data={data}
            sending={sending}
            canAct={canAct}
            onSubmit={(input) => {
              const title = String(input.title || "").trim();
              void applySuggestionDraft(
                title ? `Tạo khóa học: ${title}` : "Tạo khóa học",
                {
                  type: "suggestion_action",
                  action: "create_course",
                  input,
                },
              );
            }}
          />,
          data.suggestions,
        );
      }

      if (data.type === "selection_list") {
        const options = Array.isArray(data.options)
          ? (data.options as SelectionOption[])
          : [];
        const totalCount =
          typeof data.total_count === "number"
            ? data.total_count
            : options.length;

        return withSuggestions(
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-sm font-semibold text-slate-900">
                {data.entity === "student"
                  ? "Kết quả học viên"
                  : "Kết quả tìm kiếm"}
              </div>
              {totalCount > 0 && (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                  {totalCount} kết quả
                </span>
              )}
            </div>
            <p className="text-sm text-slate-700">{data.message}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {options.map((option, index) =>
                renderSelectionOption(
                  option,
                  index,
                  data.entity || "option",
                  data.intent,
                  (msg) => void applySuggestionDraft(msg),
                ),
              )}
            </div>
          </div>,
          data.suggestions,
        );
      }

      if (data.type === "preview_card") {
        const isDanger = data.severity === "danger";
        const requestConfirmation = () => {
          if (!canAct) return;
          if (data.requires_modal_confirmation) {
            setPendingConfirmation({
              confirmation_title: data.confirmation_title,
              confirm_label: data.confirm_label,
              cancel_label: data.cancel_label,
              summary: data.summary,
              display_input: data.display_input,
              input: data.input,
              impact: data.impact,
            });
            return;
          }
          void confirmPendingAction();
        };

        return withSuggestions(
          <EditablePreviewCard
            key={JSON.stringify(data.pending_action?.input || data.input || {})}
            data={data}
            sending={sending}
            canAct={canAct}
            onCancel={() => void cancelPendingAction()}
            onConfirm={(overrideInput) => {
              if (!canAct) return;
              if (data.requires_modal_confirmation) {
                setPendingConfirmation({
                  confirmation_title: data.confirmation_title,
                  confirm_label: data.confirm_label,
                  cancel_label: data.cancel_label,
                  summary: data.summary,
                  display_input: data.display_input,
                  input: overrideInput ? { ...data.input, ...overrideInput } : data.input,
                  impact: data.impact,
                });
                return;
              }
              // If there's an override input, we might need to send it to the backend.
              // Wait, the backend confirm accepts optional input body. 
              // We'll update confirmPendingAction to accept overrideInput!
              void confirmPendingAction(overrideInput);
            }}
          />,
          data.suggestions,
        );
      }

      if (data.type === "tool_result") {
        const isEnrollmentResult =
          data.tool_name === "assign_student_to_course" ||
          data.tool_name === "assign_student_to_class" ||
          data.tool_name === "update_student_class_role" ||
          data.tool_name === "remove_student_from_class";
        const enrollmentTitle =
          data.tool_name === "assign_student_to_course"
            ? "Thông tin ghi danh vào khóa học"
            : data.tool_name === "assign_student_to_class"
              ? "Thông tin thêm vào lớp"
              : "Thông tin lớp học";

        return withSuggestions(
          <div className="space-y-2">
            <div className="text-sm font-semibold text-emerald-700">
              {data.status === "SUCCESS" ? "Đã thực hiện" : "Không thành công"}
            </div>
            <p className="whitespace-pre-line text-xs text-slate-700">{data.message}</p>
            <div className="font-mono text-[10px] text-slate-400">
              {data.tool_name}
            </div>
            {data.tool_name === "delete_students" ||
            data.tool_name === "delete_courses"
              ? renderDeleteResult(data.result || {})
              : isEnrollmentResult
                ? renderEnrollmentResult(data.result || {}, enrollmentTitle)
                : renderProfileResult(data.result || {}, data.tool_name, applySuggestionDraft)}
          </div>,
          data.suggestions,
        );
      }

      if (data.type === "error") {
        return withSuggestions(
          <div className="space-y-2">
            <div className="font-semibold text-red-700">Có lỗi</div>
            <p className="text-sm text-red-700">{data.message}</p>
          </div>,
          data.suggestions,
        );
      }

      return withSuggestions(
        <p className="text-sm text-slate-700">{data.message || content}</p>,
        data.suggestions,
      );
    } catch {
      return content;
    }
  };

  const isRestoringActiveSession =
    Boolean(activeSessionId) && loadingMessages && messages.length === 0;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-white text-slate-950">
      <Navbar />

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden bg-white lg:grid-cols-[288px_1fr]">
        <aside className="flex min-h-0 flex-col overflow-hidden border-b border-slate-200 bg-[#f9f9f9] lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between px-3 py-3">
            <div className="flex items-center gap-2 px-2 text-sm font-semibold text-slate-900">
              <PanelLeft size={18} />
              xiuuu
            </div>
            <button
              type="button"
              onClick={() => void startNewSession()}
              className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-700 transition hover:bg-slate-200/80"
              aria-label="Tạo cuộc trò chuyện mới"
            >
              <Plus size={18} />
            </button>
          </div>

          <div className="px-3 pb-3">
            <button
              type="button"
              onClick={() => void startNewSession()}
              className="flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-3 text-left text-sm font-medium text-slate-800 shadow-sm transition hover:bg-slate-50"
            >
              <MessageSquare size={17} className="text-slate-500" />
              Cuộc trò chuyện mới
            </button>
          </div>

          <div className="px-3 pb-2">
            <p className="px-2 py-1 text-[11px] font-semibold uppercase text-slate-500">
              Lịch sử
            </p>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4 [scrollbar-width:thin] [scrollbar-color:#d4d4d8_transparent]">
            {loading ? (
              <div className="flex items-center gap-2 px-3 py-2 text-sm text-slate-500">
                <LoaderCircle size={14} className="animate-spin" />
                Đang tải...
              </div>
            ) : sessions.length === 0 ? (
              <div className="px-3 py-2 text-sm text-slate-500">
                Chưa có cuộc trò chuyện nào.
              </div>
            ) : (
              <div className="space-y-1">
                {sessions.map((session) => (
                  <div
                    key={session.id}
                    className={`group flex w-full items-center gap-1 rounded-xl px-2 py-1.5 text-sm transition ${
                      activeSessionId === session.id
                        ? "bg-slate-200/80 text-slate-950"
                        : "text-slate-600 hover:bg-slate-200/60 hover:text-slate-950"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => selectSession(session.id)}
                      className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1 py-1 text-left"
                    >
                      <MessageSquare
                        size={15}
                        className="shrink-0 text-slate-400 group-hover:text-slate-600"
                      />
                      <span className="truncate">
                        {session.title || `Phiên #${session.id}`}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteSession(session.id)}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-red-50 hover:text-red-600"
                      aria-label={`Xóa ${session.title || `Phiên #${session.id}`}`}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>

        <main className="flex min-h-0 flex-col overflow-hidden bg-white">
          {isRestoringActiveSession ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 pb-16 text-slate-500">
              <LoaderCircle size={22} className="animate-spin" />
              <div className="text-sm font-medium">Đang mở lại cuộc trò chuyện...</div>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center px-4 pb-16">
              <div className="mb-5 text-4xl font-black tracking-tight text-slate-950 select-none bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
                xiuuu
              </div>
              <h2 className="mb-7 text-center text-2xl font-semibold text-slate-900">
                {activeSession?.title || "xiuuu có thể giúp gì cho bạn?"}
              </h2>
              {error && (
                <div className="mb-4 w-full max-w-2xl rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              )}
              <div className="w-full max-w-2xl">
                {renderQuickSuggestionChips()}
                <form
                  onSubmit={sendMessage}
                  className="relative rounded-[26px] border border-slate-200 bg-white p-2 shadow-[0_8px_30px_rgba(15,23,42,0.08)]"
                >
                  <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    className="h-12 w-full rounded-[20px] bg-transparent px-4 pr-14 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
                    placeholder='Bạn muốn tôi giúp gì'
                  />
                  <button
                    type="submit"
                    disabled={sending || !input.trim()}
                    className="absolute right-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-slate-950 text-white transition hover:bg-slate-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed"
                    aria-label="Gửi yêu cầu"
                  >
                    {sending ? (
                      <LoaderCircle size={16} className="animate-spin" />
                    ) : (
                      <SendHorizontal size={16} />
                    )}
                  </button>
                </form>

                <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => applySuggestionDraft("Tạo học viên mới")}
                    disabled={sending}
                    className="flex flex-col items-start p-4 text-left border border-slate-200 rounded-xl hover:bg-slate-50 transition disabled:opacity-50"
                  >
                    <span className="text-sm font-medium text-slate-900">Tạo học viên</span>
                    <span className="text-xs text-slate-500 mt-1">Đăng ký thông tin học viên vào hệ thống</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => applySuggestionDraft("Tạo khóa học mới")}
                    disabled={sending}
                    className="flex flex-col items-start p-4 text-left border border-slate-200 rounded-xl hover:bg-slate-50 transition disabled:opacity-50"
                  >
                    <span className="text-sm font-medium text-slate-900">Tạo khóa học</span>
                    <span className="text-xs text-slate-500 mt-1">Mở thêm chương trình đào tạo mới</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => applySuggestionDraft("Tìm kiếm học viên")}
                    disabled={sending}
                    className="flex flex-col items-start p-4 text-left border border-slate-200 rounded-xl hover:bg-slate-50 transition disabled:opacity-50"
                  >
                    <span className="text-sm font-medium text-slate-900">Tìm kiếm học viên</span>
                    <span className="text-xs text-slate-500 mt-1">Tra cứu thông tin học viên nhanh chóng</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => applySuggestionDraft("Xem danh sách khóa học")}
                    disabled={sending}
                    className="flex flex-col items-start p-4 text-left border border-slate-200 rounded-xl hover:bg-slate-50 transition disabled:opacity-50"
                  >
                    <span className="text-sm font-medium text-slate-900">Xem khóa học</span>
                    <span className="text-xs text-slate-500 mt-1">Hiển thị các khóa đang có trong hệ thống</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => applySuggestionDraft("Tạo lớp học mới")}
                    disabled={sending}
                    className="flex flex-col items-start p-4 text-left border border-slate-200 rounded-xl hover:bg-slate-50 transition disabled:opacity-50"
                  >
                    <span className="text-sm font-medium text-slate-900">Tạo lớp học</span>
                    <span className="text-xs text-slate-500 mt-1">Mở thêm lớp học mới trong một khóa học</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => applySuggestionDraft("Xem danh sách lớp học")}
                    disabled={sending}
                    className="flex flex-col items-start p-4 text-left border border-slate-200 rounded-xl hover:bg-slate-50 transition disabled:opacity-50"
                  >
                    <span className="text-sm font-medium text-slate-900">Xem lớp học</span>
                    <span className="text-xs text-slate-500 mt-1">Hiển thị các lớp đang có trong hệ thống</span>
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <>
              {error && (
                <div className="mx-auto w-full max-w-4xl px-4 pt-4">
                  <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                    {error}
                  </div>
                </div>
              )}

              <div
                ref={messagesScrollRef}
                onScroll={(event) => {
                  copilotClientSnapshot.scrollTop = event.currentTarget.scrollTop;
                }}
                className="flex-1 overflow-y-auto [scrollbar-width:thin] [scrollbar-color:#d4d4d8_transparent]"
              >
                <div className="mx-auto w-full max-w-4xl space-y-7 px-4 py-7">
                  {messages.map((message, index) => (
                    <div
                      key={message.id}
                      className={`flex gap-3 ${message.role === "user" ? "justify-end" : "justify-start"}`}
                    >
                      {message.role !== "user" && (
                        <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-950 text-white text-[9px] font-black tracking-tighter select-none">
                          xiuuu
                        </div>
                      )}
                      <div
                        className={`max-w-[min(680px,88%)] text-sm leading-6 ${
                          message.role === "user"
                            ? "rounded-[22px] bg-[#f4f4f4] px-4 py-3 text-slate-900"
                            : "min-w-0 flex-1 text-slate-800"
                        }`}
                      >
                        {message.role === "assistant"
                          ? renderAssistantContent(
                              message.content,
                              index === messages.length - 1,
                            )
                          : message.content}
                      </div>
                    </div>
                  ))}
                  {sending && (
                    <div className="flex gap-3 justify-start">
                      <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-950 text-white text-[9px] font-black tracking-tighter select-none">
                        xiuuu
                      </div>
                      <div className="flex items-center space-x-1.5 h-10 min-w-0 flex-1">
                        <div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                        <div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                        <div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce"></div>
                      </div>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>
              </div>

              <div className="shrink-0 border-t border-transparent px-4 pb-5 pt-2">
                {renderQuickSuggestionChips()}
                <form
                  onSubmit={sendMessage}
                  className="relative mx-auto max-w-3xl rounded-[26px] border border-slate-200 bg-white p-2 shadow-[0_8px_30px_rgba(15,23,42,0.08)]"
                >
                  <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    disabled={composerLocked}
                    className="h-12 w-full rounded-[20px] bg-transparent px-4 pr-14 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none disabled:cursor-not-allowed disabled:text-slate-400"
                    placeholder={
                      hasPendingPreview
                        ? "Hãy Xác nhận hoặc Hủy thao tác đang chờ..."
                        : "Nhập yêu cầu..."
                    }
                  />
                  <button
                    type="submit"
                    disabled={composerLocked || !input.trim()}
                    className="absolute right-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-slate-950 text-white transition hover:bg-slate-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed"
                    aria-label="Gửi yêu cầu"
                  >
                    {sending ? (
                      <LoaderCircle size={16} className="animate-spin" />
                    ) : (
                      <SendHorizontal size={16} />
                    )}
                  </button>
                </form>
                {hasPendingPreview && (
                  <p className="mx-auto mt-2 max-w-3xl px-2 text-center text-xs text-amber-600">
                    Đang chờ bạn <strong>Xác nhận</strong> hoặc{" "}
                    <strong>Hủy</strong> thao tác phía trên. Ô nhập tạm khóa để
                    tránh thao tác nhầm.
                  </p>
                )}
              </div>
            </>
          )}
        </main>
      </div>
      {pendingConfirmation && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="danger-confirmation-title"
            className="w-full max-w-xl overflow-hidden rounded-2xl border border-red-200 bg-white shadow-xl animate-in zoom-in-95 duration-200"
          >
            <div className="flex items-start gap-3 border-b border-red-100 bg-red-50 px-5 py-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-700">
                <AlertTriangle size={20} />
              </div>
              <div>
                <h3
                  id="danger-confirmation-title"
                  className="text-base font-bold text-red-900"
                >
                  {pendingConfirmation.confirmation_title ||
                    "Bạn có chắc chắn không?"}
                </h3>
                <p className="mt-1 text-sm text-red-700">
                  {pendingConfirmation.summary}
                </p>
              </div>
            </div>
            <div className="max-h-[60vh] space-y-4 overflow-y-auto p-5">
              {renderActionInputSummary(
                pendingConfirmation.display_input ||
                  pendingConfirmation.input ||
                  {},
              )}
              {pendingConfirmation.impact &&
                Object.keys(pendingConfirmation.impact).length > 0 && (
                  <div>
                    <div className="mb-2 text-sm font-semibold text-slate-900">
                      Dữ liệu bị ảnh hưởng
                    </div>
                    {renderActionInputSummary(pendingConfirmation.impact)}
                  </div>
                )}
              <p className="text-sm leading-6 text-slate-600">
                Hãy kiểm tra đúng học viên, khóa học và lớp trước khi tiếp tục.
                Thao tác chỉ được thực hiện sau khi bạn bấm nút xác nhận bên
                dưới.
              </p>
            </div>
            <div className="flex justify-end gap-2.5 border-t border-slate-100 px-5 py-4">
              <button
                type="button"
                disabled={sending}
                onClick={() => void cancelPendingAction()}
                className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition cursor-pointer disabled:opacity-50"
              >
                {pendingConfirmation.cancel_label || "Không, quay lại"}
              </button>
              <button
                type="button"
                disabled={sending}
                onClick={() => void confirmPendingAction()}
                className="px-4 py-2.5 bg-red-650 hover:bg-red-505 text-white rounded-xl text-xs font-bold transition shadow-sm cursor-pointer disabled:opacity-50"
              >
                {sending
                  ? "Đang thực hiện..."
                  : pendingConfirmation.confirm_label || "Xác nhận"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
