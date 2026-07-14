"use client";

import React, { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { apiClient } from "@/lib/api-client";
import Navbar from "../../../../components/Navbar";
import { generateClassCode, normalizeGeneratedCode } from "@hxstu/shared";

export default function CourseClassesPage() {
  const params = useParams();
  const router = useRouter();
  const courseId = Number(params.courseId);

  const [course, setCourse] = useState<any>(null);
  const [classes, setClasses] = useState<any[]>([]);
  const [allCourses, setAllCourses] = useState<
    Array<{ id: number; title: string; courseCode?: string | null }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // Modals & Sub-state
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState<any>(null);
  const [confirmDeleteClass, setConfirmDeleteClass] = useState<any>(null);

  // Class Form Fields
  const [classCode, setClassCode] = useState("");
  const [classCodeTouched, setClassCodeTouched] = useState(false);
  const [title, setTitle] = useState("");
  const [type, setType] = useState("WEEKLY");
  // Khóa học cha của lớp trong form sửa (cho phép chuyển lớp sang khóa khác).
  const [formCourseId, setFormCourseId] = useState<number>(0);
  const [teacherName, setTeacherName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (courseId) {
      fetchInitData();
    }
  }, [courseId]);

  const fetchInitData = async () => {
    setLoading(true);
    setError("");
    try {
      const [courseRes, classesRes, allCoursesRes] = await Promise.all([
        apiClient.get(`/courses/${courseId}`),
        apiClient.get(`/courses/${courseId}/classes`),
        apiClient.get("/courses"),
      ]);
      setCourse(courseRes.data);
      setClasses(classesRes.data);
      setAllCourses(
        Array.isArray(allCoursesRes.data) ? allCoursesRes.data : [],
      );
    } catch (err: any) {
      setError(
        err.response?.data?.message || "Không thể tải dữ liệu lớp học"
      );
    } finally {
      setLoading(false);
    }
  };

  const refreshClasses = async () => {
    try {
      const res = await apiClient.get(`/courses/${courseId}/classes`);
      setClasses(res.data);
    } catch (err: any) {
      console.error("Lỗi khi cập nhật danh sách lớp:", err);
    }
  };

  const handleCreateClass = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      const normalizedClassCode =
        normalizeGeneratedCode(classCode) || buildClassCode(title, type);
      await apiClient.post(`/courses/${courseId}/classes`, {
        classCode: normalizedClassCode,
        title,
        type,
        teacherName: teacherName || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        description: description || undefined,
      });
      setShowCreate(false);
      resetClassForm();
      await refreshClasses();
    } catch (err: any) {
      const msg = err.response?.data?.message || "Lỗi tạo lớp học";
      setError(Array.isArray(msg) ? msg[0] : msg);
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateClass = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      const normalizedClassCode =
        normalizeGeneratedCode(classCode) || buildClassCode(title, type);
      const movedToOtherCourse =
        formCourseId > 0 && formCourseId !== courseId;
      await apiClient.patch(`/classes/${showEdit.id}`, {
        courseId: formCourseId > 0 ? formCourseId : undefined,
        classCode: normalizedClassCode,
        title,
        type,
        teacherName: teacherName || null,
        startDate: startDate || null,
        endDate: endDate || null,
        description: description || null,
      });
      setShowEdit(null);
      resetClassForm();
      await refreshClasses();
      if (movedToOtherCourse) {
        const targetCourse = allCourses.find(
          (item) => Number(item.id) === formCourseId,
        );
        alert(
          `Lớp đã được chuyển sang khóa "${targetCourse?.title || `#${formCourseId}`}".`,
        );
      }
    } catch (err: any) {
      const msg = err.response?.data?.message || "Lỗi cập nhật lớp học";
      setError(Array.isArray(msg) ? msg[0] : msg);
    } finally {
      setSaving(false);
    }
  };

  const executeDeleteClass = async () => {
    if (!confirmDeleteClass) return;
    try {
      await apiClient.delete(`/classes/${confirmDeleteClass.id}`);
      setConfirmDeleteClass(null);
      await refreshClasses();
    } catch (err: any) {
      alert(err.response?.data?.message || "Không thể xóa lớp học");
    }
  };

  const resetClassForm = () => {
    setClassCode("");
    setClassCodeTouched(false);
    setTitle("");
    setType("WEEKLY");
    setTeacherName("");
    setStartDate("");
    setEndDate("");
    setDescription("");
    setFormCourseId(courseId);
  };

  // Sinh mã lớp theo khóa đang chọn trong form (mặc định là khóa của trang).
  const resolveFormCourse = (nextCourseId: number = formCourseId) =>
    allCourses.find((item) => Number(item.id) === nextCourseId) || course;

  const buildClassCode = (
    nextTitle: string,
    nextType: string,
    nextCourseId: number = formCourseId,
  ) => {
    const formCourse = resolveFormCourse(nextCourseId);
    return generateClassCode({
      courseCode: formCourse?.courseCode,
      courseTitle: formCourse?.title,
      classTitle: nextTitle,
      classType: nextType,
      includeClassType: Boolean(nextType),
    });
  };

  const handleClassTitleChange = (value: string) => {
    setTitle(value);
    if (!classCodeTouched) {
      setClassCode(buildClassCode(value, type));
    }
  };

  const handleClassTypeChange = (value: string) => {
    setType(value);
    if (!classCodeTouched) {
      setClassCode(buildClassCode(title, value));
    }
  };

  const handleClassCourseChange = (value: string) => {
    const nextCourseId = Number(value) || 0;
    setFormCourseId(nextCourseId);
    // User chưa chỉnh tay mã lớp -> sinh lại theo khóa mới + tên + loại lớp.
    if (!classCodeTouched) {
      setClassCode(buildClassCode(title, type, nextCourseId));
    }
  };

  const handleClassCodeChange = (value: string) => {
    setClassCodeTouched(true);
    setClassCode(normalizeGeneratedCode(value));
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "—";
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return "—";
    return date.toLocaleDateString("vi-VN");
  };

  return (
    <div className="bg-slate-50 min-h-screen text-slate-800 font-sans flex flex-col">
      <Navbar />

      <div className="p-8 max-w-6xl w-full mx-auto flex-1">
        <div className="mb-5">
          <Link href="/courses" className="text-sm font-semibold text-indigo-600 hover:text-indigo-500">
            &larr; Quay lại danh sách khóa học
          </Link>
        </div>

        {course && (
          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm mb-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
            <div>
              <span className="inline-block px-2 py-0.5 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded text-xs font-mono font-bold uppercase mb-2">
                Khóa học: {course.courseCode}
              </span>
              <h1 className="text-3xl font-extrabold text-slate-900 leading-tight">
                Lớp học thuộc: {course.title}
              </h1>
              <p className="text-slate-500 text-sm mt-1 font-medium max-w-xl">
                {course.description || "Chưa có mô tả chi tiết cho khóa học này."}
              </p>
            </div>
            <button
              onClick={() => {
                resetClassForm();
                setShowCreate(true);
              }}
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-xl shadow-md shadow-indigo-200 transition duration-200 whitespace-nowrap"
            >
              Tạo Lớp Học Mới
            </button>
          </div>
        )}

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
            {error}
          </div>
        )}

        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
          {loading ? (
            <div className="p-12 flex justify-center">
              <span className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></span>
            </div>
          ) : classes.length === 0 ? (
            <div className="p-12 text-center text-slate-400 font-medium text-sm">
              Chưa có lớp học nào được tạo cho khóa học này.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/80">
                    <th className="px-5 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      Mã lớp
                    </th>
                    <th className="px-5 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      Tên lớp học
                    </th>
                    <th className="px-5 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      Phân loại
                    </th>
                    <th className="px-5 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      Giáo viên
                    </th>
                    <th className="px-5 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      Thời gian học
                    </th>
                    <th className="px-5 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-500 text-center">
                      Sĩ số
                    </th>
                    <th className="px-5 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-500 text-center">
                      Thao tác
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {classes.map((cls) => (
                    <tr
                      key={cls.id}
                      className="hover:bg-slate-50/50 transition duration-150"
                    >
                      <td className="px-5 py-2.5 font-mono text-[11px] font-bold text-indigo-600">
                        {cls.classCode}
                      </td>
                      <td className="px-5 py-2.5">
                        <div className="font-bold text-slate-800 text-[12px]">
                          {cls.title}
                        </div>
                        {cls.description && (
                          <div className="text-[10px] text-slate-400 font-normal mt-0.5 line-clamp-1">
                            {cls.description}
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-2.5">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase ${
                            cls.type === "WEEKLY"
                              ? "bg-sky-50 text-sky-700 border-sky-200"
                              : "bg-amber-50 text-amber-700 border-amber-200"
                          }`}
                        >
                          {cls.type === "WEEKLY" ? "Học theo tuần" : "Luyện đề"}
                        </span>
                      </td>
                      <td className="px-5 py-2.5 font-medium text-slate-700 text-[12px]">
                        {cls.teacherName || "Chưa phân công"}
                      </td>
                      <td className="px-5 py-2.5 text-slate-500 text-[11px]">
                        {formatDate(cls.startDate)} &rarr; {formatDate(cls.endDate)}
                      </td>
                      <td className="px-5 py-2.5 text-center font-bold text-indigo-600 bg-indigo-50/10 text-[12px]">
                        {cls._count?.enrollments || 0}
                      </td>
                      <td className="px-5 py-2.5 text-center">
                        <div className="flex justify-center items-center gap-1.5">
                          <Link
                            href={`/courses/${courseId}/classes/${cls.id}`}
                            className="inline-flex h-7.5 px-3 items-center justify-center bg-violet-50 hover:bg-violet-100 text-violet-750 rounded-lg text-[11px] font-bold transition border border-violet-200 shadow-sm"
                          >
                            Quản lý
                          </Link>
                          <button
                            onClick={() => {
                              const clsCourseId = Number(cls.courseId) || courseId;
                              setShowEdit(cls);
                              setClassCode(cls.classCode);
                              // Mã đang đúng dạng tự sinh -> cho phép sinh lại khi
                              // đổi khóa/tên/loại; mã đã chỉnh tay -> giữ nguyên.
                              setClassCodeTouched(
                                cls.classCode !==
                                  buildClassCode(cls.title, cls.type, clsCourseId),
                              );
                              setTitle(cls.title);
                              setType(cls.type);
                              setFormCourseId(clsCourseId);
                              setTeacherName(cls.teacherName || "");
                              setStartDate(cls.startDate ? cls.startDate.substring(0, 10) : "");
                              setEndDate(cls.endDate ? cls.endDate.substring(0, 10) : "");
                              setDescription(cls.description || "");
                            }}
                            className="inline-flex h-7.5 px-2.5 items-center justify-center bg-slate-50 hover:bg-slate-100 text-slate-600 rounded-lg text-[11px] font-medium transition border border-slate-200"
                          >
                            Sửa
                          </button>
                          <button
                            onClick={() => setConfirmDeleteClass(cls)}
                            className="inline-flex h-7.5 px-2.5 items-center justify-center bg-red-50 hover:bg-red-100 text-red-650 rounded-lg text-[11px] font-semibold transition border border-red-200"
                          >
                            Xóa
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

      {/* Create Class Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="w-full max-w-md bg-white border border-slate-105 p-6 rounded-2xl shadow-xl relative text-slate-800 animate-in zoom-in-95 duration-200">
            <h3 className="text-lg font-bold mb-4 text-slate-900">
              Tạo Lớp Học Mới
            </h3>
            <form onSubmit={handleCreateClass} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Mã lớp học *</label>
                  <input
                    type="text"
                    value={classCode}
                    onChange={(e) => handleClassCodeChange(e.target.value)}
                    placeholder="VD: T550_TOEIC_WEEKLY_1"
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 font-mono text-sm transition-all duration-150"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Tên lớp học *</label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => handleClassTitleChange(e.target.value)}
                    placeholder="VD: Lớp TOEIC 1"
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 text-sm transition-all duration-150"
                    required
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Loại lớp học</label>
                  <select
                    value={type}
                    onChange={(e) => handleClassTypeChange(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:bg-white focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 text-sm transition-all duration-150"
                  >
                    <option value="WEEKLY">Học theo tuần (WEEKLY)</option>
                    <option value="EXAM_PRACTICE">Luyện đề (EXAM_PRACTICE)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Giáo viên</label>
                  <input
                    type="text"
                    value={teacherName}
                    onChange={(e) => setTeacherName(e.target.value)}
                    placeholder="Tên GV phụ trách"
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 text-sm transition-all duration-150"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Ngày bắt đầu</label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:bg-white focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 text-sm transition-all duration-150"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Ngày kết thúc</label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:bg-white focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 text-sm transition-all duration-150"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Mô tả/Ghi chú</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Ghi chú về thời gian, phòng học, giáo trình..."
                  rows={2}
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
                  disabled={saving}
                  className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition shadow-sm cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving ? "Đang lưu..." : "Lưu lớp học"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Class Modal */}
      {showEdit && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="w-full max-w-md bg-white border border-slate-105 p-6 rounded-2xl shadow-xl relative text-slate-800 animate-in zoom-in-95 duration-200">
            <h3 className="text-lg font-bold mb-4 text-slate-900">
              Chỉnh Sửa Lớp Học
            </h3>
            <form onSubmit={handleUpdateClass} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                  Khóa học <span className="text-red-500">*</span>
                </label>
                <select
                  value={formCourseId || ""}
                  onChange={(e) => handleClassCourseChange(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:bg-white focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 text-sm transition-all duration-150"
                  required
                >
                  {allCourses.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.courseCode
                        ? `${item.title} (${item.courseCode})`
                        : item.title}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Mã lớp học *</label>
                  <input
                    type="text"
                    value={classCode}
                    onChange={(e) => handleClassCodeChange(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:bg-white focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 font-mono text-sm transition-all duration-150"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Tên lớp học *</label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => handleClassTitleChange(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:bg-white focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 text-sm transition-all duration-150"
                    required
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Loại lớp học</label>
                  <select
                    value={type}
                    onChange={(e) => handleClassTypeChange(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:bg-white focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 text-sm transition-all duration-150"
                  >
                    <option value="WEEKLY">Học theo tuần (WEEKLY)</option>
                    <option value="EXAM_PRACTICE">Luyện đề (EXAM_PRACTICE)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Giáo viên</label>
                  <input
                    type="text"
                    value={teacherName}
                    onChange={(e) => setTeacherName(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:bg-white focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 text-sm transition-all duration-150"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Ngày bắt đầu</label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:bg-white focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 text-sm transition-all duration-150"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Ngày kết thúc</label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:bg-white focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 text-sm transition-all duration-150"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Mô tả/Ghi chú</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
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

      {/* Custom Confirmation Modals */}
      {confirmDeleteClass && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-[60] animate-in fade-in duration-200">
          <div className="w-full max-w-md bg-white border border-slate-105 p-6 rounded-2xl shadow-xl relative text-slate-800 animate-in zoom-in-95 duration-200">
            <h3 className="text-lg font-bold text-red-650 mb-2">
              Xác Nhận Xóa Lớp Học
            </h3>
            <p className="text-slate-600 text-sm mb-6 font-medium leading-relaxed">
              Bạn có chắc chắn muốn xóa lớp <strong>{confirmDeleteClass.classCode}</strong>? Hành động này sẽ xóa vĩnh viễn lớp học và toàn bộ học viên ra khỏi lớp.
            </p>
            <div className="flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setConfirmDeleteClass(null)}
                className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={executeDeleteClass}
                className="px-4 py-2.5 bg-red-650 hover:bg-red-505 text-white rounded-xl text-xs font-bold transition shadow-sm cursor-pointer"
              >
                Xác nhận xóa
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
