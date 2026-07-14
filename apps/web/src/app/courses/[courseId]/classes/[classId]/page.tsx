"use client";

import React, { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { apiClient } from "@/lib/api-client";
import { generateClassCode, normalizeGeneratedCode } from "@hxstu/shared";
import Navbar from "../../../../../components/Navbar";

export default function ClassDetailPage() {
  const params = useParams();
  const router = useRouter();
  const courseId = Number(params.courseId);
  const classId = Number(params.classId);

  const [course, setCourse] = useState<any>(null);
  const [classDetail, setClassDetail] = useState<any>(null);
  const [enrolledStudents, setEnrolledStudents] = useState<any[]>([]);
  const [students, setStudents] = useState<any[]>([]);
  const [allCourses, setAllCourses] = useState<
    Array<{ id: number; title: string; courseCode?: string | null }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Tab State
  const [activeTab, setActiveTab] = useState<"info" | "students" | "schedule" | "assignments">("students");

  // Modals & sub-state
  const [showAddStudent, setShowAddStudent] = useState(false);
  const [confirmRemoveStudent, setConfirmRemoveStudent] = useState<any>(null);
  const [studentsLoading, setStudentsLoading] = useState(false);

  // Student Enrollment Fields
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [roleInClass, setRoleInClass] = useState("STUDENT");
  const [joinedAt, setJoinedAt] = useState(new Date().toISOString().substring(0, 10));

  // Edit Class Form fields (Info tab)
  const [editClassCode, setEditClassCode] = useState("");
  const [editClassCodeTouched, setEditClassCodeTouched] = useState(true);
  const [editTitle, setEditTitle] = useState("");
  const [editType, setEditType] = useState("WEEKLY");
  const [editCourseId, setEditCourseId] = useState(0);
  const [editTeacherName, setEditTeacherName] = useState("");
  const [editStartDate, setEditStartDate] = useState("");
  const [editEndDate, setEditEndDate] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editLoading, setEditLoading] = useState(false);
  const [editSuccess, setEditSuccess] = useState(false);

  useEffect(() => {
    if (classId) {
      fetchClassData();
    }
  }, [classId, courseId]);

  const buildEditClassCode = (
    courseList: Array<{ id: number; title: string; courseCode?: string | null }>,
    nextCourseId: number,
    nextTitle: string,
    nextType: string,
  ) => {
    const formCourse = courseList.find(
      (item) => Number(item.id) === nextCourseId,
    );
    return generateClassCode({
      courseCode: formCourse?.courseCode,
      courseTitle: formCourse?.title,
      classTitle: nextTitle,
      classType: nextType,
      includeClassType: Boolean(nextType),
    });
  };

  const fetchClassData = async () => {
    setLoading(true);
    setError("");
    try {
      const [classRes, studentsRes, allStudentsRes, courseRes, coursesRes] =
        await Promise.all([
          apiClient.get(`/classes/${classId}`),
          apiClient.get(`/classes/${classId}/students`),
          apiClient.get("/students"),
          apiClient.get(`/courses/${courseId}`),
          apiClient.get("/courses"),
        ]);
      setClassDetail(classRes.data);
      setEnrolledStudents(studentsRes.data);
      setStudents(allStudentsRes.data);
      setCourse(courseRes.data);
      const courseList = Array.isArray(coursesRes.data) ? coursesRes.data : [];
      setAllCourses(courseList);

      // Populate Edit Form Fields
      const clsCourseId = Number(classRes.data.courseId) || courseId;
      setEditClassCode(classRes.data.classCode);
      // Mã đang đúng dạng tự sinh -> cho phép sinh lại khi đổi khóa/tên/loại.
      setEditClassCodeTouched(
        classRes.data.classCode !==
          buildEditClassCode(
            courseList,
            clsCourseId,
            classRes.data.title,
            classRes.data.type,
          ),
      );
      setEditTitle(classRes.data.title);
      setEditType(classRes.data.type);
      setEditCourseId(clsCourseId);
      setEditTeacherName(classRes.data.teacherName || "");
      setEditStartDate(classRes.data.startDate ? classRes.data.startDate.substring(0, 10) : "");
      setEditEndDate(classRes.data.endDate ? classRes.data.endDate.substring(0, 10) : "");
      setEditDescription(classRes.data.description || "");
    } catch (err: any) {
      setError(
        err.response?.data?.message || "Không thể tải thông tin lớp học"
      );
    } finally {
      setLoading(false);
    }
  };

  // Sinh lại mã lớp khi user đổi khóa/tên/loại mà chưa chỉnh tay mã.
  const syncEditClassCode = (
    nextCourseId: number,
    nextTitle: string,
    nextType: string,
  ) => {
    if (!editClassCodeTouched) {
      setEditClassCode(
        buildEditClassCode(allCourses, nextCourseId, nextTitle, nextType),
      );
    }
  };

  const handleUpdateClassInfo = async (e: React.FormEvent) => {
    e.preventDefault();
    setEditLoading(true);
    setEditSuccess(false);
    setError("");
    try {
      const movedToOtherCourse = editCourseId > 0 && editCourseId !== courseId;
      const res = await apiClient.patch(`/classes/${classId}`, {
        courseId: editCourseId > 0 ? editCourseId : undefined,
        classCode: normalizeGeneratedCode(editClassCode),
        title: editTitle,
        type: editType,
        teacherName: editTeacherName || null,
        startDate: editStartDate || null,
        endDate: editEndDate || null,
        description: editDescription || null,
      });
      setClassDetail(res.data);
      setEditSuccess(true);
      setTimeout(() => setEditSuccess(false), 3000);
      if (movedToOtherCourse) {
        // Route theo khóa mới để URL khớp dữ liệu; effect sẽ refetch banner.
        router.replace(`/courses/${editCourseId}/classes/${classId}`);
      }
    } catch (err: any) {
      setError(err.response?.data?.message || "Không thể cập nhật lớp học");
    } finally {
      setEditLoading(false);
    }
  };

  const handleAddStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStudentId) return;
    setError("");
    try {
      await apiClient.post(`/classes/${classId}/students`, {
        userId: Number(selectedStudentId),
        roleInClass,
        joinedAt,
      });
      setSelectedStudentId("");
      setRoleInClass("STUDENT");
      setShowAddStudent(false);
      // refresh student list
      setStudentsLoading(true);
      const res = await apiClient.get(`/classes/${classId}/students`);
      setEnrolledStudents(res.data);
    } catch (err: any) {
      alert(err.response?.data?.message || "Không thể thêm học viên");
    } finally {
      setStudentsLoading(false);
    }
  };

  const executeRemoveStudent = async () => {
    if (!confirmRemoveStudent) return;
    const { studentId } = confirmRemoveStudent;
    setError("");
    try {
      await apiClient.delete(`/classes/${classId}/students/${studentId}`);
      setConfirmRemoveStudent(null);
      // refresh student list
      setStudentsLoading(true);
      const res = await apiClient.get(`/classes/${classId}/students`);
      setEnrolledStudents(res.data);
    } catch (err: any) {
      alert(err.response?.data?.message || "Không thể xóa học viên");
    } finally {
      setStudentsLoading(false);
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "Chưa cập nhật";
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return "Chưa cập nhật";
    return date.toLocaleDateString("vi-VN");
  };

  // Generate simulated sessions list based on class dates
  const generateSessions = () => {
    if (!classDetail) return [];
    const baseDate = classDetail.startDate ? new Date(classDetail.startDate) : new Date();
    const sessions = [];
    const topics = [
      "Introduction to course modules & objectives",
      "Core skills, reading comprehension & vocabulary builder",
      "Listening strategies, key question types & mock session",
      "Writing task 1 templates, structures and visual charts",
      "Speaking task 1 & 2 practice, model replies & mock test",
      "Final review, exam instructions & feedback session",
    ];

    for (let i = 0; i < 6; i++) {
      const sessionDate = new Date(baseDate);
      sessionDate.setDate(baseDate.getDate() + i * 7); // weekly sessions
      const isPast = sessionDate.getTime() < Date.now();
      sessions.push({
        id: i + 1,
        title: `Buổi ${i + 1}: ${topics[i]}`,
        date: sessionDate.toLocaleDateString("vi-VN"),
        time: classDetail.type === "WEEKLY" ? "18:00 - 20:00" : "19:30 - 21:30",
        room: `Phòng học ${101 + (i % 3)}`,
        status: isPast ? "COMPLETED" : i === 0 || i === 1 ? "SCHEDULED" : "PENDING",
      });
    }
    return sessions;
  };

  // Generate simulated homework/exams
  const generateAssignments = () => {
    if (!classDetail) return [];
    return [
      {
        id: 1,
        title: "Homework 1: Vocabulary builder & Reading exercise",
        type: "HOMEWORK",
        dueDate: "Bên dưới",
        status: "Đang mở",
        score: "—",
      },
      {
        id: 2,
        title: "Practice Mock Test 1: Full listening test",
        type: "EXAM",
        dueDate: "Bên dưới",
        status: "Đã hạn",
        score: "Đã chấm",
      },
      {
        id: 3,
        title: "Writing task 1: Practice bar chart description",
        type: "HOMEWORK",
        dueDate: "Bên dưới",
        status: "Đang mở",
        score: "—",
      },
    ];
  };

  const existingStudentIds = new Set(enrolledStudents.map((item) => Number(item.student?.id)));
  const selectableStudents = students.filter((student) => !existingStudentIds.has(student.id));

  return (
    <div className="bg-slate-50 min-h-screen text-slate-800 font-sans flex flex-col">
      <Navbar />

      <div className="p-8 w-full flex-1 flex flex-col">

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-750 text-sm">
            {error}
          </div>
        )}

        {loading ? (
          <div className="p-12 flex justify-center">
            <span className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></span>
          </div>
        ) : !classDetail ? (
          <div className="p-12 text-center bg-white border border-slate-200 rounded-2xl text-slate-400 font-medium">
            Không tìm thấy thông tin lớp học.
          </div>
        ) : (
          <div className="space-y-8">
            {/* Top Section: Course Image & Class Info Banner */}
            <div className="relative overflow-hidden rounded-3xl bg-slate-900 shadow-xl border border-slate-200 h-[220px] w-full flex items-end">
              <img
                src="/class_banner.png"
                alt="Class Graphic"
                className="absolute inset-0 w-full h-full object-cover object-center opacity-70"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent"></div>
              <div className="relative z-10 p-6 md:p-8 w-full flex flex-col md:flex-row md:items-end justify-between gap-6 text-white">
                <div>
                  <div className="flex flex-wrap items-center gap-2 mb-2.5">
                    <span className="px-2.5 py-0.5 bg-indigo-600/80 text-white rounded text-[10px] font-mono font-bold uppercase tracking-wider backdrop-blur-sm">
                      Khóa: {course?.title}
                    </span>
                    <span className="px-2.5 py-0.5 bg-violet-600/80 text-white rounded text-[10px] font-mono font-bold uppercase tracking-wider backdrop-blur-sm">
                      Lớp: {classDetail.classCode}
                    </span>
                  </div>
                  <h1 className="text-2xl md:text-3xl font-black tracking-tight">{classDetail.title}</h1>
                  <p className="text-slate-350 text-xs mt-1.5 font-medium max-w-xl line-clamp-1">
                    {classDetail.description || "Lớp học chất lượng cao phục vụ lộ trình ôn thi hiệu quả."}
                  </p>
                </div>
                <div className="flex flex-col gap-0.5 items-start md:items-end text-xs text-slate-300 font-medium whitespace-nowrap">
                  <div>Giáo viên: <span className="text-white font-bold">{classDetail.teacherName || "Chưa phân công"}</span></div>
                  <div>Thời gian: <span className="text-white font-bold">{formatDate(classDetail.startDate)} - {formatDate(classDetail.endDate)}</span></div>
                </div>
              </div>
            </div>

            {/* Split layout: Left Menu Sidebar & Right Dynamic Panel */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-start">
              {/* Left Menu Sidebar */}
              <div className="md:col-span-3 space-y-2">
                <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-1">
                  <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-3 mb-3">Tác vụ lớp học</h3>
                  <button
                    onClick={() => setActiveTab("info")}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition duration-150 ${
                      activeTab === "info"
                        ? "bg-indigo-600 text-white shadow-md shadow-indigo-100"
                        : "text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                    Thông tin lớp học
                  </button>
                  <button
                    onClick={() => setActiveTab("students")}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition duration-150 ${
                      activeTab === "students"
                        ? "bg-indigo-600 text-white shadow-md shadow-indigo-100"
                        : "text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                    </svg>
                    Danh sách học viên
                  </button>
                  <button
                    onClick={() => setActiveTab("schedule")}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition duration-150 ${
                      activeTab === "schedule"
                        ? "bg-indigo-600 text-white shadow-md shadow-indigo-100"
                        : "text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    Lịch học & Buổi học
                  </button>
                  <button
                    onClick={() => setActiveTab("assignments")}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition duration-150 ${
                      activeTab === "assignments"
                        ? "bg-indigo-600 text-white shadow-md shadow-indigo-100"
                        : "text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Bài tập & Đề thi
                  </button>

                  <div className="pt-2 mt-2 border-t border-slate-100">
                    <Link
                      href={`/courses/${courseId}/classes`}
                      className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold text-slate-500 hover:text-indigo-600 hover:bg-slate-50 transition duration-150"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                      </svg>
                      Quay lại danh sách
                    </Link>
                  </div>
                </div>
              </div>

              {/* Right Dynamic Content Panel */}
              <div className="md:col-span-9 bg-white border border-slate-200 rounded-3xl p-6 shadow-sm min-h-[400px]">
                {/* 0. Tab INFO — sửa thông tin lớp, cho phép chuyển khóa */}
                {activeTab === "info" && (
                  <div className="space-y-6">
                    <div className="pb-4 border-b border-slate-100">
                      <h2 className="text-xl font-extrabold text-slate-900">Thông Tin Lớp Học</h2>
                      <p className="text-slate-500 text-xs font-medium">Chỉnh sửa tên, mã lớp, lịch, giáo viên và khóa học cha</p>
                    </div>

                    {editSuccess && (
                      <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-700 text-sm font-medium">
                        Đã cập nhật thông tin lớp học.
                      </div>
                    )}

                    <form onSubmit={handleUpdateClassInfo} className="space-y-4 max-w-2xl">
                      <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                          Khóa học <span className="text-red-500">*</span>
                        </label>
                        <select
                          value={editCourseId || ""}
                          onChange={(e) => {
                            const nextCourseId = Number(e.target.value) || 0;
                            setEditCourseId(nextCourseId);
                            syncEditClassCode(nextCourseId, editTitle, editType);
                          }}
                          className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:bg-white focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 text-sm transition-all duration-150"
                          required
                        >
                          {allCourses.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.courseCode ? `${item.title} (${item.courseCode})` : item.title}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                            Mã lớp học <span className="text-red-500">*</span>
                          </label>
                          <input
                            type="text"
                            value={editClassCode}
                            onChange={(e) => {
                              setEditClassCodeTouched(true);
                              setEditClassCode(normalizeGeneratedCode(e.target.value));
                            }}
                            className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:bg-white focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 font-mono text-sm transition-all duration-150"
                            required
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                            Tên lớp học <span className="text-red-500">*</span>
                          </label>
                          <input
                            type="text"
                            value={editTitle}
                            onChange={(e) => {
                              setEditTitle(e.target.value);
                              syncEditClassCode(editCourseId, e.target.value, editType);
                            }}
                            className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:bg-white focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 text-sm transition-all duration-150"
                            required
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Loại lớp học</label>
                          <select
                            value={editType}
                            onChange={(e) => {
                              setEditType(e.target.value);
                              syncEditClassCode(editCourseId, editTitle, e.target.value);
                            }}
                            className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:bg-white focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 text-sm transition-all duration-150"
                          >
                            <option value="WEEKLY">Học theo tuần (WEEKLY)</option>
                            <option value="EXAM_PRACTICE">Luyện đề (EXAM_PRACTICE)</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Giáo viên phụ trách</label>
                          <input
                            type="text"
                            value={editTeacherName}
                            onChange={(e) => setEditTeacherName(e.target.value)}
                            placeholder="Tên GV phụ trách"
                            className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 text-sm transition-all duration-150"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Ngày bắt đầu</label>
                          <input
                            type="date"
                            value={editStartDate}
                            onChange={(e) => setEditStartDate(e.target.value)}
                            className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:bg-white focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 text-sm transition-all duration-150"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Ngày kết thúc</label>
                          <input
                            type="date"
                            value={editEndDate}
                            onChange={(e) => setEditEndDate(e.target.value)}
                            className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:bg-white focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 text-sm transition-all duration-150"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Mô tả/Ghi chú</label>
                        <textarea
                          value={editDescription}
                          onChange={(e) => setEditDescription(e.target.value)}
                          rows={3}
                          className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:bg-white focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 text-sm resize-none transition-all duration-150"
                        />
                      </div>
                      <div className="flex justify-end pt-4 border-t border-slate-100">
                        <button
                          type="submit"
                          disabled={editLoading}
                          className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition shadow-sm cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {editLoading ? "Đang lưu..." : "Lưu thay đổi"}
                        </button>
                      </div>
                    </form>
                  </div>
                )}

                {/* 1. Tab STUDENTS */}
                {activeTab === "students" && (
                  <div className="space-y-6">
                    <div className="flex justify-between items-center pb-4 border-b border-slate-100">
                      <div>
                        <h2 className="text-xl font-extrabold text-slate-900">Danh Sách Thành Viên</h2>
                        <p className="text-slate-500 text-xs font-medium">Ghi danh, bổ nhiệm và quản lý sĩ số lớp học</p>
                      </div>
                      <button
                        onClick={() => {
                          setSelectedStudentId("");
                          setRoleInClass("STUDENT");
                          setJoinedAt(new Date().toISOString().substring(0, 10));
                          setShowAddStudent(true);
                        }}
                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold rounded-xl shadow-sm transition"
                      >
                        + Thêm học viên
                      </button>
                    </div>

                    {studentsLoading ? (
                      <div className="p-12 flex justify-center">
                        <span className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></span>
                      </div>
                    ) : enrolledStudents.length === 0 ? (
                      <div className="p-12 text-center text-slate-400 font-medium">
                        Lớp học chưa có học viên nào tham gia. Hãy thêm học viên mới.
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="border-b border-slate-200 bg-slate-50/50">
                              <th className="px-5 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">Học viên</th>
                              <th className="px-5 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">Liên hệ</th>
                              <th className="px-5 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">Vai trò</th>
                              <th className="px-5 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">Gia nhập</th>
                              <th className="px-5 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-500 text-center">Thao tác</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {enrolledStudents.map((enrollment) => (
                              <tr key={enrollment.enrollmentId} className="hover:bg-slate-50/30 transition">
                                <td className="px-5 py-2.5 font-bold text-slate-800 text-[12px]">{enrollment.student?.fullName || "—"}</td>
                                <td className="px-5 py-2.5 text-[11px] text-slate-700">
                                  <div>{enrollment.student?.phone || "—"}</div>
                                  <div className="text-slate-400">{enrollment.student?.email || "—"}</div>
                                </td>
                                <td className="px-5 py-2.5">
                                  <span
                                    className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase ${
                                      enrollment.roleInClass === "TEACHER"
                                        ? "bg-amber-50 text-amber-700 border-amber-200"
                                        : "bg-indigo-50 text-indigo-750 border-indigo-200"
                                    }`}
                                  >
                                    {enrollment.roleInClass || "STUDENT"}
                                  </span>
                                </td>
                                <td className="px-5 py-2.5 text-slate-550 font-medium text-xs">{formatDate(enrollment.joinedAt)}</td>
                                <td className="px-5 py-2.5 text-center">
                                  <button
                                    onClick={() =>
                                      setConfirmRemoveStudent({
                                        studentId: enrollment.student?.id,
                                        studentName: enrollment.student?.fullName || "Học viên",
                                      })
                                    }
                                    className="inline-flex h-7.5 px-3 items-center justify-center bg-red-50 hover:bg-red-100 text-red-650 rounded-lg text-[11px] font-semibold transition border border-red-200"
                                  >
                                    Xóa khỏi lớp
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                {/* 2. Tab SCHEDULE */}
                {activeTab === "schedule" && (
                  <div className="space-y-6">
                    <div className="flex justify-between items-center pb-4 border-b border-slate-100">
                      <div>
                        <h2 className="text-xl font-extrabold text-slate-900">Lịch Học & Danh Sách Buổi Học</h2>
                        <p className="text-slate-500 text-xs font-medium">Theo dõi lịch học, phòng học và trạng thái diễn ra</p>
                      </div>
                      <button
                        onClick={() => alert("Tính năng sắp ra mắt trong giai đoạn tiếp theo!")}
                        className="px-4 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold rounded-xl border border-indigo-200 transition"
                      >
                        + Tạo buổi học mới
                      </button>
                    </div>

                    <div className="space-y-4">
                      {generateSessions().map((session) => (
                        <div
                          key={session.id}
                          className="p-4 bg-slate-50 border border-slate-200 rounded-2xl flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 hover:shadow-sm transition"
                        >
                          <div className="space-y-1">
                            <h4 className="font-extrabold text-slate-900 text-base">{session.title}</h4>
                            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 font-semibold">
                              <span className="flex items-center gap-1">
                                <svg className="w-4 h-4 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                </svg>
                                {session.date}
                              </span>
                              <span className="flex items-center gap-1">
                                <svg className="w-4 h-4 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                {session.time}
                              </span>
                              <span className="flex items-center gap-1">
                                <svg className="w-4 h-4 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                                </svg>
                                {session.room}
                              </span>
                            </div>
                          </div>

                          <span
                            className={`px-3 py-1 rounded-full text-xs font-bold uppercase border whitespace-nowrap ${
                              session.status === "COMPLETED"
                                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                : session.status === "SCHEDULED"
                                ? "bg-sky-50 text-sky-700 border-sky-200 animate-pulse"
                                : "bg-slate-100 text-slate-500 border-slate-350"
                            }`}
                          >
                            {session.status === "COMPLETED" ? "Đã học" : session.status === "SCHEDULED" ? "Sắp học" : "Chưa học"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 3. Tab ASSIGNMENTS */}
                {activeTab === "assignments" && (
                  <div className="space-y-6">
                    <div className="flex justify-between items-center pb-4 border-b border-slate-100">
                      <div>
                        <h2 className="text-xl font-extrabold text-slate-900">Bài Tập & Đề Thi Thử</h2>
                        <p className="text-slate-500 text-xs font-medium">Giao bài tập về nhà, đề luyện thi và kiểm tra tiến độ</p>
                      </div>
                      <button
                        onClick={() => alert("Tính năng sắp ra mắt trong giai đoạn tiếp theo!")}
                        className="px-4 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold rounded-xl border border-indigo-200 transition"
                      >
                        + Giao bài tập mới
                      </button>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="border-b border-slate-200 bg-slate-50/50">
                            <th className="px-5 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">Tên bài viết/đề thi</th>
                            <th className="px-5 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">Phân loại</th>
                            <th className="px-5 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-500 text-center">Trạng thái</th>
                            <th className="px-5 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-500 text-center">Bài nộp</th>
                            <th className="px-5 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-500 text-center">Thao tác</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {generateAssignments().map((item) => (
                            <tr key={item.id} className="hover:bg-slate-50/30 transition">
                              <td className="px-5 py-2.5 font-bold text-slate-800 text-[12px]">{item.title}</td>
                              <td className="px-5 py-2.5">
                                <span
                                  className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase ${
                                    item.type === "EXAM" ? "bg-red-50 text-red-700 border-red-200" : "bg-emerald-50 text-emerald-700 border-emerald-200"
                                  }`}
                                >
                                  {item.type === "EXAM" ? "Bài kiểm tra" : "Bài tập"}
                                </span>
                              </td>
                              <td className="px-5 py-2.5 text-center">
                                <span
                                  className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase ${
                                    item.status === "Đang mở"
                                      ? "bg-sky-50 text-sky-700 border-sky-200"
                                      : "bg-slate-100 text-slate-500 border-slate-350"
                                  }`}
                                >
                                  {item.status}
                                </span>
                              </td>
                              <td className="px-5 py-2.5 text-center font-bold text-indigo-600 text-[12px]">{item.score}</td>
                              <td className="px-5 py-2.5 text-center">
                                <button
                                  onClick={() => alert("Mở đề chi tiết...")}
                                  className="inline-flex h-7.5 px-3 items-center justify-center bg-slate-50 hover:bg-slate-100 text-slate-650 rounded-lg text-[11px] font-semibold border border-slate-200 transition"
                                >
                                  Xem chi tiết
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}


              </div>
            </div>
          </div>
        )}
      </div>

      {/* Add Student Modal */}
      {showAddStudent && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="w-full max-w-md bg-white border border-slate-105 p-6 rounded-2xl shadow-xl relative text-slate-800 animate-in zoom-in-95 duration-200">
            <h3 className="text-lg font-bold mb-1 text-slate-900">
              Thêm Học Viên Vào Lớp
            </h3>
            <p className="text-slate-500 text-xs mb-5 font-medium">
              Lớp: <strong className="text-slate-800">{classDetail?.title}</strong>
            </p>
            <form onSubmit={handleAddStudent} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Chọn học viên *</label>
                <select
                  value={selectedStudentId}
                  onChange={(e) => setSelectedStudentId(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:bg-white focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 text-sm transition-all duration-150"
                  required
                >
                  <option value="">-- Chọn học viên từ hệ thống --</option>
                  {selectableStudents.map((student) => (
                    <option key={student.id} value={student.id}>
                      {student.fullName} ({student.email || student.phone || "Không có liên hệ"})
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Vai trò trong lớp</label>
                  <select
                    value={roleInClass}
                    onChange={(e) => setRoleInClass(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:bg-white focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 text-sm transition-all duration-150"
                  >
                    <option value="STUDENT">Học viên (STUDENT)</option>
                    <option value="TEACHER">Giáo viên (TEACHER)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Ngày tham gia</label>
                  <input
                    type="date"
                    value={joinedAt}
                    onChange={(e) => setJoinedAt(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:bg-white focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 text-sm transition-all duration-150"
                    required
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2.5 pt-4 mt-6 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddStudent(false)}
                  className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition shadow-sm cursor-pointer"
                >
                  Thêm vào lớp
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirm Remove Student Modal */}
      {confirmRemoveStudent && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-[60] animate-in fade-in duration-200">
          <div className="w-full max-w-md bg-white border border-slate-105 p-6 rounded-2xl shadow-xl relative text-slate-800 animate-in zoom-in-95 duration-200">
            <h3 className="text-lg font-bold text-red-650 mb-2">
              Xác Nhận Xóa Học Viên
            </h3>
            <p className="text-slate-600 text-sm mb-6 font-medium leading-relaxed">
              Bạn có chắc chắn muốn xóa học viên <strong>{confirmRemoveStudent.studentName}</strong> khỏi lớp này?
            </p>
            <div className="flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setConfirmRemoveStudent(null)}
                className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={executeRemoveStudent}
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
