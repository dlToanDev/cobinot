'use client';

import { useState } from 'react';
import { LoaderCircle, UserRound } from 'lucide-react';

type StudentCreateFormData = {
  title?: string;
  message?: string;
  values?: Record<string, string>;
  submit_label?: string;
};

type StudentInput = {
  fullName: string;
  email?: string;
  phone?: string;
  birthDate?: string;
  address?: string;
};

const FIELDS: Array<{
  name: keyof StudentInput;
  label: string;
  type: 'text' | 'email' | 'tel' | 'date';
  placeholder?: string;
  required?: boolean;
}> = [
  {
    name: 'fullName',
    label: 'Họ và tên',
    type: 'text',
    placeholder: 'VD: Nguyễn Văn A',
    required: true,
  },
  { name: 'email', label: 'Email', type: 'email', placeholder: 'a@example.com' },
  { name: 'phone', label: 'Số điện thoại', type: 'tel', placeholder: '09xxxxxxxx' },
  { name: 'birthDate', label: 'Ngày sinh', type: 'date' },
  {
    name: 'address',
    label: 'Địa chỉ',
    type: 'text',
    placeholder: 'Không bắt buộc',
  },
];

export default function StudentCreateForm({
  data,
  sending,
  canAct,
  onSubmit,
}: {
  data: StudentCreateFormData;
  sending: boolean;
  canAct: boolean;
  onSubmit: (input: StudentInput) => void;
}) {
  const [values, setValues] = useState<StudentInput>({
    fullName: data.values?.fullName ?? '',
    email: data.values?.email ?? '',
    phone: data.values?.phone ?? '',
    birthDate: data.values?.birthDate ?? '',
    address: data.values?.address ?? '',
  });
  const [touched, setTouched] = useState(false);

  const nameMissing = !values.fullName.trim();
  const disabled = sending || !canAct;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (disabled) return;
    if (nameMissing) {
      setTouched(true);
      return;
    }
    // Chỉ gửi field có giá trị; backend sẽ kiểm tra trùng email/SĐT rồi preview.
    const input: StudentInput = { fullName: values.fullName.trim() };
    if (values.email?.trim()) input.email = values.email.trim();
    if (values.phone?.trim()) input.phone = values.phone.trim();
    if (values.birthDate?.trim()) input.birthDate = values.birthDate.trim();
    if (values.address?.trim()) input.address = values.address.trim();
    onSubmit(input);
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-3 rounded-2xl border border-blue-100 bg-blue-50/40 p-4"
    >
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-blue-600">
          <UserRound size={16} />
        </span>
        <div>
          <div className="text-sm font-semibold text-slate-900">
            {data.title || 'Tạo học viên mới'}
          </div>
          {data.message && (
            <p className="text-xs text-slate-500">{data.message}</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {FIELDS.map((field) => {
          const showError =
            field.required && touched && !values[field.name]?.trim();
          return (
            <label
              key={field.name}
              className={
                field.name === 'address' ? 'sm:col-span-2 block' : 'block'
              }
            >
              <span className="mb-1 block text-xs font-medium text-slate-600">
                {field.label}
                {field.required && <span className="text-red-500"> *</span>}
              </span>
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
                className={`h-10 w-full rounded-xl border bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:bg-slate-100 ${
                  showError
                    ? 'border-red-300 focus:ring-red-200'
                    : 'border-slate-200 focus:ring-blue-200'
                }`}
              />
              {showError && (
                <span className="mt-1 block text-xs text-red-500">
                  Vui lòng nhập họ tên học viên.
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
          {sending ? (
            <LoaderCircle size={16} className="animate-spin" />
          ) : null}
          {data.submit_label || 'Xem trước'}
        </button>
      </div>
    </form>
  );
}
