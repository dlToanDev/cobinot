"use client";

import { useState } from "react";
import { LoaderCircle } from "lucide-react";

type CourseCreateFormData = {
  title?: string;
  message?: string;
  values?: Record<string, string>;
  submit_label?: string;
};

type CourseInput = {
  title: string;
  courseCode?: string;
  level?: string;
  description?: string;
};

type FieldDef = {
  name: keyof CourseInput;
  label: string;
  type: "text" | "date" | "select";
  placeholder?: string;
  required?: boolean;
  fullWidth?: boolean;
  options?: Array<{ value: string; label: string }>;
};

const FIELDS: FieldDef[] = [
  {
    name: "title",
    label: "Tên khóa học",
    type: "text",
    placeholder: "VD: IELTS 6.5",
    required: true,
    fullWidth: true,
  },
  {
    name: "courseCode",
    label: "Mã khóa học",
    type: "text",
    placeholder: "Tự sinh nếu để trống",
  },
  {
    name: "level",
    label: "Cấp độ",
    type: "select",
    options: [
      { value: "", label: "-- Chọn cấp độ --" },
      { value: "1", label: "Cấp độ 1" },
      { value: "2", label: "Cấp độ 2" },
      { value: "3", label: "Cấp độ 3" },
      { value: "4", label: "Cấp độ 4" },
      { value: "5", label: "Cấp độ 5" },
    ],
  },
  // Khóa học không có ngày bắt đầu/kết thúc — ngày chỉ thuộc lớp học.
  {
    name: "description",
    label: "Mô tả",
    type: "text",
    placeholder: "Không bắt buộc",
    fullWidth: true,
  },
];

export default function CourseCreateForm({
  data,
  sending,
  canAct,
  onSubmit,
}: {
  data: CourseCreateFormData;
  sending: boolean;
  canAct: boolean;
  onSubmit: (input: CourseInput) => void;
}) {
  const [values, setValues] = useState<CourseInput>({
    title: data.values?.title ?? "",
    courseCode: data.values?.courseCode ?? "",
    level: data.values?.level ?? "",
    description: data.values?.description ?? "",
  });
  const [touched, setTouched] = useState(false);

  const titleMissing = !values.title.trim();
  const disabled = sending || !canAct;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (disabled) return;
    if (titleMissing) {
      setTouched(true);
      return;
    }
    // Chỉ gửi field có giá trị; backend/preview sẽ tự sinh mã, cho cập nhật sau.
    const input: CourseInput = { title: values.title.trim() };
    if (values.courseCode?.trim()) input.courseCode = values.courseCode.trim();
    if (values.level?.trim()) input.level = values.level.trim();
    if (values.description?.trim())
      input.description = values.description.trim();
    onSubmit(input);
  };

  const fieldClass = (showError: boolean) =>
    `h-9 w-full rounded-[10px] border bg-white px-3 text-[13px] text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:ring-2 disabled:cursor-not-allowed disabled:bg-zinc-50 ${
      showError
        ? "border-red-300 focus:border-red-400 focus:ring-red-100"
        : "border-zinc-200 focus:border-zinc-400 focus:ring-zinc-100"
    }`;

  return (
    <form
      onSubmit={handleSubmit}
      className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm"
    >
      <div className="border-b border-zinc-100 px-4 py-3">
        <div className="text-sm font-semibold text-zinc-900">
          {data.title || "Tạo khóa học mới"}
        </div>
        {data.message && (
          <p className="mt-0.5 text-[13px] leading-5 text-zinc-500">
            {data.message}
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-x-4 gap-y-3 px-4 py-3.5 sm:grid-cols-2">
        {FIELDS.map((field) => {
          const showError =
            !!field.required && touched && !values[field.name]?.trim();
          return (
            <label
              key={field.name}
              className={field.fullWidth ? "block sm:col-span-2" : "block"}
            >
              <span className="mb-1 block text-[11px] font-medium leading-4 text-zinc-500">
                {field.label}
                {field.required && <span className="ml-0.5 text-red-500">*</span>}
              </span>
              {field.type === "select" ? (
                <select
                  value={values[field.name] ?? ""}
                  disabled={disabled}
                  onChange={(e) =>
                    setValues((current) => ({
                      ...current,
                      [field.name]: e.target.value,
                    }))
                  }
                  className={fieldClass(showError)}
                >
                  {field.options?.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type={field.type}
                  value={values[field.name] ?? ""}
                  placeholder={field.placeholder}
                  disabled={disabled}
                  onChange={(e) =>
                    setValues((current) => ({
                      ...current,
                      [field.name]: e.target.value,
                    }))
                  }
                  className={fieldClass(showError)}
                />
              )}
              {showError && (
                <span className="mt-1 block text-[11px] leading-4 text-red-600">
                  Vui lòng nhập tên khóa học.
                </span>
              )}
            </label>
          );
        })}
      </div>

      <div className="flex justify-end border-t border-zinc-100 px-4 py-3">
        <button
          type="submit"
          disabled={disabled}
          className="inline-flex h-9 items-center gap-1.5 rounded-[10px] bg-zinc-900 px-4 text-[13px] font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {sending && <LoaderCircle size={14} className="animate-spin" />}
          {data.submit_label || "Xem trước"}
        </button>
      </div>
    </form>
  );
}
