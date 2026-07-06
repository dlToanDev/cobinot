"use client";

import React, { useEffect, useState } from "react";
import { apiClient } from "@/lib/api-client";
import { generateCourseCode, normalizeGeneratedCode } from "@hxstu/shared";
import Navbar from "../../components/Navbar";
import Link from "next/link";
import { 
  Search, 
  Plus, 
  Trash2, 
  Edit2, 
  Users, 
  Layers, 
  MoreVertical, 
  BookOpen, 
  CheckCircle2, 
  X, 
  Eye, 
  FolderOpen,
  ChevronDown,
  Play,
  Pause
} from "lucide-react";

export default function CoursesPage() {
  const [courses, setCourses] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [openDropdownId, setOpenDropdownId] = useState<number | null>(null);

  // Modals & Forms State
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState<any>(null);
  const [showStudents, setShowStudents] = useState<any>(null);
  const [enrolledStudents, setEnrolledStudents] = useState<any[]>([]);
  const [studentsLoading, setStudentsLoading] = useState(false);

  // Form Fields
  const [title, setTitle] = useState("");
  const [courseCode, setCourseCode] = useState("");
  const [courseCodeTouched, setCourseCodeTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [level, setLevel] = useState("");

  useEffect(() => {
    fetchCourses();
  }, [search, statusFilter]);

  const fetchCourses = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await apiClient.get("/courses", {
        params: {
          keyword: search || undefined,
          status: statusFilter || undefined,
        },
      });
      setCourses(res.data);
      setSelectedIds((current) =>
        current.filter((id) =>
          res.data.some((course: any) => course.id === id),
        ),
      );
    } catch (err: any) {
      setError(
        err.response?.data?.message || "Không thể tải danh sách khóa học",
      );
    } finally {
      setLoading(false);
    }
  };

  const selectedCount = selectedIds.length;
  const allVisibleSelected =
    courses.length > 0 &&
    courses.every((course) => selectedIds.includes(course.id));

  const toggleCourseSelection = (id: number) => {
    setSelectedIds((current) =>
      current.includes(id)
        ? current.filter((selectedId) => selectedId !== id)
        : [...current, id],
    );
  };

  const toggleAllVisibleCourses = () => {
    if (allVisibleSelected) {
      setSelectedIds([]);
      return;
    }

    setSelectedIds(courses.map((course) => course.id));
  };

  const handleDelete = async (id: number) => {
    if (
      !window.confirm(
        "Bạn có chắc chắn muốn xóa khóa học này? Hành động này sẽ xóa vĩnh viễn khóa học, các lớp học bên trong và thông tin ghi danh liên quan.",
      )
    ) {
      return;
    }

    setError("");
    try {
      await apiClient.delete(`/courses/${id}`);
      setSelectedIds((current) =>
        current.filter((selectedId) => selectedId !== id),
      );
      fetchCourses();
    } catch (err: any) {
      alert(err.response?.data?.message || "Không thể xóa khóa học");
    }
  };

  const handleBulkDelete = async () => {
    if (selectedCount === 0) return;

    if (
      !window.confirm(
        `Bạn có chắc chắn muốn xóa ${selectedCount} khóa học đã chọn? Hành động này sẽ xóa vĩnh viễn khóa học, các lớp học bên trong và thông tin ghi danh liên quan.`,
      )
    ) {
      return;
    }

    setError("");
    try {
      const res = await apiClient.delete("/courses/bulk", {
        data: { ids: selectedIds },
      });
      setSelectedIds([]);
      await fetchCourses();
      alert(`Đã xóa ${res.data?.deletedCount || 0} khóa học.`);
    } catch (err: any) {
      alert(
        err.response?.data?.message || "Không thể xóa các khóa học đã chọn",
      );
    }
  };

  const handleDeleteAll = async () => {
    const confirmation = window.prompt(
      "Thao tác này sẽ xóa vĩnh viễn toàn bộ khóa học, các lớp học bên trong và thông tin ghi danh liên quan. Nhập XOA TAT CA để xác nhận.",
    );

    if (confirmation !== "XOA TAT CA") return;

    setError("");
    try {
      const res = await apiClient.delete("/courses/bulk", {
        data: { all: true },
      });
      setSelectedIds([]);
      await fetchCourses();
      alert(`Đã xóa ${res.data?.deletedCount || 0} khóa học.`);
    } catch (err: any) {
      alert(err.response?.data?.message || "Không thể xóa toàn bộ khóa học");
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      const normalizedCourseCode =
        normalizeGeneratedCode(courseCode) || generateCourseCode(title);
      await apiClient.post("/courses", {
        title,
        courseCode: normalizedCourseCode,
        description: description || undefined,
        level: level || undefined,
      });
      setShowCreate(false);
      setTitle("");
      setCourseCode("");
      setCourseCodeTouched(false);
      setDescription("");
      setLevel("");
      fetchCourses();
    } catch (err: any) {
      const msg = err.response?.data?.message || "Lỗi thêm mới khóa học";
      setError(Array.isArray(msg) ? msg[0] : msg);
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      const normalizedCourseCode =
        normalizeGeneratedCode(courseCode) || generateCourseCode(title);
      await apiClient.patch(`/courses/${showEdit.id}`, {
        title,
        courseCode: normalizedCourseCode,
        description: description === "" ? null : description,
        level: level === "" ? null : level,
      });
      setShowEdit(null);
      setTitle("");
      setCourseCode("");
      setCourseCodeTouched(false);
      setDescription("");
      setLevel("");
      fetchCourses();
    } catch (err: any) {
      const msg = err.response?.data?.message || "Lỗi cập nhật khóa học";
      setError(Array.isArray(msg) ? msg[0] : msg);
    }
  };

  const handleToggleStatus = async (course: any) => {
    const newStatus = course.status === "ACTIVE" ? "CLOSED" : "ACTIVE";
    try {
      await apiClient.patch(`/courses/${course.id}/status`, {
        status: newStatus,
      });
      fetchCourses();
    } catch (err: any) {
      alert(err.response?.data?.message || "Không thể đổi trạng thái");
    }
  };

  const handleTitleChange = (value: string) => {
    setTitle(value);
    if (!courseCodeTouched) {
      setCourseCode(generateCourseCode(value));
    }
  };

  const handleCourseCodeChange = (value: string) => {
    setCourseCodeTouched(true);
    setCourseCode(normalizeGeneratedCode(value));
  };

  const handleViewStudents = async (course: any) => {
    setShowStudents(course);
    setEnrolledStudents([]);
    setStudentsLoading(true);
    try {
      const res = await apiClient.get(`/courses/${course.id}/students`);
      setEnrolledStudents(res.data);
    } catch (err: any) {
      alert(err.response?.data?.message || "Không thể tải danh sách học viên");
    } finally {
      setStudentsLoading(false);
    }
  };

  return (
    <div className="bg-slate-50 min-h-screen text-slate-800 font-sans flex flex-col">
      <Navbar />

      <div className="p-8 max-w-6xl w-full mx-auto flex-1">
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-200 pb-6 mb-8">
          <div>
            <h1 className="text-3xl font-extrabold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
              Quản Lý Khóa Học
            </h1>
            <p className="text-slate-500 text-xs mt-1 font-medium">
              Danh sách khóa học cha, trình độ phân loại, và quản lý các lớp học chi tiết
            </p>
          </div>
          <div className="flex gap-2.5">
            <button
              onClick={handleDeleteAll}
              className="px-4 py-2.5 border border-red-200 hover:bg-red-50 text-red-650 font-semibold rounded-xl transition duration-200 text-xs inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Trash2 className="w-4 h-4 text-red-500" />
              Xóa tất cả
            </button>
            <button
              onClick={() => {
                setTitle("");
                setCourseCode("");
                setCourseCodeTouched(false);
                setDescription("");
                setLevel("");
                setShowCreate(true);
              }}
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-xl shadow-md shadow-indigo-100 transition duration-200 text-xs inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-4.5 h-4.5" />
              Thêm Khóa Học
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
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Tổng khóa học</p>
              <h3 className="text-2xl font-bold text-slate-800 mt-0.5">{courses.length}</h3>
            </div>
          </div>
          <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-xs flex items-center gap-4 transition hover:shadow-sm duration-200">
            <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Đang hoạt động</p>
              <h3 className="text-2xl font-bold text-slate-800 mt-0.5">
                {courses.filter((c) => c.status === "ACTIVE").length}
              </h3>
            </div>
          </div>
          <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-xs flex items-center gap-4 transition hover:shadow-sm duration-200">
            <div className="p-3 bg-purple-50 text-purple-600 rounded-xl">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Tổng số lớp học</p>
              <h3 className="text-2xl font-bold text-slate-800 mt-0.5">
                {courses.reduce((acc, c) => acc + (c._count?.classes ?? 0), 0)}
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
              placeholder="Tìm kiếm theo tên hoặc mã khóa học..."
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
              <option value="CLOSED">Đã đóng</option>
            </select>
            <ChevronDown className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
          </div>
        </div>

        {/* Bulk Action Bar */}
        <div className={`mb-6 overflow-hidden transition-all duration-300 ease-in-out ${
          selectedCount > 0 ? "max-h-24 opacity-100" : "max-h-0 opacity-0 pointer-events-none"
        }`}>
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 rounded-2xl border border-indigo-100 bg-indigo-50/50 px-5 py-4 shadow-2xs">
            <div className="flex items-center gap-2.5 text-sm font-semibold text-indigo-855">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 text-[10px] font-bold text-white">
                {selectedCount}
              </span>
              <span>khóa học đã được chọn</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleBulkDelete}
                className="inline-flex items-center gap-1.5 rounded-xl bg-red-650 hover:bg-red-505 px-4 py-2 text-xs font-bold text-white shadow-xs transition cursor-pointer"
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
          ) : courses.length === 0 ? (
            <div className="p-16 text-center text-slate-400 flex flex-col items-center justify-center gap-3">
              <FolderOpen className="w-10 h-10 text-slate-300" />
              <span>Không tìm thấy khóa học nào khớp với bộ lọc</span>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse table-fixed min-w-[900px]">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/75">
                    <th className="w-[50px] px-4 py-4 text-center">
                      <input
                        type="checkbox"
                        aria-label="Chọn tất cả khóa học đang hiển thị"
                        checked={allVisibleSelected}
                        onChange={toggleAllVisibleCourses}
                        className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-600 cursor-pointer"
                      />
                    </th>
                    <th className="w-[28%] px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-400">
                      Khóa học
                    </th>
                    <th className="w-[36%] px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-400">
                      Phân loại & Mô tả
                    </th>
                    <th className="w-[10%] px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-400 text-center">
                      Số lớp
                    </th>
                    <th className="w-[10%] px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-400 text-center">
                      Trạng thái
                    </th>
                    <th className="w-[16%] px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-400 text-center">
                      Thao tác
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {courses.map((course) => (
                    <tr
                      key={course.id}
                      className="hover:bg-slate-50/50 transition duration-150"
                    >
                      <td className="px-4 py-4 text-center">
                        <input
                          type="checkbox"
                          aria-label={`Chọn khóa học ${course.title}`}
                          checked={selectedIds.includes(course.id)}
                          onChange={() => toggleCourseSelection(course.id)}
                          className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-600 cursor-pointer"
                        />
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col gap-0.5">
                          <span className="font-bold text-slate-800 text-sm leading-snug">
                            {course.title}
                          </span>
                          <span className="font-mono text-[10px] font-semibold text-slate-400 uppercase tracking-wide">
                            {course.courseCode}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col items-start gap-1">
                          {course.level ? (
                            <span className="inline-flex px-2 py-0.5 bg-indigo-50 border border-indigo-100 text-indigo-700 rounded-full text-[10px] font-bold">
                              {course.level}
                            </span>
                          ) : (
                            <span className="inline-flex px-2 py-0.5 bg-slate-50 border border-slate-100 text-slate-400 rounded-full text-[10px] font-medium">
                              Chưa phân loại
                            </span>
                          )}
                          <p className="text-slate-500 text-xs line-clamp-2 leading-relaxed">
                            {course.description || "Chưa có mô tả chi tiết cho khóa học này"}
                          </p>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-slate-50 border border-slate-200 text-slate-700 text-xs font-bold">
                          <Layers className="w-3.5 h-3.5 text-slate-400" />
                          <span>{course._count?.classes ?? 0}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap ${
                            course.status === "ACTIVE"
                              ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                              : "bg-slate-50 text-slate-500 border border-slate-200"
                          }`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${
                            course.status === "ACTIVE" ? "bg-emerald-500 animate-pulse" : "bg-slate-400"
                          }`} />
                          <span>{course.status === "ACTIVE" ? "Hoạt động" : "Đã đóng"}</span>
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <div className="flex justify-center items-center gap-1.5">
                          <Link
                            href={`/courses/${course.id}/classes`}
                            className="inline-flex h-8 w-8 items-center justify-center hover:bg-indigo-50 hover:text-indigo-600 text-slate-500 rounded-lg transition border border-slate-200 bg-white cursor-pointer"
                            title="Xem chi tiết lớp học"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </Link>
                          <button
                            onClick={() => handleViewStudents(course)}
                            className="inline-flex h-8 w-8 items-center justify-center hover:bg-sky-50 hover:text-sky-600 text-slate-550 rounded-lg transition border border-slate-200 bg-white cursor-pointer"
                            title="Danh sách học viên"
                          >
                            <Users className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => {
                              setShowEdit(course);
                              setTitle(course.title);
                              setCourseCode(course.courseCode);
                              setCourseCodeTouched(true);
                              setDescription(course.description || "");
                              setLevel(course.level || "");
                            }}
                            className="inline-flex h-8 w-8 items-center justify-center hover:bg-amber-50 hover:text-amber-600 text-slate-550 rounded-lg transition border border-slate-200 bg-white cursor-pointer"
                            title="Chỉnh sửa khóa học"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleToggleStatus(course)}
                            className="inline-flex h-8 w-8 items-center justify-center hover:bg-emerald-50 hover:text-emerald-600 text-slate-550 rounded-lg transition border border-slate-200 bg-white cursor-pointer"
                            title={course.status === "ACTIVE" ? "Đóng khóa học" : "Mở khóa học"}
                          >
                            {course.status === "ACTIVE" ? (
                              <Pause className="w-3.5 h-3.5" />
                            ) : (
                              <Play className="w-3.5 h-3.5" />
                            )}
                          </button>
                          <button
                            onClick={() => handleDelete(course.id)}
                            className="inline-flex h-8 w-8 items-center justify-center hover:bg-red-50 hover:text-red-650 text-slate-550 rounded-lg transition border border-slate-200 bg-white cursor-pointer"
                            title="Xóa khóa học"
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
                Tạo Khóa Học Mới
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
                  Mã khóa học <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={courseCode}
                  onChange={(e) => handleCourseCodeChange(e.target.value)}
                  placeholder="Ví dụ: I65"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 font-mono text-sm transition-all duration-150"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                  Tên khóa học <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => handleTitleChange(e.target.value)}
                  placeholder="Ví dụ: IELTS 6.5"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 text-sm transition-all duration-150"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                  Trình độ / Cấp độ
                </label>
                <select
                  value={level}
                  onChange={(e) => setLevel(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:bg-white focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 text-sm transition-all duration-150"
                >
                  <option value="">-- Chọn cấp độ --</option>
                  <option value="1">1</option>
                  <option value="2">2</option>
                  <option value="3">3</option>
                  <option value="4">4</option>
                  <option value="5">5</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                  Mô tả khóa học
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Thông tin giới thiệu về lộ trình, giáo trình học..."
                  rows={3}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 text-sm resize-none transition-all duration-150"
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
                  className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition shadow-sm cursor-pointer"
                >
                  Lưu khóa học
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
                Sửa Thông Tin Khóa Học
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
                  Mã khóa học <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={courseCode}
                  onChange={(e) => handleCourseCodeChange(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:bg-white focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 font-mono text-sm transition-all duration-150"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                  Tên khóa học <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => handleTitleChange(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:bg-white focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 text-sm transition-all duration-150"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                  Trình độ / Cấp độ
                </label>
                <select
                  value={level}
                  onChange={(e) => setLevel(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:bg-white focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 text-sm transition-all duration-150"
                >
                  <option value="">-- Chọn cấp độ --</option>
                  <option value="1">1</option>
                  <option value="2">2</option>
                  <option value="3">3</option>
                  <option value="4">4</option>
                  <option value="5">5</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                  Mô tả khóa học
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:bg-white focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 text-sm resize-none transition-all duration-150"
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
                  className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition shadow-sm cursor-pointer"
                >
                  Cập nhật
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Enrolled Students Modal */}
      {showStudents && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="w-full max-w-lg bg-white border border-slate-105 p-6 rounded-2xl shadow-xl relative text-slate-800 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-lg font-bold text-slate-900">
                Danh Sách Học Viên Tham Gia
              </h3>
              <button
                onClick={() => setShowStudents(null)}
                className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-700 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-slate-500 text-xs mb-5 font-medium">
              Khóa học: <span className="text-slate-800 font-bold">{showStudents.title}</span>
            </p>

            {studentsLoading ? (
              <div className="py-12 flex justify-center">
                <span className="w-7 h-7 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin"></span>
              </div>
            ) : enrolledStudents.length === 0 ? (
              <div className="py-12 text-center text-slate-400 text-sm font-medium flex flex-col items-center gap-2 bg-slate-50 border border-dashed border-slate-200 rounded-2xl">
                <Users className="w-8 h-8 text-slate-400" />
                <span>Chưa có học viên nào tham gia khóa học này.</span>
              </div>
            ) : (
              <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                {enrolledStudents.map((uc: any) => (
                  <div
                    key={uc.enrollmentId}
                    className="p-4 bg-slate-50 hover:bg-slate-100/70 border border-slate-200 rounded-2xl flex justify-between items-center transition"
                  >
                    <div>
                      <div className="font-bold text-slate-800 text-sm leading-snug">
                        {uc.student.fullName}
                      </div>
                      <div className="text-xs text-slate-450 mt-1 font-medium">
                        {uc.student.email || uc.student.phone || "Không có thông tin liên hệ"}
                      </div>
                      {uc.classTitle && (
                        <div className="text-xs text-indigo-600 font-bold mt-1.5 flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                          <span>Lớp: {uc.classTitle} {uc.classType && `(${uc.classType})`}</span>
                        </div>
                      )}
                    </div>
                    <div className="text-right flex flex-col items-end gap-1.5">
                      <span className="inline-block px-2.5 py-0.5 bg-indigo-50 text-indigo-700 border border-indigo-100 rounded-full text-[10px] font-bold uppercase tracking-wider">
                        {uc.roleInClass || uc.roleInCourse || "STUDENT"}
                      </span>
                      <div className="text-[10px] text-slate-450 font-medium">
                        Tham gia: {new Date(uc.enrolledAt).toLocaleDateString("vi-VN")}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-end pt-4 mt-6 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowStudents(null)}
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
