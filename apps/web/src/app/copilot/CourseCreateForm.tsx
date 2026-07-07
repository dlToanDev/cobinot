'use client';

import { useState } from 'react';
import { LoaderCircle, BookOpen } from 'lucide-react';

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
  startDate?: string;
  expireDate?: string;
};

type FieldDef = {
  name: keyof CourseInput;
  label: string;
  type: 'text' | 'date' | 'select';
  placeholder?: string;
  required?: boolean;
  fullWidth?: boolean;
  options?: Array<{ value: string; label: string }>;
};

const FIELDS: FieldDef[] = [
  {
    name: 'title',
    label: 'Tên khóa học',
    type: 'text',
    placeholder: 'VD: IELTS 6.5',
    required: true,
    fullWidth: true,
  },
  {
    name: 'courseCode',
    label: 'Mã khóa học',
    type: 'text',
    placeholder: 'Tự sinh nếu để trống',
  },
  {
    name: 'level',
    label: 'Cấp độ',
    type: 'select',
    options: [
      { value: '', label: '-- Chọn cấp độ --' },
      { value: '1', label: 'Cấp độ 1' },
      { value: '2', label: 'Cấp độ 2' },
      { value: '3', label: 'Cấp độ 3' },
      { value: '4', label: 'Cấp độ 4' },
      { value: '5', label: 'Cấp độ 5' },
    ],
  },
  { name: 'startDate', label: 'Ngày bắt đầu', type: 'date' },
  { name: 'expireDate', label: 'Ngày kết thúc', type: 'date' },
  {
    name: 'description',
    label: 'Mô tả',
    type: 'text',
    placeholder: 'Không bắt buộc',
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
    title: data.values?.title ?? '',
    courseCode: data.values?.courseCode ?? '',
    level: data.values?.level ?? '',
    description: data.values?.description ?? '',
    startDate: data.values?.startDate ?? '',
    expireDate: data.values?.expireDate ?? '',
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
    if (values.startDate?.trim()) input.startDate = values.startDate.trim();
    if (values.expireDate?.trim()) input.expireDate = values.expireDate.trim();
    onSubmit(input);
  };

  const fieldClass = (showError: boolean) =>
    `h-10 w-full rounded-xl border bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:bg-slate-100 ${
      showError
        ? 'border-red-300 focus:ring-red-200'
        : 'border-slate-200 focus:ring-blue-200'
    }`;

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-3 rounded-2xl border border-blue-100 bg-blue-50/40 p-4"
    >
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-blue-600">
          <BookOpen size={16} />
        </span>
        <div>
          <div className="text-sm font-semibold text-slate-900">
            {data.title || 'Tạo khóa học mới'}
          </div>
          {data.message && (
            <p className="text-xs text-slate-500">{data.message}</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {FIELDS.map((field) => {
          const showError =
            !!field.required && touched && !values[field.name]?.trim();
          return (
            <label
              key={field.name}
              className={field.fullWidth ? 'sm:col-span-2 block' : 'block'}
            >
              <span className="mb-1 block text-xs font-medium text-slate-600">
                {field.label}
                {field.required && <span className="text-red-500"> *</span>}
              </span>
              {field.type === 'select' ? (
                <select
                  value={values[field.name] ?? ''}
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
                  value={values[field.name] ?? ''}
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
                <span className="mt-1 block text-xs text-red-500">
                  Vui lòng nhập tên khóa học.
                </span>
              )}
            </label>
          );
        })}
      </div>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={disabled}
          className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-5 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {sending ? <LoaderCircle size={16} className="animate-spin" /> : null}
          {data.submit_label || 'Xem trước'}
        </button>
      </div>
    </form>
  );
}
