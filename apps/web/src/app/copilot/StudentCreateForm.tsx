"use client";

import { useState } from "react";
import { LoaderCircle } from "lucide-react";

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
  type: "text" | "email" | "tel" | "date";
  placeholder?: string;
  required?: boolean;
  fullWidth?: boolean;
}> = [
  {
    name: "fullName",
    label: "Họ và tên",
    type: "text",
    placeholder: "VD: Nguyễn Văn A",
    required: true,
    fullWidth: true,
  },
  { name: "email", label: "Email", type: "email", placeholder: "a@example.com" },
  {
    name: "phone",
    label: "Số điện thoại",
    type: "tel",
    placeholder: "09xxxxxxxx",
  },
  { name: "birthDate", label: "Ngày sinh", type: "date" },
  {
    name: "address",
    label: "Địa chỉ",
    type: "text",
    placeholder: "Không bắt buộc",
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
    fullName: data.values?.fullName ?? "",
    email: data.values?.email ?? "",
    phone: data.values?.phone ?? "",
    birthDate: data.values?.birthDate ?? "",
    address: data.values?.address ?? "",
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
      className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm"
    >
      <div className="border-b border-zinc-100 px-4 py-3">
        <div className="text-sm font-semibold text-zinc-900">
          {data.title || "Tạo học viên mới"}
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
            field.required && touched && !values[field.name]?.trim();
          return (
            <label
              key={field.name}
              className={field.fullWidth ? "block sm:col-span-2" : "block"}
            >
              <span className="mb-1 block text-[11px] font-medium leading-4 text-zinc-500">
                {field.label}
                {field.required && <span className="ml-0.5 text-red-500">*</span>}
              </span>
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
                className={`h-9 w-full rounded-[10px] border bg-white px-3 text-[13px] text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:ring-2 disabled:cursor-not-allowed disabled:bg-zinc-50 ${
                  showError
                    ? "border-red-300 focus:border-red-400 focus:ring-red-100"
                    : "border-zinc-200 focus:border-zinc-400 focus:ring-zinc-100"
                }`}
              />
              {showError && (
                <span className="mt-1 block text-[11px] leading-4 text-red-600">
                  Vui lòng nhập họ tên học viên.
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
