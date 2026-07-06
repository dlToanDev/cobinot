import React, { useState, useEffect } from "react";
import { apiClient } from "@/lib/api-client";
import {
  generateClassCode,
  normalizeGeneratedCode,
} from "@hxstu/shared";
import {
  UserRound,
  Mail,
  Phone,
  BookOpen,
  GraduationCap,
  Hash,
  Calendar,
  ShieldCheck,
  Award,
  MapPin,
  Sparkles,
  Plus,
  AlertTriangle,
  UserPlus,
  Edit3,
  Check,
  X,
  Layers,
} from "lucide-react";

const FIELD_LABELS: Record<string, string> = {
  id: "ID",
  tenantId: "Tenant",
  fullName: "Họ và tên",
  name: "Tên",
  title: "Tên khóa học / lớp học",
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
  teacherName: "Giáo viên phụ trách",
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

const formatFieldLabel = (key: string) => {
  const normKey = key.replace(/_/g, "");
  for (const [k, label] of Object.entries(FIELD_LABELS)) {
    if (k.toLowerCase() === normKey.toLowerCase() || k.toLowerCase() === key.toLowerCase()) {
      return label;
    }
  }
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/_/g, " ")
    .replace(/^./, (letter) => letter.toUpperCase());
};

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

const ACTION_THEMES: Record<string, { label: string; icon: React.ReactNode; color: string; accent: string }> = {
  create_course: {
    label: "Tạo khóa học mới",
    icon: <BookOpen size={16} />,
    color: "from-indigo-500 to-purple-500",
    accent: "bg-indigo-50 text-indigo-700 border-indigo-150",
  },
  update_course: {
    label: "Cập nhật khóa học",
    icon: <Edit3 size={16} />,
    color: "from-indigo-500 to-purple-500",
    accent: "bg-indigo-50 text-indigo-700 border-indigo-150",
  },
  create_class: {
    label: "Tạo lớp học mới",
    icon: <GraduationCap size={16} />,
    color: "from-emerald-500 to-teal-500",
    accent: "bg-emerald-50 text-emerald-700 border-emerald-150",
  },
  update_class: {
    label: "Cập nhật lớp học",
    icon: <Edit3 size={16} />,
    color: "from-emerald-500 to-teal-500",
    accent: "bg-emerald-50 text-emerald-700 border-emerald-150",
  },
  create_student: {
    label: "Thêm học viên mới",
    icon: <UserPlus size={16} />,
    color: "from-blue-500 to-cyan-500",
    accent: "bg-blue-50 text-blue-700 border-blue-150",
  },
  update_student: {
    label: "Cập nhật học viên",
    icon: <Edit3 size={16} />,
    color: "from-blue-500 to-cyan-500",
    accent: "bg-blue-50 text-blue-700 border-blue-150",
  },
  assign_student_to_class: {
    label: "Thêm học viên vào lớp",
    icon: <Plus size={16} />,
    color: "from-violet-500 to-fuchsia-500",
    accent: "bg-violet-50 text-violet-700 border-violet-150",
  },
};

type EditablePreviewCardProps = {
  data: PreviewCardData;
  onConfirm: (overrideInput?: PreviewInput) => void;
  onCancel: () => void;
  sending: boolean;
  canAct: boolean;
};

type PreviewInput = Record<string, unknown>;

type PreviewPendingAction = {
  input?: PreviewInput;
  display_input?: PreviewInput;
  validation_errors?: Record<string, string>;
  tool_name?: string;
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

type RelatedCoursePreviewItem = {
  id: number | string;
  title: string;
  courseCode?: string | null;
  status?: string | null;
  level?: string | null;
};

const CLASS_TYPE_LABELS: Record<string, string> = {
  WEEKLY: "Lớp học theo tuần",
  PRACTICE: "Lớp luyện đề",
};

const isGeneratedClassCodeWithType = (value: string) =>
  /(?:^|_)(?:WEEKLY|PRACTICE)(?:_|$)/.test(normalizeGeneratedCode(value));

const replaceClassTypeInCode = (value: string, nextType: string) => {
  const normalizedCode = normalizeGeneratedCode(value);
  const normalizedType = normalizeGeneratedCode(nextType);
  if (!normalizedCode || !["WEEKLY", "PRACTICE"].includes(normalizedType)) {
    return normalizedCode;
  }

  return normalizedCode.replace(
    /(^|_)(WEEKLY|PRACTICE)(?=_|$)/,
    `$1${normalizedType}`,
  );
};

export default function EditablePreviewCard({
  data,
  onConfirm,
  onCancel,
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
  const missingFields: string[] = Array.isArray(data.missingFields)
    ? data.missingFields
    : [];
  
  const formInput = pendingAction.input || data.input || {};
  const relatedCourses = Array.isArray(data.related_courses)
    ? data.related_courses
    : [];

  const [formData, setFormData] = useState<PreviewInput>(formInput);
  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [classes, setClasses] = useState<any[]>([]);
  const [students, setStudents] = useState<any[]>([]);

  const selectedCourseId = Number(formData.courseId || 0);
  const selectedCourseLabel =
    String(
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
    selectedCourseId > 0 && !courses.some((course) => Number(course.id) === selectedCourseId)
      ? [
          {
            id: selectedCourseId,
            title: selectedCourseLabel || `Khóa #${selectedCourseId}`,
            courseCode: "",
          },
          ...courses,
        ]
      : courses;

  const isCourseMissing =
    missingFields.includes("courseId") && !Number(formData.courseId || 0);
  const confirmDisabled = sending || !canAct || isCourseMissing;

  useEffect(() => {
    if (["create_class", "update_class", "assign_student_to_class"].includes(data.tool_name)) {
      apiClient.get("/courses").then((res) => {
        const courseList = Array.isArray(res.data) ? (res.data as CourseOption[]) : [];
        setCourses(courseList);

        // Load all classes for these courses
        Promise.all(
          courseList.map((course) =>
            apiClient.get(`/courses/${course.id}/classes`)
              .then((r) =>
                Array.isArray(r.data)
                  ? r.data.map((cls: any) => ({
                      ...cls,
                      courseId: course.id,
                      courseTitle: course.title,
                    }))
                  : []
              )
              .catch(() => [])
          )
        ).then((results) => {
          setClasses(results.flat());
        });
      }).catch(() => {});
    }

    if (data.tool_name === "assign_student_to_class") {
      apiClient.get("/students").then((res) => {
        setStudents(Array.isArray(res.data) ? res.data : []);
      }).catch(() => {});
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

    return generateClassCode({
      courseCode,
      courseTitle,
      classTitle: String(input.title || ""),
      classType: String(input.type || input.classType || ""),
      includeClassType: Boolean(input.type || input.classType),
    });
  };

  const patchGeneratedClassCode = (
    prev: PreviewInput,
    next: PreviewInput,
    changedName: string,
  ) => {
    if (data.tool_name !== "create_class" && data.tool_name !== "update_class") return next;

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
        classType: CLASS_TYPE_LABELS[nextType] || nextType,
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
    setFormData((prev) => {
      const next = {
        ...prev,
        [name]: value,
      };
      return patchGeneratedClassCode(prev, next, name);
    });
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
  ) => {
    const error = validationErrors[name];
    const rawValue = formData[name];
    const fieldValue =
      typeof rawValue === "string" || typeof rawValue === "number"
        ? String(rawValue)
        : "";
    
    const icon = getFieldIcon(name);

    const inputClassName = `w-full ${
      icon ? "pl-9" : "px-3.5"
    } pr-3.5 py-2.5 bg-slate-50 border rounded-xl text-slate-800 text-xs focus:outline-none transition-all duration-200 focus:bg-white focus:ring-2 ${
      error
        ? "border-red-300 focus:border-red-500 focus:ring-red-100"
        : "border-slate-200 focus:border-indigo-500 focus:ring-indigo-100 shadow-2xs"
    }`;

    return (
      <div className="mb-1" key={name}>
        <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 px-1">
          {label} {required && <span className="text-red-500 font-bold">*</span>}
        </label>
        <div className="relative">
          {type === "textarea" ? (
            <textarea
              name={name}
              value={fieldValue}
              onChange={handleChange}
              className={`${inputClassName} py-2.5 resize-none`}
              rows={2}
            />
          ) : type === "select" && options ? (
            <select
              name={name}
              value={fieldValue}
              onChange={handleChange}
              className={inputClassName}
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
              className={inputClassName}
            />
          )}
          {icon && (
            <div className={`absolute left-3 text-slate-400 ${type === "textarea" ? "top-3" : "top-1/2 -translate-y-1/2"}`}>
              {icon}
            </div>
          )}
        </div>
        {error && <p className="mt-1 text-[11px] font-semibold text-red-600 px-1">{error}</p>}
      </div>
    );
  };

  const renderFormContent = () => {
    switch (data.tool_name) {
      case "create_course":
      case "update_course":
        return (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
            <div className="sm:col-span-2">
              {renderField("title", "Tên khóa học", "text", true)}
            </div>
            {renderField("courseCode", "Mã khóa học", "text", true)}
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
          </div>
        );
      case "create_class":
        return (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
            <div className="sm:col-span-2">
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 px-1">
                Khóa học <span className="text-red-500 font-bold">*</span>
              </label>
              <div className="relative">
                <select
                  name="courseId"
                  value={selectedCourseValue}
                  onChange={(e) =>
                    setFormData((prev) =>
                      patchGeneratedClassCode(
                        prev,
                        { ...prev, courseId: Number(e.target.value) },
                        "courseId",
                      ),
                    )
                  }
                  className={`w-full pl-9 pr-3.5 py-2.5 bg-slate-50 border rounded-xl text-slate-800 text-xs focus:outline-none transition-all duration-200 focus:bg-white focus:ring-2 ${
                    validationErrors.courseId
                      ? "border-red-300 focus:border-red-500 focus:ring-red-100"
                      : "border-slate-200 focus:border-indigo-500 focus:ring-indigo-100 shadow-2xs"
                  }`}
                >
                  <option value="">-- Chọn khóa học --</option>
                  {courseOptions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.courseCode ? `${c.title} (${c.courseCode})` : c.title}
                    </option>
                  ))}
                </select>
                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                  <BookOpen size={14} className="text-purple-500" />
                </div>
              </div>
              {validationErrors.courseId && (
                <p className="mt-1 text-[11px] font-semibold text-red-600 px-1">
                  {validationErrors.courseId}
                </p>
              )}
            </div>
            {renderField("classCode", "Mã lớp", "text", true)}
            {renderField("title", "Tên lớp", "text", true)}
            {renderField("type", "Loại lớp", "select", true, [
              { value: "", label: "-- Chọn loại lớp --" },
              { value: "WEEKLY", label: "Học theo tuần (WEEKLY)" },
              { value: "PRACTICE", label: "Luyện đề (PRACTICE)" },
            ])}
            {renderField("teacherName", "Giáo viên phụ trách", "text")}
            {renderField("startDate", "Ngày bắt đầu", "date")}
            {renderField("endDate", "Ngày kết thúc", "date")}
            <div className="sm:col-span-2">
              {renderField("description", "Mô tả lớp học", "textarea")}
            </div>
          </div>
        );
      case "update_class":
        return (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
            <div className="sm:col-span-2">
              {renderField("title", "Tên lớp", "text", true)}
            </div>
            {renderField("classCode", "Mã lớp", "text", true)}
            {renderField("classType", "Loại lớp", "select", true, [
              { value: "", label: "-- Chọn loại lớp --" },
              { value: "WEEKLY", label: "Học theo tuần (WEEKLY)" },
              { value: "PRACTICE", label: "Luyện đề (PRACTICE)" },
            ])}
            {renderField("teacherName", "Giáo viên phụ trách", "text")}
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
            <div className="sm:col-span-2">
              {renderField("fullName", "Họ và tên", "text", true)}
            </div>
            {renderField("email", "Email", "email")}
            {renderField("phone", "Số điện thoại", "text")}
            {renderField("birthDate", "Ngày sinh", "date")}
            <div className="sm:col-span-2">
              {renderField("address", "Địa chỉ", "text")}
            </div>
          </div>
        );
      case "assign_student_to_class":
        return (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
            <div className="sm:col-span-2">
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 px-1">
                Học viên ghi danh <span className="text-red-500 font-bold">*</span>
              </label>
              <div className="relative">
                <select
                  name="userId"
                  value={String(formData.userId || "")}
                  onChange={handleChange}
                  className={`w-full pl-9 pr-3.5 py-2.5 bg-slate-50 border rounded-xl text-slate-800 text-xs focus:outline-none transition-all duration-200 focus:bg-white focus:ring-2 ${
                    validationErrors.userId
                      ? "border-red-300 focus:border-red-500 focus:ring-red-100"
                      : "border-slate-200 focus:border-indigo-500 focus:ring-indigo-100 shadow-2xs"
                  }`}
                >
                  <option value="">-- Chọn học viên --</option>
                  {students.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.fullName} (#{s.id}) {s.email ? `| ${s.email}` : ""}
                    </option>
                  ))}
                </select>
                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                  <UserRound size={14} className="text-indigo-500" />
                </div>
              </div>
              {validationErrors.userId && (
                <p className="mt-1 text-[11px] font-semibold text-red-600 px-1">
                  {validationErrors.userId}
                </p>
              )}
            </div>

            <div className="sm:col-span-2">
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 px-1">
                Lớp học <span className="text-red-500 font-bold">*</span>
              </label>
              <div className="relative">
                <select
                  name="classId"
                  value={String(formData.classId || "")}
                  onChange={handleChange}
                  className={`w-full pl-9 pr-3.5 py-2.5 bg-slate-50 border rounded-xl text-slate-800 text-xs focus:outline-none transition-all duration-200 focus:bg-white focus:ring-2 ${
                    validationErrors.classId
                      ? "border-red-300 focus:border-red-500 focus:ring-red-100"
                      : "border-slate-200 focus:border-indigo-500 focus:ring-indigo-100 shadow-2xs"
                  }`}
                >
                  <option value="">-- Chọn lớp học --</option>
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title} ({c.classCode}) - Khóa: {c.courseTitle || `Khóa #${c.courseId}`}
                    </option>
                  ))}
                </select>
                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                  <GraduationCap size={14} className="text-emerald-500" />
                </div>
              </div>
              {validationErrors.classId && (
                <p className="mt-1 text-[11px] font-semibold text-red-600 px-1">
                  {validationErrors.classId}
                </p>
              )}
            </div>

            {renderField("roleInClass", "Vai trò trong lớp", "select", false, [
              { value: "STUDENT", label: "Học viên (STUDENT)" },
              { value: "TEACHER", label: "Giáo viên (TEACHER)" },
              { value: "HOMEROOM_TEACHER", label: "Chủ nhiệm (HOMEROOM_TEACHER)" },
            ])}

            {renderField("joinedAt", "Ngày vào lớp", "date")}
          </div>
        );
      default:
        return null;
    }
  };

  const formatFieldValue = (key: string, value: unknown): string => {
    if (value === null || value === undefined || value === "") return "Chưa có";
    if (typeof value === "boolean") return value ? "Có" : "Không";
    if (typeof value === "string" || typeof value === "number") {
      const lowerKey = key.toLowerCase();
      if (lowerKey.includes("role")) {
        const valStr = String(value).toUpperCase();
        if (valStr === "STUDENT") return "Học viên";
        if (valStr === "TEACHER") return "Giáo viên";
        if (valStr === "HOMEROOM_TEACHER") return "Chủ nhiệm";
      }
      return String(value);
    }
    return JSON.stringify(value);
  };

  const renderActionInputSummary = (input: PreviewInput) => {
    const entries = Object.entries(input).filter(
      ([, value]) => value !== undefined && value !== null && value !== "",
    );
    return (
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {entries.map(([key, value]) => (
          <div
            key={key}
            className="flex items-start gap-2.5 rounded-xl border border-slate-100 bg-white p-3 shadow-xs transition-all duration-200 hover:border-slate-300"
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
  };

  const theme = ACTION_THEMES[data.tool_name] || {
    label: "Kiểm tra lại yêu cầu",
    icon: <Sparkles size={16} />,
    color: "from-slate-600 to-slate-800",
    accent: "bg-slate-50 text-slate-700 border-slate-150",
  };

  return (
    <div className="w-full overflow-hidden rounded-2xl border border-slate-250/80 bg-white shadow-lg transition-all duration-300 hover:shadow-xl">
      {/* Dynamic Colored Top Line */}
      <div className={`h-[4px] w-full bg-gradient-to-r ${isDanger ? "from-red-500 to-orange-500" : theme.color}`} />
      
      {/* Header section */}
      <div className="border-b border-slate-100 bg-gradient-to-b from-slate-50/50 to-white px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${isDanger ? "from-red-500 to-orange-600 text-white shadow-sm shadow-red-200" : `${theme.color} text-white shadow-sm shadow-indigo-100`}`}>
              {isDanger ? <AlertTriangle size={15} /> : theme.icon}
            </div>
            <div>
              <h4 className="text-sm font-extrabold text-slate-900 tracking-tight">
                {isDanger ? "Xác nhận thao tác quan trọng" : theme.label}
              </h4>
              <span className="text-[9px] font-mono text-slate-400 uppercase tracking-wider">
                {data.tool_name}
              </span>
            </div>
          </div>
          <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${isDanger ? "bg-red-50 border-red-200 text-red-700" : theme.accent}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${isDanger ? "bg-red-650" : "bg-indigo-650"}`} />
            {isDanger ? "Yêu cầu duyệt kỹ" : "Bản nháp đang sửa"}
          </span>
        </div>
        <p className="mt-2.5 text-xs text-slate-650 leading-relaxed font-medium">
          {data.message}
        </p>
      </div>

      {relatedCourses.length > 0 && (
        <div className="mx-5 mt-4 rounded-xl border border-amber-200 bg-amber-50/70 p-3 shadow-xs">
          <div className="text-[10px] font-bold uppercase tracking-wider text-amber-800 mb-1 flex items-center gap-1.5">
            <AlertTriangle size={12} /> Khóa học liên quan
          </div>
          <ol className="space-y-1.5">
            {relatedCourses.map((course, index) => (
              <li
                key={`${course.id}-${course.courseCode || course.title}`}
                className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-amber-950"
              >
                <span className="font-semibold">{index + 1}.</span>
                <span className="font-semibold">{course.title}</span>
                {course.courseCode && (
                  <span className="text-amber-800">mã {course.courseCode}</span>
                )}
                {course.status && (
                  <span className="rounded-full bg-white/80 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
                    {course.status}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}

      {validationErrors._form && (
        <div className="mx-5 mt-4 rounded-xl border border-red-200 bg-red-50/80 px-4 py-3 text-xs font-semibold text-red-700 flex items-start gap-2.5">
          <AlertTriangle size={15} className="shrink-0 text-red-600 mt-0.5" />
          <div>
            <div className="font-extrabold uppercase tracking-wider text-[10px] text-red-800">Lỗi biểu mẫu</div>
            <div className="mt-0.5">{validationErrors._form}</div>
          </div>
        </div>
      )}
      
      {/* Form or Info body */}
      <form onSubmit={handleSubmit}>
        <div className="bg-slate-50/30 p-5 border-b border-slate-100">
          {data.summary && (
            <div className="text-xs font-bold text-slate-800 mb-3 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">
              {data.summary}
            </div>
          )}
          
          {isCreateForm ? (
            <div className="bg-white p-4 rounded-2xl border border-slate-150 shadow-2xs">
              {renderFormContent()}
            </div>
          ) : (
            <div className="mt-1">
              {renderActionInputSummary(data.display_input || data.input || {})}
            </div>
          )}
        </div>

        {/* Footer controls */}
        <div className="flex flex-wrap justify-end gap-2.5 bg-slate-50/50 px-5 py-3.5">
          <button
            type="button"
            disabled={sending || !canAct}
            onClick={onCancel}
            className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 cursor-pointer shadow-3xs"
          >
            <X size={13} />
            {data.cancel_label || "Hủy bỏ"}
          </button>
          <button
            type="submit"
            disabled={confirmDisabled}
            className={`flex items-center gap-1.5 rounded-xl px-4.5 py-2.5 text-xs font-bold text-white transition disabled:opacity-50 shadow-sm cursor-pointer ${
              isDanger
                ? "bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-700 hover:to-orange-700"
                : "bg-slate-950 hover:bg-slate-850 hover:shadow"
            }`}
          >
            <Check size={13} />
            {data.confirm_label || "Xác nhận"}
          </button>
        </div>
      </form>
    </div>
  );
}
