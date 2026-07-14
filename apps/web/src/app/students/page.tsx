"use client";

import React, { useCallback, useEffect, useState } from "react";
import { apiClient } from "@/lib/api-client";
import Navbar from "../../components/Navbar";
import { 
  Search, 
  Plus, 
  Trash2, 
  Edit2, 
  Users, 
  GraduationCap, 
  MoreVertical, 
  UserCheck, 
  X, 
  FolderOpen,
  ChevronDown,
  UserX,
  Calendar,
  MapPin,
  Phone
} from "lucide-react";

export default function StudentsPage() {
  const [students, setStudents] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [openDropdownId, setOpenDropdownId] = useState<number | null>(null);

  // Modals & Forms State
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState<any>(null);
  const [showCourses, setShowCourses] = useState<any>(null);
  const [studentCourses, setStudentCourses] = useState<any[]>([]);
  const [coursesLoading, setCoursesLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form Fields
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [birthDate, setBirthDate] = useState("");

  const fetchStudents = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await apiClient.get("/students", {
        params: {
          keyword: search || undefined,
          status: statusFilter || undefined,
        },
      });
      setStudents(res.data);
      setSelectedIds((current) =>
        current.filter((id) =>
          res.data.some((student: any) => student.id === id),
        ),
      );
    } catch (err: any) {
      setError(
        err.response?.data?.message || "Không thể tải danh sách học viên",
      );
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter]);

  useEffect(() => {
    fetchStudents();
  }, [fetchStudents]);

  const selectedCount = selectedIds.length;
  const allVisibleSelected =
    students.length > 0 &&
    students.every((student) => selectedIds.includes(student.id));

  const formatTitleCase = (str: string) => {
    if (!str) return "";
    return str
      .trim()
      .toLocaleLowerCase("vi-VN")
      .split(/\s+/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (phone && !/^[0-9]{10}$/.test(phone)) {
      setError("Số điện thoại phải có đúng 10 chữ số");
      return;
    }

    setSaving(true);
    try {
      await apiClient.post("/students", {
        fullName: formatTitleCase(fullName),
        email: email || undefined,
        phone: phone || undefined,
        address: address ? formatTitleCase(address) : undefined,
        birthDate: birthDate || undefined,
      });
      setShowCreate(false);
      setFullName("");
      setEmail("");
      setPhone("");
      setAddress("");
      setBirthDate("");
      fetchStudents();
    } catch (err: any) {
      const msg = err.response?.data?.message || "Lỗi thêm mới học viên";
      setError(Array.isArray(msg) ? msg[0] : msg);
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (phone && !/^[0-9]{10}$/.test(phone)) {
      setError("Số điện thoại phải có đúng 10 chữ số");
      return;
    }

    setSaving(true);
    try {
      // Gửi null khi user xóa rỗng để backend clear field (undefined = giữ nguyên).
      await apiClient.patch(`/students/${showEdit.id}`, {
        fullName: formatTitleCase(fullName),
        email: email || null,
        phone: phone || null,
        address: address ? formatTitleCase(address) : null,
        birthDate: birthDate === "" ? null : birthDate,
      });
      setShowEdit(null);
      setFullName("");
      setEmail("");
      setPhone("");
      setAddress("");
      setBirthDate("");
      fetchStudents();
    } catch (err: any) {
      const msg = err.response?.data?.message || "Lỗi cập nhật học viên";
      setError(Array.isArray(msg) ? msg[0] : msg);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = async (student: any) => {
    const newStatus = student.status === "ACTIVE" ? "LOCKED" : "ACTIVE";
    try {
      await apiClient.patch(`/students/${student.id}/status`, {
        status: newStatus,
      });
      fetchStudents();
    } catch (err: any) {
      alert(err.response?.data?.message || "Không thể đổi trạng thái");
    }
  };

  const handleDelete = async (id: number) => {
    if (
      !window.confirm(
        "Bạn có chắc chắn muốn xóa học viên này? Hành động này sẽ xóa vĩnh viễn học viên và tất cả các thông tin lớp học liên quan.",
      )
    ) {
      return;
    }
    setError("");
    try {
      await apiClient.delete(`/students/${id}`);
      setSelectedIds((current) =>
        current.filter((selectedId) => selectedId !== id),
      );
      fetchStudents();
    } catch (err: any) {
      alert(err.response?.data?.message || "Không thể xóa học viên");
    }
  };

  const toggleStudentSelection = (id: number) => {
    setSelectedIds((current) =>
      current.includes(id)
        ? current.filter((selectedId) => selectedId !== id)
        : [...current, id],
    );
  };

  const toggleAllVisibleStudents = () => {
    if (allVisibleSelected) {
      setSelectedIds([]);
      return;
    }

    setSelectedIds(students.map((student) => student.id));
  };

  const handleBulkDelete = async () => {
    if (selectedCount === 0) return;

    if (
      !window.confirm(
        `Bạn có chắc chắn muốn xóa ${selectedCount} học viên đã chọn? Hành động này sẽ xóa vĩnh viễn học viên và các thông tin lớp học liên quan.`,
      )
    ) {
      return;
    }

    setError("");
    try {
      const res = await apiClient.delete("/students/bulk", {
        data: { ids: selectedIds },
      });
      setSelectedIds([]);
      await fetchStudents();
      alert(`Đã xóa ${res.data?.deletedCount || 0} học viên.`);
    } catch (err: any) {
      alert(
        err.response?.data?.message || "Không thể xóa các học viên đã chọn",
      );
    }
  };

  const handleDeleteAll = async () => {
    const confirmation = window.prompt(
      "Thao tác này sẽ xóa vĩnh viễn toàn bộ học viên trong hệ thống và các thông tin lớp học liên quan. Nhập XOA TAT CA để xác nhận.",
    );

    if (confirmation !== "XOA TAT CA") return;

    setError("");
    try {
      const res = await apiClient.delete("/students/bulk", {
        data: { all: true },
      });
      setSelectedIds([]);
      await fetchStudents();
      alert(`Đã xóa ${res.data?.deletedCount || 0} học viên.`);
    } catch (err: any) {
      alert(err.response?.data?.message || "Không thể xóa toàn bộ học viên");
    }
  };

  const handleViewCourses = async (student: any) => {
    setShowCourses(student);
    setCoursesLoading(true);
    try {
      const res = await apiClient.get(`/students/${student.id}/courses`);
      setStudentCourses(res.data);
    } catch (err: any) {
      alert(err.response?.data?.message || "Không thể tải danh sách khóa học");
    } finally {
      setCoursesLoading(false);
    }
  };

  const handleRemoveCourse = async (studentId: number, courseId: number) => {
    if (
      !window.confirm("Bạn có chắc chắn muốn xóa học viên này khỏi khóa học?")
    ) {
      return;
    }
    try {
      await apiClient.delete(`/students/${studentId}/courses/${courseId}`);
      // Refresh the list in modal
      const res = await apiClient.get(`/students/${studentId}/courses`);
      setStudentCourses(res.data);
    } catch (err: any) {
      alert(
        err.response?.data?.message || "Không thể xóa học viên khỏi khóa học",
      );
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return "";
    return date.toLocaleDateString("vi-VN");
  };

  const calculateAge = (dateStr: string | null) => {
    if (!dateStr) return "";
    const birth = new Date(dateStr);
    if (isNaN(birth.getTime())) return "";
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) {
      age--;
    }
    return String(age);
  };

  return (
    <div className="bg-slate-50 min-h-screen text-slate-800 font-sans flex flex-col">
      <Navbar />

      <div className="p-8 max-w-6xl w-full mx-auto flex-1">
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-200 pb-6 mb-8">
          <div>
            <h1 className="text-3xl font-extrabold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
              Quản Lý Học Viên
            </h1>
            <p className="text-slate-500 text-xs mt-1 font-medium">
              Danh sách, chỉnh sửa thông tin và theo dõi lớp học của học viên
            </p>
          </div>
          <div className="flex gap-2.5">
            <button
              onClick={handleDeleteAll}
              className="px-4 py-2.5 border border-red-200 hover:bg-red-50 text-red-600 font-semibold rounded-xl transition duration-200 text-xs inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Trash2 className="w-4 h-4 text-red-500" />
              Xóa tất cả
            </button>
            <button
              onClick={() => {
                setFullName("");
                setEmail("");
                setPhone("");
                setAddress("");
                setBirthDate("");
                setShowCreate(true);
              }}
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-xl shadow-md shadow-indigo-100 transition duration-200 text-xs inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-4.5 h-4.5" />
              Thêm Học Viên
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
            {error}
          </div>
        )}

        {/* Stats Section */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-xs flex items-center gap-4 transition hover:shadow-sm duration-200">
            <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Tổng học viên</p>
              <h3 className="text-2xl font-bold text-slate-800 mt-0.5">{students.length}</h3>
            </div>
          </div>
          <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-xs flex items-center gap-4 transition hover:shadow-sm duration-200">
            <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl">
              <UserCheck className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Đang học tập</p>
              <h3 className="text-2xl font-bold text-slate-800 mt-0.5">
                {students.filter((s) => s.status === "ACTIVE").length}
              </h3>
            </div>
          </div>
          <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-xs flex items-center gap-4 transition hover:shadow-sm duration-200">
            <div className="p-3 bg-amber-50 text-amber-600 rounded-xl">
              <UserX className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Bảo lưu / Tạm ngưng</p>
              <h3 className="text-2xl font-bold text-slate-800 mt-0.5">
                {students.filter((s) => s.status !== "ACTIVE").length}
              </h3>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white border border-slate-200 p-4 rounded-2xl shadow-xs mb-6 flex flex-col md:flex-row gap-4 items-center">
          <div className="relative flex-1 w-full">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-slate-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Tìm kiếm theo tên, email, sđt..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 text-sm transition"
            />
          </div>
          <div className="relative w-full md:w-48">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full appearance-none pl-4 pr-10 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:bg-white focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 text-sm transition cursor-pointer"
            >
              <option value="">Tất cả trạng thái</option>
              <option value="ACTIVE">Hoạt động</option>
              <option value="LOCKED">Bảo lưu</option>
            </select>
            <ChevronDown className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
          </div>
        </div>

        {/* Bulk Action Bar */}
        <div className={`mb-6 overflow-hidden transition-all duration-300 ease-in-out ${
          selectedCount > 0 ? "max-h-24 opacity-100" : "max-h-0 opacity-0 pointer-events-none"
        }`}>
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 rounded-2xl border border-indigo-100 bg-indigo-50/50 px-5 py-4 shadow-2xs">
            <div className="flex items-center gap-2.5 text-sm font-semibold text-indigo-800">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 text-[10px] font-bold text-white">
                {selectedCount}
              </span>
              <span>học viên đã được chọn</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleBulkDelete}
                className="inline-flex items-center gap-1.5 rounded-xl bg-red-600 hover:bg-red-500 px-4 py-2 text-xs font-bold text-white shadow-xs transition cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Xóa mục đã chọn
              </button>
              <button
                type="button"
                onClick={() => setSelectedIds([])}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-700 shadow-xs transition cursor-pointer"
              >
                Hủy chọn
              </button>
            </div>
          </div>
        </div>

        {/* Table list */}
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
          {loading ? (
            <div className="p-16 flex justify-center">
              <span className="w-9 h-9 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></span>
            </div>
          ) : students.length === 0 ? (
            <div className="p-16 text-center text-slate-400 flex flex-col items-center justify-center gap-3">
              <FolderOpen className="w-10 h-10 text-slate-300" />
              <span>Không tìm thấy học viên nào khớp với bộ lọc</span>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse table-fixed min-w-[950px]">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70">
                    <th className="w-[50px] px-4 py-4 text-center">
                      <input
                        type="checkbox"
                        aria-label="Chọn tất cả học viên đang hiển thị"
                        checked={allVisibleSelected}
                        onChange={toggleAllVisibleStudents}
                        className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-600 cursor-pointer"
                      />
                    </th>
                    <th className="w-[28%] px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-400">
                      Học viên
                    </th>
                    <th className="w-[36%] px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-400">
                      Thông tin cá nhân
                    </th>
                    <th className="w-[13%] px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-400 text-center">
                      Số điện thoại
                    </th>
                    <th className="w-[10%] px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-400 text-center">
                      Trạng thái
                    </th>
                    <th className="w-[13%] px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-400 text-center">
                      Thao tác
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {students.map((student) => (
                    <tr
                      key={student.id}
                      className="hover:bg-slate-50/50 transition duration-150"
                    >
                      <td className="px-4 py-4 text-center">
                        <input
                          type="checkbox"
                          aria-label={`Chọn học viên ${student.fullName}`}
                          checked={selectedIds.includes(student.id)}
                          onChange={() => toggleStudentSelection(student.id)}
                          className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-600 cursor-pointer"
                        />
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col gap-0.5">
                          <span className="font-bold text-slate-800 text-sm leading-snug">
                            {student.fullName}
                          </span>
                          <span className="text-[11px] font-medium text-slate-400 truncate">
                            {student.email || "Chưa cập nhật email"}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col gap-1 text-xs text-slate-500">
                          <div className="flex items-center gap-1.5">
                            <Calendar className="w-3.5 h-3.5 text-slate-400" />
                            <span>
                              {formatDate(student.birthDate) || "—"} 
                              {student.birthDate && ` (Tuổi: ${calculateAge(student.birthDate)})`}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 truncate">
                            <MapPin className="w-3.5 h-3.5 text-slate-400" />
                            <span className="truncate">{student.address ? formatTitleCase(student.address) : "—"}</span>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-center">
                        {student.phone ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-slate-50 border border-slate-200 text-slate-700 font-mono text-xs">
                            <Phone className="w-3 h-3 text-slate-400" />
                            <span>{student.phone}</span>
                          </span>
                        ) : (
                          <span className="text-slate-400 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap ${
                            student.status === "ACTIVE"
                              ? "bg-emerald-50 text-emerald-700 border border-emerald-205"
                              : "bg-amber-50 text-amber-700 border border-amber-205"
                          }`}
                        >
                          <span className={`w-1 h-1 rounded-full ${
                            student.status === "ACTIVE" ? "bg-emerald-500 animate-pulse" : "bg-amber-500"
                          }`} />
                          <span>{student.status === "ACTIVE" ? "Hoạt động" : "Bảo lưu"}</span>
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <div className="flex justify-center items-center gap-1.5">
                          <button
                            onClick={() => handleViewCourses(student)}
                            className="inline-flex h-8 w-8 items-center justify-center hover:bg-indigo-50 hover:text-indigo-600 text-slate-550 rounded-lg transition border border-slate-200 bg-white cursor-pointer"
                            title="Xem chi tiết lớp học của học viên"
                          >
                            <GraduationCap className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => {
                              setShowEdit(student);
                              setFullName(student.fullName);
                              setEmail(student.email || "");
                              setPhone(student.phone || "");
                              setAddress(student.address || "");
                              setBirthDate(
                                student.birthDate
                                  ? student.birthDate.substring(0, 10)
                                  : "",
                              );
                            }}
                            className="inline-flex h-8 w-8 items-center justify-center hover:bg-amber-50 hover:text-amber-600 text-slate-500 rounded-lg transition border border-slate-200 bg-white cursor-pointer"
                            title="Chỉnh sửa thông tin"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleToggleStatus(student)}
                            className="inline-flex h-8 w-8 items-center justify-center hover:bg-emerald-50 hover:text-emerald-600 text-slate-500 rounded-lg transition border border-slate-200 bg-white cursor-pointer"
                            title={student.status === "ACTIVE" ? "Bảo lưu học viên" : "Kích hoạt học viên"}
                          >
                            {student.status === "ACTIVE" ? (
                              <UserX className="w-3.5 h-3.5" />
                            ) : (
                              <UserCheck className="w-3.5 h-3.5" />
                            )}
                          </button>
                          <button
                            onClick={() => handleDelete(student.id)}
                            className="inline-flex h-8 w-8 items-center justify-center hover:bg-red-50 hover:text-red-650 text-slate-500 rounded-lg transition border border-slate-200 bg-white cursor-pointer"
                            title="Xóa học viên"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="w-full max-w-md bg-white border border-slate-105 p-6 rounded-2xl shadow-xl relative text-slate-800 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-slate-900">
                Thêm Học Viên Mới
              </h3>
              <button
                onClick={() => setShowCreate(false)}
                className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-700 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                  Họ và tên <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Ví dụ: Nguyễn Văn A"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 text-sm transition-all duration-150"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                    Ngày sinh
                  </label>
                  <input
                    type="date"
                    value={birthDate}
                    onChange={(e) => setBirthDate(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:bg-white focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 text-sm transition-all duration-150"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                    Số điện thoại
                  </label>
                  <input
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="Ví dụ: 0987654321"
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:bg-white focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 text-sm transition-all duration-150"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Ví dụ: hocvien@domain.com"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 text-sm transition-all duration-150"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                  Địa chỉ
                </label>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Ví dụ: Cầu Giấy, Hà Nội"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 text-sm transition-all duration-150"
                />
              </div>
              <div className="flex justify-end gap-2.5 pt-4 mt-6 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition shadow-sm cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving ? "Đang lưu..." : "Lưu học viên"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {showEdit && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="w-full max-w-md bg-white border border-slate-105 p-6 rounded-2xl shadow-xl relative text-slate-800 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-slate-900">
                Chỉnh Sửa Thông Tin Học Viên
              </h3>
              <button
                onClick={() => setShowEdit(null)}
                className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-700 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleUpdate} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                  Họ và tên <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:bg-white focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 text-sm transition-all duration-150"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                    Ngày sinh
                  </label>
                  <input
                    type="date"
                    value={birthDate}
                    onChange={(e) => setBirthDate(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:bg-white focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 text-sm transition-all duration-150"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                    Số điện thoại
                  </label>
                  <input
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:bg-white focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 text-sm transition-all duration-150"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:bg-white focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 text-sm transition-all duration-150"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                  Địa chỉ
                </label>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Ví dụ: Cầu Giấy, Hà Nội"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 text-sm transition-all duration-150"
                />
              </div>
              <div className="flex justify-end gap-2.5 pt-4 mt-6 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowEdit(null)}
                  className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition shadow-sm cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving ? "Đang lưu..." : "Cập nhật"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Courses Enrolled Modal */}
      {showCourses && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="w-full max-w-lg bg-white border border-slate-105 p-6 rounded-2xl shadow-xl relative text-slate-800 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-lg font-bold text-slate-900">
                Lớp Học Đang Tham Gia
              </h3>
              <button
                onClick={() => setShowCourses(null)}
                className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-700 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-slate-500 text-xs mb-5 font-medium">
              Học viên: <span className="text-slate-800 font-bold">{showCourses.fullName}</span>
            </p>

            {coursesLoading ? (
              <div className="py-12 flex justify-center">
                <span className="w-7 h-7 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin"></span>
              </div>
            ) : studentCourses.length === 0 ? (
              <div className="py-12 text-center text-slate-400 text-sm font-medium flex flex-col items-center gap-2 bg-slate-50 border border-dashed border-slate-200 rounded-2xl">
                <GraduationCap className="w-8 h-8 text-slate-400" />
                <span>Học viên này chưa tham gia khóa học nào.</span>
              </div>
            ) : (
              <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                {studentCourses.map((uc: any) => (
                  <div
                    key={uc.enrollmentId}
                    className="p-4 bg-slate-50 hover:bg-slate-100/70 border border-slate-200 rounded-2xl flex justify-between items-center transition"
                  >
                    <div>
                      <div className="font-bold text-slate-800 text-sm leading-snug">
                        {uc.course.title}
                      </div>
                      <div className="text-xs text-slate-400 mt-1 font-mono">
                        Mã khóa học: {uc.course.courseCode}
                      </div>
                    </div>
                    <div className="text-right flex items-center gap-4">
                      <div className="flex flex-col items-end gap-1.5">
                        <span className="inline-block px-2.5 py-0.5 bg-indigo-50 text-indigo-700 border border-indigo-100 rounded-full text-[10px] font-bold uppercase tracking-wider">
                          {uc.roleInCourse}
                        </span>
                        <div className="text-[10px] text-slate-400 font-medium">
                          Tham gia: {new Date(uc.enrolledAt).toLocaleDateString("vi-VN")}
                        </div>
                      </div>
                      <button
                        onClick={() =>
                          handleRemoveCourse(showCourses.id, uc.course.id)
                        }
                        className="p-2 text-red-600 hover:bg-red-50 rounded-xl transition border border-transparent hover:border-red-200 cursor-pointer"
                        title="Xóa khỏi khóa học"
                      >
                        <Trash2 className="w-4 h-4 text-red-400" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-end pt-4 mt-6 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowCourses(null)}
                className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition cursor-pointer"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
