"use client";

import React, { useState, useEffect, useRef } from "react";
import { apiClient } from "@/lib/api-client";
import { normalizeGeneratedCode } from "@hxstu/shared";
import { AlertTriangle, LoaderCircle, X } from "lucide-react";
import { formatFieldLabel, formatFieldValue, isRecord } from "./ResultBlocks";

const ACTION_TITLES: Record<string, string> = {
  create_course: "Tạo khóa học",
  update_course: "Cập nhật khóa học",
  create_class: "Tạo lớp học",
  update_class: "Cập nhật lớp học",
  create_student: "Tạo học viên",
  update_student: "Cập nhật học viên",
  assign_student_to_class: "Thêm học viên vào lớp",
  assign_student_to_course: "Ghi danh vào khóa học (chọn lớp trong khóa)",
  remove_student_from_class: "Xóa học viên khỏi lớp",
  delete_students: "Xóa học viên",
  delete_courses: "Xóa khóa học",
};

type EditablePreviewCardProps = {
  data: PreviewCardData;
  onConfirm: (overrideInput?: PreviewInput) => void;
  onCancel: () => void;
  onDraftChange?: (input: PreviewInput) => void;
  sending: boolean;
  canAct: boolean;
};

type PreviewInput = Record<string, unknown>;

type PreviewPendingAction = {
  input?: PreviewInput;
  display_input?: PreviewInput;
  validation_errors?: Record<string, string>;
  tool_name?: string;
  source?: string;
  draftId?: string;
};

type PreviewCardData = {
  severity?: "danger" | "default";
  tool_name: string;
  pending_action?: PreviewPendingAction;
  input?: PreviewInput;
  display_input?: PreviewInput;
  missingFields?: string[];
  message: string;
  summary?: string;
  cancel_label?: string;
  confirm_label?: string;
  related_courses?: RelatedCoursePreviewItem[];
};

type CourseOption = {
  id: number | string;
  title: string;
  courseCode?: string | null;
};

type CourseClassOption = {
  id: number | string;
  title?: string;
  classCode?: string | null;
  courseId?: number | string;
  courseTitle?: string;
};

type StudentOption = {
  id: number | string;
  fullName?: string;
  email?: string | null;
};

type RelatedCoursePreviewItem = {
  id: number | string;
  title: string;
  courseCode?: string | null;
  status?: string | null;
  level?: string | null;
};

const isGeneratedClassCodeWithType = (value: string) =>
  /(?:^|_)(?:WEEKLY|EXAM_PRACTICE)(?:_|$)/.test(normalizeGeneratedCode(value));

const replaceClassTypeInCode = (value: string, nextType: string) => {
  const normalizedCode = normalizeGeneratedCode(value);
  const normalizedType = normalizeGeneratedCode(nextType);
  if (!normalizedCode || !["WEEKLY", "EXAM_PRACTICE"].includes(normalizedType)) {
    return normalizedCode;
  }

  return normalizedCode.replace(
    /(^|_)(WEEKLY|EXAM_PRACTICE)(?=_|$)/,
    `$1${normalizedType}`,
  );
};

// yyyy-MM-dd theo GIỜ ĐỊA PHƯƠNG (toISOString là UTC, lệch ngày lúc 0h-7h VN).
const todayLocalDate = () => {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${mm}-${dd}`;
};

const inputClass = (hasError: boolean) =>
  `h-9 w-full rounded-[10px] border bg-white px-3 text-[13px] text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:ring-2 read-only:cursor-default read-only:bg-zinc-50 read-only:text-zinc-500 ${
    hasError
      ? "border-red-300 focus:border-red-400 focus:ring-red-100"
      : "border-zinc-200 focus:border-zinc-400 focus:ring-zinc-100"
  }`;

const textareaClass = (hasError: boolean) =>
  `w-full resize-none rounded-[10px] border bg-white px-3 py-2 text-[13px] leading-5 text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:ring-2 ${
    hasError
      ? "border-red-300 focus:border-red-400 focus:ring-red-100"
      : "border-zinc-200 focus:border-zinc-400 focus:ring-zinc-100"
  }`;

function FieldLabel({
  label,
  required,
}: {
  label: string;
  required?: boolean;
}) {
  return (
    <label className="mb-1 block text-[11px] font-medium leading-4 text-zinc-500">
      {label}
      {required && <span className="ml-0.5 text-red-500">*</span>}
    </label>
  );
}

function FieldError({ error }: { error?: string }) {
  if (!error) return null;
  return <p className="mt-1 text-[11px] leading-4 text-red-600">{error}</p>;
}

export default function EditablePreviewCard({
  data,
  onConfirm,
  onCancel,
  onDraftChange,
  sending,
  canAct,
}: EditablePreviewCardProps) {
  const isDanger = data.severity === "danger";
  const isCreateForm = [
    "create_course",
    "create_class",
    "create_student",
    "update_student",
    "update_course",
    "update_class",
    "assign_student_to_class",
  ].includes(data.tool_name);

  const pendingAction = data.pending_action || {};
  const validationErrors: Record<string, string> =
    pendingAction.validation_errors || {};

  // create_class + update_*: backend điền giá trị HIỆN TẠI của thực thể vào
  // display_input (enrichUpdateDisplayInput) -> merge để form không trống trơn;
  // input (chỉ chứa field user muốn đổi) đè lên sau cùng.
  const rawFormInput = [
    "create_class",
    "update_student",
    "update_course",
    "update_class",
  ].includes(data.tool_name)
    ? {
        ...(pendingAction.display_input || data.display_input || {}),
        ...(pendingAction.input || data.input || {}),
      }
    : pendingAction.input || data.input || {};
  // Backend gửi loại lớp ở field `type` (schema tool create_class), còn form
  // đọc `classType` -> prefill để select "Loại lớp" không bị trống khi user
  // đã nói "theo tuần"/"luyện đề".
  const formInputBase =
    ["create_class", "update_class"].includes(data.tool_name) &&
    !rawFormInput.classType &&
    rawFormInput.type
      ? { ...rawFormInput, classType: rawFormInput.type }
      : rawFormInput;
  // "Ngày vào lớp" mặc định là HÔM NAY (thời điểm thêm học viên vào lớp),
  // user vẫn sửa được trước khi Xác nhận. Backend cũng default now() nếu trống.
  const formInput =
    data.tool_name === "assign_student_to_class" && !formInputBase.joinedAt
      ? { ...formInputBase, joinedAt: todayLocalDate() }
      : formInputBase;
  const relatedCourses = Array.isArray(data.related_courses)
    ? data.related_courses
    : [];

  const [formData, setFormData] = useState<PreviewInput>(formInput);
  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [classes, setClasses] = useState<CourseClassOption[]>([]);
  const [students, setStudents] = useState<StudentOption[]>([]);
  const draftSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedCourseId = Number(formData.courseId || 0);
  const selectedCourseLabel = String(
    formData.courseLabel ||
      pendingAction.display_input?.courseName ||
      data.display_input?.courseName ||
      "",
  );
  const selectedCourseValue =
    selectedCourseId > 0
      ? String(selectedCourseId)
      : typeof formData.courseId === "string"
        ? formData.courseId
        : "";

  const courseOptions =
    selectedCourseId > 0 &&
    !courses.some((course) => Number(course.id) === selectedCourseId)
      ? [
          {
            id: selectedCourseId,
            title: selectedCourseLabel || `Khóa #${selectedCourseId}`,
            courseCode: "",
          },
          ...courses,
        ]
      : courses;

  const confirmDisabled = sending || !canAct;

  useEffect(() => {
    return () => {
      if (draftSyncTimerRef.current) {
        clearTimeout(draftSyncTimerRef.current);
      }
    };
  }, []);

  const scheduleDraftSync = (nextInput: PreviewInput) => {
    if (!onDraftChange || !canAct) return;
    if (draftSyncTimerRef.current) {
      clearTimeout(draftSyncTimerRef.current);
    }
    draftSyncTimerRef.current = setTimeout(() => {
      onDraftChange(nextInput);
    }, 350);
  };

  // Bản nháp GỘP nhiều học viên (userIds): hiển thị danh sách, cho bỏ bớt
  // từng người trước khi Xác nhận (giữ tối thiểu 1 người).
  const bulkUserIds: number[] = Array.isArray(formData.userIds)
    ? (formData.userIds as unknown[])
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0)
    : [];
  const isBulkAssign =
    data.tool_name === "assign_student_to_class" && bulkUserIds.length > 0;
  const bulkStudentDirectory = new Map<
    number,
    { label: string; email: string | null }
  >();
  const displayStudents = (data.display_input?.students ??
    pendingAction.display_input?.students) as unknown;
  if (Array.isArray(displayStudents)) {
    for (const item of displayStudents) {
      if (isRecord(item) && item.id !== undefined) {
        bulkStudentDirectory.set(Number(item.id), {
          label: String(item.label || `#${item.id}`),
          email: typeof item.email === "string" ? item.email : null,
        });
      }
    }
  }
  const removeBulkStudent = (id: number) => {
    if (bulkUserIds.length <= 1) return;
    const next = {
      ...formData,
      userIds: bulkUserIds.filter((value) => value !== id),
    };
    setFormData(next);
    scheduleDraftSync(next);
  };

  useEffect(() => {
    if (
      ["create_class", "update_class", "assign_student_to_class"].includes(
        data.tool_name,
      )
    ) {
      apiClient
        .get("/courses")
        .then((res) => {
          const courseList = Array.isArray(res.data)
            ? (res.data as CourseOption[])
            : [];
          setCourses(courseList);

          // Load all classes for these courses
          Promise.all(
            courseList.map((course) =>
              apiClient
                .get(`/courses/${course.id}/classes`)
                .then((r) =>
                  Array.isArray(r.data)
                    ? (r.data as Record<string, unknown>[]).map((cls) => ({
                        id: cls.id as number | string,
                        title:
                          typeof cls.title === "string" ? cls.title : undefined,
                        classCode:
                          typeof cls.classCode === "string"
                            ? cls.classCode
                            : null,
                        courseId: course.id,
                        courseTitle: course.title,
                      }))
                    : [],
                )
                .catch(() => []),
            ),
          ).then((results) => {
            setClasses(results.flat());
          });
        })
        .catch(() => {});
    }

    if (data.tool_name === "assign_student_to_class") {
      apiClient
        .get("/students")
        .then((res) => {
          setStudents(
            Array.isArray(res.data) ? (res.data as StudentOption[]) : [],
          );
        })
        .catch(() => {});
    }
  }, [data.tool_name]);

  const buildPreviewClassCode = (input: PreviewInput) => {
    const courseId = Number(input.courseId || 0);
    const selectedCourse = courseOptions.find(
      (course) => Number(course.id) === courseId,
    );
    const courseCode = selectedCourse?.courseCode || "";
    const courseTitle =
      selectedCourse?.title ||
      selectedCourseLabel ||
      String(input.courseName || "");
    const normalizePart = (value: string) =>
      normalizeGeneratedCode(value).replace(/^_+|_+$/g, "");

    return [
      normalizePart(courseCode || courseTitle),
      normalizePart(String(input.title || "")),
      normalizePart(String(input.type || input.classType || "WEEKLY")),
    ]
      .filter(Boolean)
      .join("_");
  };

  const patchGeneratedClassCode = (
    prev: PreviewInput,
    next: PreviewInput,
    changedName: string,
  ) => {
    if (data.tool_name !== "create_class" && data.tool_name !== "update_class") {
      return next;
    }

    const currentCode = String(prev.classCode || "");
    if (changedName === "classCode") {
      return {
        ...next,
        classCode: normalizeGeneratedCode(String(next.classCode || "")),
      };
    }

    if (changedName === "type" || changedName === "classType") {
      const nextType = String(next.type || next.classType || "");
      const nextClassCode =
        currentCode && isGeneratedClassCodeWithType(currentCode)
          ? replaceClassTypeInCode(currentCode, nextType)
          : !currentCode
            ? buildPreviewClassCode(next)
            : currentCode;

      return {
        ...next,
        classCode: nextClassCode,
      };
    }

    if (
      (changedName === "title" || changedName === "courseId") &&
      (!currentCode || isGeneratedClassCodeWithType(currentCode))
    ) {
      return { ...next, classCode: buildPreviewClassCode(next) };
    }

    return next;
  };

  const handleChange = (
    e: React.ChangeEvent<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >,
  ) => {
    const { name, value } = e.target;
    const next = patchGeneratedClassCode(
      formData,
      {
        ...formData,
        [name]: value,
      },
      name,
    );
    setFormData(next);
    scheduleDraftSync({ ...formInput, ...next });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (confirmDisabled) return;

    // Parse numeric fields for safety before submission
    const parsedData = { ...formData };
    if (parsedData.userId) parsedData.userId = Number(parsedData.userId);
    if (parsedData.classId) parsedData.classId = Number(parsedData.classId);
    if (parsedData.courseId) parsedData.courseId = Number(parsedData.courseId);

    onConfirm(isCreateForm ? { ...formInput, ...parsedData } : undefined);
  };

  const renderField = (
    name: string,
    label: string,
    type = "text",
    required = false,
    options?: { value: string; label: string }[],
    readOnly = false,
  ) => {
    const error = validationErrors[name];
    const rawValue = formData[name];
    const fieldValue =
      typeof rawValue === "string" || typeof rawValue === "number"
        ? String(rawValue)
        : "";

    return (
      <div key={name}>
        <FieldLabel label={label} required={required} />
        {type === "textarea" ? (
          <textarea
            name={name}
            value={fieldValue}
            onChange={handleChange}
            className={textareaClass(Boolean(error))}
            rows={2}
          />
        ) : type === "select" && options ? (
          <select
            name={name}
            value={fieldValue}
            onChange={handleChange}
            className={inputClass(Boolean(error))}
          >
            {options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            type={type}
            name={name}
            value={fieldValue}
            onChange={handleChange}
            readOnly={readOnly}
            className={inputClass(Boolean(error))}
          />
        )}
        <FieldError error={error} />
      </div>
    );
  };

  const renderFormContent = () => {
    switch (data.tool_name) {
      case "create_course":
      case "update_course":
        return (
          <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              {renderField("title", "Tên khóa học", "text", true)}
            </div>
            {renderField("courseCode", "Mã khóa học (tự sinh nếu để trống)")}
            {renderField("level", "Cấp độ", "select", false, [
              { value: "", label: "-- Chọn cấp độ --" },
              { value: "1", label: "Cấp độ 1" },
              { value: "2", label: "Cấp độ 2" },
              { value: "3", label: "Cấp độ 3" },
              { value: "4", label: "Cấp độ 4" },
              { value: "5", label: "Cấp độ 5" },
            ])}
            <div className="sm:col-span-2">
              {renderField("description", "Mô tả khóa học", "textarea")}
            </div>
            {data.tool_name === "create_course" && (
              <p className="text-xs leading-5 text-zinc-400 sm:col-span-2">
                Chỉ cần tên khóa học là tạo được. Mã, cấp độ, mô tả có thể để
                trống và cập nhật sau. Ngày bắt đầu/kết thúc thuộc về lớp học.
              </p>
            )}
          </div>
        );
      case "create_class":
        return (
          <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <FieldLabel label="Khóa học" required />
              <select
                name="courseId"
                value={selectedCourseValue}
                onChange={(e) => {
                  const courseId = e.target.value ? Number(e.target.value) : "";
                  const next = patchGeneratedClassCode(
                    formData,
                    { ...formData, courseId },
                    "courseId",
                  );
                  setFormData(next);
                  scheduleDraftSync({ ...formInput, ...next });
                }}
                className={inputClass(Boolean(validationErrors.courseId))}
              >
                <option value="">-- Chọn khóa học --</option>
                {courseOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.courseCode ? `${c.title} (${c.courseCode})` : c.title}
                  </option>
                ))}
              </select>
              <FieldError error={validationErrors.courseId} />
            </div>
            {renderField(
              "classCode",
              "Mã lớp dự kiến",
              "text",
              false,
              undefined,
              true,
            )}
            {renderField("title", "Tên lớp", "text", true)}
            {renderField("classType", "Loại lớp", "select", true, [
              { value: "", label: "-- Chọn loại lớp --" },
              { value: "WEEKLY", label: "Học theo tuần (WEEKLY)" },
              { value: "EXAM_PRACTICE", label: "Luyện đề (EXAM_PRACTICE)" },
            ])}
            {renderField("teacherName", "Giáo viên phụ trách")}
            {renderField("startDate", "Ngày bắt đầu", "date")}
            {renderField("endDate", "Ngày kết thúc", "date")}
            <div className="sm:col-span-2">
              {renderField("description", "Mô tả lớp học", "textarea")}
            </div>
            <p className="text-xs leading-5 text-zinc-400 sm:col-span-2">
              Cần chọn khóa học, tên lớp và loại lớp. Giáo viên, ngày và lịch
              học có thể để trống và cập nhật sau.
            </p>
          </div>
        );
      case "update_class":
        return (
          <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              {renderField("title", "Tên lớp", "text", true)}
            </div>
            {renderField("classCode", "Mã lớp", "text", true)}
            {renderField("classType", "Loại lớp", "select", true, [
              { value: "", label: "-- Chọn loại lớp --" },
              { value: "WEEKLY", label: "Học theo tuần (WEEKLY)" },
              { value: "EXAM_PRACTICE", label: "Luyện đề (EXAM_PRACTICE)" },
            ])}
            {renderField("teacherName", "Giáo viên phụ trách")}
            {renderField("startDate", "Ngày bắt đầu", "date")}
            {renderField("endDate", "Ngày kết thúc", "date")}
            {renderField("status", "Trạng thái", "select", false, [
              { value: "ACTIVE", label: "Đang hoạt động (ACTIVE)" },
              { value: "CLOSED", label: "Đã đóng (CLOSED)" },
            ])}
            <div className="sm:col-span-2">
              {renderField("description", "Mô tả lớp học", "textarea")}
            </div>
          </div>
        );
      case "create_student":
      case "update_student":
        return (
          <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              {renderField("fullName", "Họ và tên", "text", true)}
            </div>
            {renderField("email", "Email", "email")}
            {renderField("phone", "Số điện thoại")}
            {renderField("birthDate", "Ngày sinh", "date")}
            <div className="sm:col-span-2">
              {renderField("address", "Địa chỉ")}
            </div>
          </div>
        );
      case "assign_student_to_class":
        return (
          <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              {isBulkAssign ? (
                <>
                  <FieldLabel
                    label={`Học viên ghi danh (${bulkUserIds.length})`}
                    required
                  />
                  <ul className="divide-y divide-zinc-100 rounded-[10px] border border-zinc-200 bg-white">
                    {bulkUserIds.map((id) => {
                      const info = bulkStudentDirectory.get(id);
                      return (
                        <li
                          key={id}
                          className="flex items-center gap-2 px-3 py-2"
                        >
                          <span className="min-w-0 flex-1 truncate text-[13px] text-zinc-800">
                            {info?.label || `Học viên #${id}`}{" "}
                            <span className="text-zinc-400">
                              (#{id}
                              {info?.email ? ` | ${info.email}` : ""})
                            </span>
                          </span>
                          {bulkUserIds.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeBulkStudent(id)}
                              disabled={confirmDisabled}
                              title="Bỏ học viên này khỏi danh sách"
                              className="shrink-0 rounded p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-red-500 disabled:pointer-events-none disabled:opacity-40"
                            >
                              <X size={14} />
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  <FieldError error={validationErrors.userId} />
                </>
              ) : (
                <>
                  <FieldLabel label="Học viên ghi danh" required />
                  <select
                    name="userId"
                    value={String(formData.userId || "")}
                    onChange={handleChange}
                    className={inputClass(Boolean(validationErrors.userId))}
                  >
                    <option value="">-- Chọn học viên --</option>
                    {students.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.fullName} (#{s.id}) {s.email ? `| ${s.email}` : ""}
                      </option>
                    ))}
                  </select>
                  <FieldError error={validationErrors.userId} />
                </>
              )}
            </div>

            <div className="sm:col-span-2">
              <FieldLabel label="Lớp học" required />
              <select
                name="classId"
                value={String(formData.classId || "")}
                onChange={handleChange}
                className={inputClass(Boolean(validationErrors.classId))}
              >
                <option value="">-- Chọn lớp học --</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title} ({c.classCode}) - Khóa:{" "}
                    {c.courseTitle || `Khóa #${c.courseId}`}
                  </option>
                ))}
              </select>
              <FieldError error={validationErrors.classId} />
            </div>

            {renderField("roleInClass", "Vai trò trong lớp", "select", false, [
              { value: "STUDENT", label: "Học viên (STUDENT)" },
              { value: "TEACHER", label: "Giáo viên (TEACHER)" },
              {
                value: "HOMEROOM_TEACHER",
                label: "Chủ nhiệm (HOMEROOM_TEACHER)",
              },
            ])}

            {renderField("joinedAt", "Ngày vào lớp", "date")}
          </div>
        );
      default:
        return null;
    }
  };

  const renderReadOnlySummary = (input: PreviewInput) => {
    const entries = Object.entries(input).filter(
      ([, value]) => value !== undefined && value !== null && value !== "",
    );
    return (
      <dl className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 bg-zinc-50/60 px-3.5 py-1">
        {entries.map(([key, value]) => (
          <div key={key} className="flex gap-3 py-1.5">
            <dt className="w-28 shrink-0 text-xs leading-5 text-zinc-500">
              {formatFieldLabel(key)}
            </dt>
            <dd className="min-w-0 flex-1 break-words text-[13px] leading-5 text-zinc-800">
              {isRecord(value) || Array.isArray(value)
                ? JSON.stringify(value)
                : formatFieldValue(key, value)}
            </dd>
          </div>
        ))}
      </dl>
    );
  };

  const actionTitle = isDanger
    ? "Xác nhận thao tác quan trọng"
    : ACTION_TITLES[data.tool_name] || "Kiểm tra lại yêu cầu";

  return (
    <div className="w-full overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          {isDanger && (
            <AlertTriangle size={15} className="shrink-0 text-red-500" />
          )}
          <h4 className="truncate text-sm font-semibold text-zinc-900">
            {actionTitle}
          </h4>
          <span className="hidden font-mono text-[10px] text-zinc-300 sm:inline">
            {data.tool_name}
          </span>
        </div>
        <span
          className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${
            isDanger
              ? "border-red-200 bg-red-50 text-red-700"
              : "border-zinc-200 bg-zinc-50 text-zinc-500"
          }`}
        >
          {isDanger ? "Cần duyệt kỹ" : "Bản nháp"}
        </span>
      </div>

      <div className="space-y-3 px-4 py-3.5">
        {data.message && (
          <p className="text-[13px] leading-5 text-zinc-500">{data.message}</p>
        )}

        {relatedCourses.length > 0 && (
          <div className="rounded-xl border border-amber-200/70 bg-amber-50/60 px-3 py-2.5">
            <div className="mb-1 text-[11px] font-medium text-amber-800">
              Khóa học liên quan
            </div>
            <ol className="space-y-1">
              {relatedCourses.map((course, index) => (
                <li
                  key={`${course.id}-${course.courseCode || course.title}`}
                  className="flex flex-wrap items-center gap-x-1.5 text-xs leading-5 text-zinc-700"
                >
                  <span>{index + 1}.</span>
                  <span className="font-medium">{course.title}</span>
                  {course.courseCode && (
                    <span className="font-mono text-[11px] text-zinc-500">
                      {course.courseCode}
                    </span>
                  )}
                  {course.status && (
                    <span className="rounded bg-white px-1 py-0.5 text-[10px] font-medium text-amber-700">
                      {course.status}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </div>
        )}

        {validationErrors._form && (
          <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50/70 px-3 py-2.5">
            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-red-500" />
            <p className="text-xs leading-5 text-red-700">
              {validationErrors._form}
            </p>
          </div>
        )}

        {data.summary && (
          <p className="rounded-xl bg-zinc-50 px-3 py-2 text-xs font-medium leading-5 text-zinc-700">
            {data.summary}
          </p>
        )}

        <form onSubmit={handleSubmit}>
          {isCreateForm ? (
            renderFormContent()
          ) : (
            renderReadOnlySummary(data.display_input || data.input || {})
          )}

          {/* Footer */}
          <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-zinc-100 pt-3">
            <button
              type="button"
              disabled={sending || !canAct}
              onClick={onCancel}
              className="h-9 rounded-[10px] border border-zinc-200 bg-white px-4 text-[13px] font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {data.cancel_label || "Hủy"}
            </button>
            <button
              type="submit"
              disabled={confirmDisabled}
              className={`inline-flex h-9 items-center gap-1.5 rounded-[10px] px-4 text-[13px] font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-50 ${
                isDanger
                  ? "bg-red-600 hover:bg-red-700"
                  : "bg-zinc-900 hover:bg-zinc-700"
              }`}
            >
              {sending && <LoaderCircle size={14} className="animate-spin" />}
              {data.confirm_label || "Xác nhận"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
