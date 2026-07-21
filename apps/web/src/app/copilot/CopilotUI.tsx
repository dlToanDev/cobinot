
"use client";

import React from "react";
import {
  AlertTriangle,
  ArrowUp,
  BookOpen,
  CheckCircle2,
  GraduationCap,
  LoaderCircle,
  MessageSquare,
  PanelLeft,
  Plus,
  Trash2,
  UserRound,
  X,
  XCircle,
} from "lucide-react";

export type CopilotSessionItem = {
  id: number;
  title?: string | null;
  status: string;
  updatedAt?: string;
};

export type CopilotQuickSuggestion = {
  label: string;
  draft: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
};

export type CopilotSelectionOption = {
  id: number | string;
  label: string;
  description?: string;
  metadata?: Record<string, unknown>;
};

const formatTime = (value?: string) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
  });
};

const readMeta = (option: CopilotSelectionOption, key: string) => {
  const value = option.metadata?.[key];
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "";
};

// ---- Header -------------------------------------------------------------------

export function CopilotHeader({
  hasPendingPreview,
  sending,
  onNewChat,
  onToggleSidebar,
}: {
  hasPendingPreview: boolean;
  sending: boolean;
  onNewChat: () => void;
  onToggleSidebar: () => void;
}) {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-zinc-200 bg-white px-3 md:px-4">
      <div className="flex min-w-0 items-center gap-1.5">
        <button
          type="button"
          onClick={onToggleSidebar}
          className="flex h-8 w-8 items-center justify-center rounded-[10px] text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 lg:hidden"
          aria-label="Mở lịch sử chat"
        >
          <PanelLeft size={17} />
        </button>
        <h1 className="truncate text-sm font-semibold text-zinc-900">
          Xiuuu
        </h1>
        <span className="ml-1 hidden items-center gap-1.5 text-xs text-zinc-400 sm:inline-flex">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          Trực tuyến
        </span>
        {hasPendingPreview && (
          <span className="ml-1 truncate rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700">
            Bản nháp chờ xác nhận
          </span>
        )}
      </div>

      <button
        type="button"
        disabled={sending}
        onClick={onNewChat}
        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[10px] border border-zinc-200 bg-white px-2.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Plus size={14} />
        Chat mới
      </button>
    </header>
  );
}

// ---- Sidebar --------------------------------------------------------------------

export function CopilotSessionSidebar({
  sessions,
  activeSessionId,
  loading,
  sending,
  open,
  hasMore,
  loadingMore,
  onLoadMore,
  onClose,
  onNewSession,
  onSelectSession,
  onDeleteSession,
}: {
  sessions: CopilotSessionItem[];
  activeSessionId: number | null;
  loading: boolean;
  sending: boolean;
  open: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onClose: () => void;
  onNewSession: () => void;
  onSelectSession: (sessionId: number) => void;
  onDeleteSession: (sessionId: number) => void;
}) {
  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-30 bg-zinc-900/40 lg:hidden"
          onClick={onClose}
          aria-hidden
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[280px] shrink-0 flex-col border-r border-zinc-200 bg-zinc-50 transition-transform duration-200 lg:static lg:z-auto lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between px-3 pb-1 pt-3 lg:pt-3">
          <span className="px-1 text-[13px] font-semibold text-zinc-900">
            Lịch sử chat
          </span>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-[10px] text-zinc-500 transition hover:bg-zinc-200/70 lg:hidden"
            aria-label="Đóng lịch sử chat"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-3 pb-2 pt-1">
          
          <button
            type="button"
            onClick={onNewSession}
            disabled={sending}
            className="flex w-full items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-left text-[13px] font-medium text-zinc-800 shadow-xs transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus size={15} className="text-zinc-500" />
            Đoạn chat mới
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 [scrollbar-width:thin]">
          {loading ? (
            <div className="space-y-1.5 px-1 pt-1">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-8 animate-pulse rounded-lg bg-zinc-200/60"
                />
              ))}
            </div>
          ) : sessions.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-3 py-8 text-center">
              <MessageSquare size={18} className="text-zinc-300" />
              <p className="text-xs leading-5 text-zinc-400">
                Chưa có cuộc trò chuyện nào.
                <br />
                Bấm &quot;Đoạn chat mới&quot; để bắt đầu.
              </p>
            </div>
          ) : (
            <div className="space-y-0.5 pt-1">
              {sessions.map((session) => {
                const active = activeSessionId === session.id;
                return (
                  <div
                    key={session.id}
                    className={`group relative flex items-center rounded-lg transition ${
                      active ? "bg-zinc-200/70" : "hover:bg-zinc-200/40"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onSelectSession(session.id)}
                      disabled={sending}
                      className="min-w-0 flex-1 rounded-lg px-2.5 py-2 text-left disabled:cursor-not-allowed"
                    >
                      <span
                        className={`block truncate text-[13px] leading-5 ${
                          active
                            ? "font-medium text-zinc-900"
                            : "text-zinc-600 group-hover:text-zinc-900"
                        }`}
                      >
                        {session.title || `Phiên #${session.id}`}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteSession(session.id)}
                      disabled={sending}
                      className={`mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-zinc-400 transition hover:bg-zinc-300/50 hover:text-red-600 disabled:opacity-50 ${
                        active
                          ? "opacity-100"
                          : "opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
                      }`}
                      aria-label={`Xóa ${session.title || `Phiên #${session.id}`}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                );
              })}
              {hasMore && (
                <button
                  type="button"
                  onClick={onLoadMore}
                  disabled={loadingMore || sending}
                  className="mt-1 flex w-full items-center justify-center gap-2 rounded-lg px-2.5 py-2 text-[12px] font-medium text-zinc-500 transition hover:bg-zinc-200/40 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loadingMore && (
                    <LoaderCircle size={13} className="animate-spin" />
                  )}
                  {loadingMore ? "Đang tải..." : "Xem thêm"}
                </button>
              )}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

// ---- Composer -------------------------------------------------------------------

export function CopilotComposer({
  input,
  setInput,
  locked,
  sending,
  onSubmit,
  hasPendingPreview,
  autoFocus,
}: {
  input: string;
  setInput: (value: string) => void;
  locked: boolean;
  sending: boolean;
  onSubmit: (event: React.FormEvent) => void;
  hasPendingPreview: boolean;
  autoFocus?: boolean;
}) {
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  // Auto-resize theo nội dung; reset cả khi input bị clear programmatically
  // (sau khi gửi), vì setInput("") không fire onChange.
  React.useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
  }, [input]);

  return (
    <form
      onSubmit={onSubmit}
      className="flex items-end gap-2 rounded-[22px] border border-zinc-300 bg-white py-2 pl-4 pr-2 shadow-sm transition focus-within:border-zinc-400"
    >
      <textarea
        ref={textareaRef}
        value={input}
        disabled={locked}
        rows={1}
        autoFocus={autoFocus}
        onChange={(event) => setInput(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }}
        className="max-h-40 min-h-6 w-full flex-1 resize-none bg-transparent py-1 text-sm leading-6 text-zinc-900 outline-none placeholder:text-zinc-400 disabled:cursor-not-allowed disabled:text-zinc-400"
        placeholder={
          hasPendingPreview
            ? "Gõ thêm thông tin (VD: sdt là 0988..., email là abc@...) để cập nhật bản nháp..."
            : "Nhập yêu cầu..."
        }
      />
      <button
        type="submit"
        disabled={locked || !input.trim()}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-400"
        aria-label="Gửi yêu cầu"
      >
        {sending ? (
          <LoaderCircle size={15} className="animate-spin" />
        ) : (
          <ArrowUp size={15} />
        )}
      </button>
    </form>
  );
}

// ---- Message ---------------------------------------------------------------------

export function CopilotMessageBubble({
  role,
  createdAt,
  children,
}: {
  role: string;
  createdAt?: string;
  children: React.ReactNode;
}) {
  const isUser = role === "user";
  const time = formatTime(createdAt);

  if (isUser) {
    return (
      <div className="flex flex-col items-end">
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-[20px] bg-zinc-100 px-4 py-2.5 text-sm leading-6 text-zinc-900 sm:max-w-[75%]">
          {children}
        </div>
        {time && (
          <span className="mt-1 pr-1 text-[10px] leading-4 text-zinc-300">
            {time}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start">
      <div className="w-full min-w-0 text-sm leading-6 text-zinc-800">
        {children}
      </div>
      {time && (
        <span className="mt-1 pl-0.5 text-[10px] leading-4 text-zinc-300">
          {time}
        </span>
      )}
    </div>
  );
}

export function CopilotTypingIndicator() {
  return (
    <div className="flex items-center gap-1.5 py-1">
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.3s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.15s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400" />
    </div>
  );
}

// ---- Quick suggestions -----------------------------------------------------------

export function CopilotSuggestionChips({
  suggestions,
  disabled,
  onApply,
}: {
  suggestions: CopilotQuickSuggestion[];
  disabled: boolean;
  onApply: (draft: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      {suggestions.map((suggestion) => {
        const Icon = suggestion.icon;
        return (
          <button
            key={suggestion.label}
            type="button"
            disabled={disabled}
            onClick={() => onApply(suggestion.draft)}
            className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-[13px] text-zinc-600 transition hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-900 disabled:pointer-events-none disabled:opacity-50"
          >
            <Icon size={14} className="text-zinc-400" />
            {suggestion.label}
          </button>
        );
      })}
    </div>
  );
}

// ---- Empty state -----------------------------------------------------------------

export function CopilotEmptyState({
  error,
  suggestions,
  disabled,
  onApplySuggestion,
  composer,
}: {
  error?: string;
  suggestions: CopilotQuickSuggestion[];
  disabled: boolean;
  onApplySuggestion: (draft: string) => void;
  composer: React.ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-4 pb-10">
      <div className="w-full max-w-2xl">
        <h2 className="text-center text-xl font-semibold tracking-tight text-zinc-900 md:text-2xl">
          Bạn cần hỗ trợ gì hôm nay?
        </h2>
        <p className="mt-1.5 text-center text-[13px] leading-5 text-zinc-500">
          Quản lý học viên, khóa học, lớp học và ghi danh bằng tiếng Việt tự
          nhiên.
        </p>

        {error && <CopilotErrorCard message={error} className="mt-4" />}

        <div className="mt-6">{composer}</div>

        <div className="mt-4">
          <CopilotSuggestionChips
            suggestions={suggestions}
            disabled={disabled}
            onApply={onApplySuggestion}
          />
        </div>
      </div>
    </div>
  );
}

// ---- Clarification -----------------------------------------------------------------

export function CopilotClarificationCard({
  message,
  missingFields,
  options,
  sending,
  onSelectOption,
  labelForField,
}: {
  message: string;
  missingFields?: string[];
  options?: { key: string; label: string }[];
  sending: boolean;
  onSelectOption: (value: string) => void;
  labelForField: (field: string) => string;
}) {
  return (
    <div className="rounded-2xl border border-amber-200/70 bg-amber-50/60 px-4 py-3">
      <div className="flex items-start gap-2.5">
        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-500" />
        <div className="min-w-0 flex-1">
          <p className="whitespace-pre-line text-[13px] leading-6 text-zinc-800">
            {message}
          </p>
          {Array.isArray(missingFields) && missingFields.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {missingFields.map((field) => (
                <span
                  key={field}
                  className="rounded-md border border-amber-200 bg-white px-2 py-0.5 text-[11px] font-medium text-amber-800"
                >
                  Thiếu {labelForField(field).toLowerCase()}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      {Array.isArray(options) && options.length > 0 && (
        <div className="mt-3 grid gap-1.5">
          {options.map((option) => (
            <button
              key={option.key}
              type="button"
              disabled={sending}
              onClick={() => onSelectOption(option.key)}
              className="flex items-center gap-2.5 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-left text-[13px] text-zinc-800 transition hover:border-zinc-300 hover:bg-zinc-50 disabled:opacity-50"
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-[11px] font-semibold text-zinc-600">
                {option.key}
              </span>
              <span className="min-w-0 break-words">{option.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Candidate list -----------------------------------------------------------------

export function CopilotCandidateList({
  title,
  message,
  entity,
  totalCount,
  options,
  sending,
  onSelect,
}: {
  title: string;
  message?: string;
  entity?: string;
  totalCount: number;
  options: CopilotSelectionOption[];
  sending: boolean;
  onSelect: (option: CopilotSelectionOption, index: number) => void;
}) {
  const EntityIcon =
    entity === "course"
      ? BookOpen
      : entity === "class"
        ? GraduationCap
        : UserRound;

  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white">
      <div className="flex items-center justify-between gap-2 border-b border-zinc-100 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <EntityIcon size={15} className="shrink-0 text-zinc-400" />
          <div className="min-w-0">
            <h3 className="truncate text-[13px] font-semibold text-zinc-900">
              {title}
            </h3>
            {message && (
              <p className="truncate text-xs leading-4 text-zinc-500">
                {message}
              </p>
            )}
          </div>
        </div>
        <span className="shrink-0 rounded-md bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-zinc-500">
          {totalCount} kết quả
        </span>
      </div>

      <div className="divide-y divide-zinc-100">
        {options.map((option, index) => {
          const metaParts = [
            readMeta(option, "email"),
            readMeta(option, "phone"),
            readMeta(option, "courseCode"),
            readMeta(option, "level") && `Cấp độ ${readMeta(option, "level")}`,
            readMeta(option, "classType"),
            readMeta(option, "scheduleNote"),
          ].filter(Boolean);
          const status = readMeta(option, "status");

          return (
            <div
              key={`${entity || "candidate"}-${option.id}`}
              className="flex items-center gap-3 px-4 py-2.5"
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-[11px] font-semibold text-zinc-500">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="break-words text-[13px] font-medium text-zinc-900">
                    {option.label}
                  </span>
                  <span className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[10px] text-zinc-400">
                    #{option.id}
                  </span>
                  {status && (
                    <span className="rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                      {status}
                    </span>
                  )}
                </div>
                {(metaParts.length > 0 || option.description) && (
                  <p className="mt-0.5 truncate text-xs leading-4 text-zinc-500">
                    {metaParts.length > 0
                      ? metaParts.join(" · ")
                      : option.description}
                  </p>
                )}
              </div>
              <button
                type="button"
                disabled={sending}
                onClick={() => onSelect(option, index)}
                className="h-8 shrink-0 rounded-[10px] border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-50"
              >
                Chọn
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---- Result card shell ------------------------------------------------------------

export function CopilotResultCard({
  status,
  toolName,
  message,
  children,
}: {
  status?: string;
  toolName?: string;
  message?: string;
  children?: React.ReactNode;
}) {
  const success = status === "SUCCESS" || !status;
  const titleByTool: Record<string, string> = {
    search_student: "Thông tin học viên",
    create_student: "Đã tạo học viên",
    update_student: "Đã cập nhật học viên",
    create_course: "Đã tạo khóa học",
    update_course: "Đã cập nhật khóa học",
    create_class: "Đã tạo lớp học",
    update_class: "Đã cập nhật lớp học",
    get_class_detail: "Chi tiết lớp học",
    get_course_detail: "Chi tiết khóa học",
    assign_student_to_course: "Đã ghi danh vào các lớp trong khóa",
    assign_teacher_to_course: "Đã gán giáo viên phụ trách khóa",
    remove_student_from_class: "Đã xóa học viên khỏi lớp",
    delete_students: "Đã xóa học viên",
    delete_courses: "Đã xóa khóa học",
  };

  return (
    <div className="space-y-2.5">
      <div className="flex items-start gap-2">
        {success ? (
          <CheckCircle2 size={16} className="mt-1 shrink-0 text-emerald-600" />
        ) : (
          <XCircle size={16} className="mt-1 shrink-0 text-red-600" />
        )}
        <div className="min-w-0">
          <span className="text-sm font-semibold text-zinc-900">
            {toolName ? titleByTool[toolName] || "Đã thực hiện" : "Kết quả"}
          </span>
          {message && (
            <p className="mt-0.5 whitespace-pre-line text-[13px] leading-5 text-zinc-600">
              {message}
            </p>
          )}
        </div>
      </div>
      {children}
    </div>
  );
}

// ---- Error card --------------------------------------------------------------------

export function CopilotErrorCard({
  message,
  onRetry,
  className = "",
}: {
  message: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      className={`flex items-start gap-2.5 rounded-xl border border-red-200/80 bg-red-50/70 px-3.5 py-2.5 ${className}`}
    >
      <AlertTriangle size={15} className="mt-0.5 shrink-0 text-red-500" />
      <p className="min-w-0 flex-1 text-[13px] leading-5 text-red-800">
        {message}
      </p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 rounded-md border border-red-200 bg-white px-2 py-1 text-[11px] font-medium text-red-700 transition hover:bg-red-100"
        >
          Thử lại
        </button>
      )}
    </div>
  );
}
