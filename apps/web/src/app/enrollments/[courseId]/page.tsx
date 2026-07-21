'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import React, { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import Navbar from '../../../components/Navbar';

const roleLabels: Record<string, string> = {
  HOMEROOM_TEACHER: 'Chủ nhiệm',
  CLASS_LEADER: 'Lớp trưởng',
  ASSISTANT: 'Trợ giảng',
  STUDENT: 'Học viên',
};

export default function EnrollmentDetailPage() {
  const params = useParams<{ courseId: string }>();
  const courseId = Number(params.courseId);

  const [course, setCourse] = useState<any>(null);
  const [enrollments, setEnrollments] = useState<any[]>([]);
  const [students, setStudents] = useState<any[]>([]);
  const [activeClasses, setActiveClasses] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [showAdd, setShowAdd] = useState(false);
  const [editingEnrollment, setEditingEnrollment] = useState<any>(null);
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [studentQuery, setStudentQuery] = useState('');
  const [roleInCourse, setRoleInCourse] = useState('STUDENT');
  const [joinedAt, setJoinedAt] = useState(new Date().toISOString().substring(0, 10));
  const [endDate, setEndDate] = useState('');

  useEffect(() => {
    if (!Number.isNaN(courseId)) {
      fetchData();
    }
  }, [courseId]);

  const fetchData = async () => {
    setLoading(true);
    setError('');
    try {
      const [courseRes, enrollmentsRes, studentsRes, classesRes] =
        await Promise.all([
          apiClient.get(`/courses/${courseId}`),
          apiClient.get('/enrollments', { params: { courseId } }),
          apiClient.get('/students'),
          apiClient.get(`/courses/${courseId}/classes`),
        ]);

      setCourse(courseRes.data);
      setEnrollments(enrollmentsRes.data);
      setStudents(studentsRes.data);
      setActiveClasses(
        (Array.isArray(classesRes.data) ? classesRes.data : []).filter(
          (cls: any) => String(cls.status) === 'ACTIVE',
        ),
      );
    } catch (err: any) {
      setError(err.response?.data?.message || 'Không thể tải chi tiết lớp học');
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return '';
    return date.toLocaleDateString('vi-VN');
  };

  const toInputDate = (dateStr: string | null) => (dateStr ? dateStr.substring(0, 10) : '');
  const existingStudentIds = new Set(enrollments.map((enrollment) => String(enrollment.userId)));

  const filteredStudents = students.filter((student) => {
    const label = `${student.fullName} ${student.phone || ''} ${student.email || ''}`.toLowerCase();
    return label.includes(studentQuery.toLowerCase()) && !existingStudentIds.has(String(student.id));
  });

  const selectableStudentIds = filteredStudents.map((student) => String(student.id));
  const allFilteredStudentsSelected =
    selectableStudentIds.length > 0 && selectableStudentIds.every((studentId) => selectedStudentIds.includes(studentId));

  const homeroomTeacher = enrollments.find((enrollment) => enrollment.roleInCourse === 'HOMEROOM_TEACHER');
  const classLeader = enrollments.find((enrollment) => enrollment.roleInCourse === 'CLASS_LEADER');
  const studentCount = enrollments.filter((enrollment) => enrollment.roleInCourse === 'STUDENT').length;

  const toggleStudentSelection = (studentId: string) => {
    setSelectedStudentIds((current) =>
      current.includes(studentId) ? current.filter((id) => id !== studentId) : [...current, studentId],
    );
  };

  const toggleFilteredStudentsSelection = () => {
    setSelectedStudentIds((current) => {
      if (allFilteredStudentsSelected) {
        return current.filter((studentId) => !selectableStudentIds.includes(studentId));
      }

      return Array.from(new Set([...current, ...selectableStudentIds]));
    });
  };

  const openAddModal = () => {
    setSelectedStudentIds([]);
    setStudentQuery('');
    setRoleInCourse('STUDENT');
    setJoinedAt(new Date().toISOString().substring(0, 10));
    setEndDate(toInputDate(course?.endDate || null));
    setShowAdd(true);
  };

  const openEditModal = (enrollment: any) => {
    setEditingEnrollment(enrollment);
    setRoleInCourse(enrollment.roleInCourse || 'STUDENT');
    setJoinedAt(toInputDate(enrollment.joinedAt));
    setEndDate(toInputDate(enrollment.endedAt));
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');

    if (selectedStudentIds.length === 0) {
      setError('Vui lòng chọn ít nhất một người để ghi danh vào khóa');
      return;
    }

    try {
      // Mỗi request ghi danh 1 học viên vào TẤT CẢ lớp ACTIVE của khóa;
      // response per-class { enrolled[], skippedExisting[] }.
      const results = await Promise.allSettled(
        selectedStudentIds.map((studentId) =>
          apiClient.post('/enrollments', {
            userId: parseInt(studentId, 10),
            courseId,
            roleInCourse,
            joinedAt: joinedAt || undefined,
            endDate: endDate || undefined,
          }),
        ),
      );

      const failedCount = results.filter((result) => result.status === 'rejected').length;
      const enrolledClassCount = results.reduce((sum, result) => {
        if (result.status !== 'fulfilled') return sum;
        const enrolled = (result.value?.data as any)?.enrolled;
        return sum + (Array.isArray(enrolled) ? enrolled.length : 0);
      }, 0);
      if (failedCount > 0) {
        setError(
          `Đã ghi danh ${results.length - failedCount}/${results.length} người. Một số người bị lỗi hoặc đã có mặt ở tất cả lớp của khóa.`,
        );
      } else {
        setNotice(
          `Đã ghi danh ${results.length} học viên vào khóa — tạo ${enrolledClassCount} lượt vào lớp (tất cả lớp đang hoạt động).`,
        );
      }

      setShowAdd(false);
      setSelectedStudentIds([]);
      await fetchData();
    } catch (err: any) {
      const msg = err.response?.data?.message || 'Lỗi ghi danh học viên vào khóa';
      setError(Array.isArray(msg) ? msg[0] : msg);
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingEnrollment) return;

    setError('');
    try {
      await apiClient.patch(`/enrollments/${editingEnrollment.id}`, {
        roleInCourse,
        joinedAt,
        endDate: endDate || undefined,
      });

      setEditingEnrollment(null);
      await fetchData();
    } catch (err: any) {
      const msg = err.response?.data?.message || 'Không thể cập nhật thành viên lớp';
      setError(Array.isArray(msg) ? msg[0] : msg);
    }
  };

  const handleDelete = async (enrollment: any) => {
    if (!window.confirm(`Xóa "${enrollment.user.fullName}" khỏi lớp này?`)) {
      return;
    }

    setError('');
    try {
      await apiClient.delete(`/enrollments/${enrollment.id}`);
      await fetchData();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Không thể xóa khỏi lớp');
    }
  };

  return (
    <div className="bg-slate-50 min-h-screen text-slate-800 font-sans flex flex-col">
      <Navbar />

      <div className="p-8 max-w-7xl w-full mx-auto flex-1">
        <div className="mb-5">
          <Link href="/enrollments" className="text-sm font-semibold text-indigo-600 hover:text-indigo-500">
            Quay lại danh sách lớp
          </Link>
        </div>

        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-200 pb-6 mb-8">
          <div>
            <div className="text-xs font-bold text-indigo-600 font-mono">{course?.courseCode || '...'}</div>
            <h1 className="text-4xl font-extrabold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
              {course?.title || 'Chi tiết lớp học'}
            </h1>
            <p className="text-slate-500 text-sm mt-1 font-medium">
              {formatDate(course?.startDate) || 'Chưa có ngày bắt đầu'} - {formatDate(course?.endDate) || 'Chưa có ngày kết thúc'}
            </p>
          </div>
          <button
            onClick={openAddModal}
            disabled={!course}
            className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-xl shadow-md shadow-indigo-200 transition duration-200 disabled:opacity-50"
          >
            Ghi Danh Vào Khóa
          </button>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
            {error}
          </div>
        )}

        {notice && (
          <div className="mb-6 p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-700 text-sm">
            {notice}
          </div>
        )}

        {loading ? (
          <div className="p-12 flex justify-center">
            <span className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></span>
          </div>
        ) : (
          <section className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="p-6 border-b border-slate-200 bg-slate-50/70">
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                <Summary label="Chủ nhiệm" value={homeroomTeacher?.user.fullName || 'Chưa có'} />
                <Summary label="Lớp trưởng" value={classLeader?.user.fullName || 'Chưa có'} />
                <Summary label="Học viên" value={String(studentCount)} />
                <Summary label="Tổng thành viên" value={String(enrollments.length)} />
              </div>
            </div>

            {enrollments.length === 0 ? (
              <div className="p-10 text-center text-slate-400 font-medium">
                Khóa này chưa có thành viên. Bấm “Ghi Danh Vào Khóa” — học viên sẽ được thêm vào tất cả lớp đang hoạt động.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-white">
                      <th className="px-6 py-4 text-xs font-semibold uppercase text-slate-500">Thành viên</th>
                      <th className="px-6 py-4 text-xs font-semibold uppercase text-slate-500">Liên hệ</th>
                      <th className="px-6 py-4 text-xs font-semibold uppercase text-slate-500">Lớp</th>
                      <th className="px-6 py-4 text-xs font-semibold uppercase text-slate-500">Vai trò</th>
                      <th className="px-6 py-4 text-xs font-semibold uppercase text-slate-500">Ngày tham gia</th>
                      <th className="px-6 py-4 text-xs font-semibold uppercase text-slate-500">Ngày kết thúc</th>
                      <th className="px-6 py-4 text-xs font-semibold uppercase text-slate-500 text-center">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {enrollments.map((enrollment) => (
                      <tr key={enrollment.id} className="hover:bg-slate-50/70 transition">
                        <td className="px-6 py-4 font-bold text-slate-900">{enrollment.user.fullName}</td>
                        <td className="px-6 py-4 text-sm text-slate-700">
                          <div className="font-medium">{enrollment.user.phone || '—'}</div>
                          <div className="text-xs text-slate-500">{enrollment.user.email || 'Không có email'}</div>
                        </td>
                        <td className="px-6 py-4 text-sm text-slate-700 font-medium">
                          {enrollment.className || `#${enrollment.classId || '—'}`}
                        </td>
                        <td className="px-6 py-4">
                          <span className="inline-flex h-8 items-center px-3 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 text-xs font-bold">
                            {roleLabels[enrollment.roleInCourse] || enrollment.roleInCourse}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-slate-700 font-medium">{formatDate(enrollment.joinedAt) || '—'}</td>
                        <td className="px-6 py-4 text-slate-700 font-medium">{formatDate(enrollment.endedAt) || '—'}</td>
                        <td className="px-6 py-4">
                          <div className="flex justify-center gap-2">
                            <button
                              onClick={() => openEditModal(enrollment)}
                              className="inline-flex h-10 w-20 items-center justify-center rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700 text-xs font-semibold hover:bg-indigo-100 transition"
                            >
                              Sửa
                            </button>
                            <button
                              onClick={() => handleDelete(enrollment)}
                              className="inline-flex h-10 w-20 items-center justify-center rounded-lg border border-red-200 bg-red-50 text-red-700 text-xs font-semibold hover:bg-red-100 transition"
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
          </section>
        )}
      </div>

      {showAdd && (
        <MemberModal
          title="Ghi danh học viên vào khóa"
          submitLabel={`Ghi danh ${selectedStudentIds.length > 0 ? `(${selectedStudentIds.length})` : ''}`}
          onSubmit={handleCreate}
          onClose={() => setShowAdd(false)}
          roleInCourse={roleInCourse}
          setRoleInCourse={setRoleInCourse}
          joinedAt={joinedAt}
          setJoinedAt={setJoinedAt}
          endDate={endDate}
          setEndDate={setEndDate}
        >
          <div className={activeClasses.length ? 'p-3 bg-indigo-50/60 border border-indigo-100 rounded-xl' : 'p-3 bg-amber-50 border border-amber-200 rounded-xl'}>
            {activeClasses.length ? (
              <>
                <div className="text-xs font-bold text-indigo-700 mb-1.5">
                  Học viên sẽ được thêm vào TẤT CẢ {activeClasses.length} lớp đang hoạt động của khóa:
                </div>
                <ul className="space-y-0.5 text-xs text-slate-700 font-medium">
                  {activeClasses.map((cls: any) => (
                    <li key={cls.id}>
                      • {cls.title || cls.classCode || `Lớp #${cls.id}`}
                      {cls.classCode && cls.title ? (
                        <span className="text-slate-400 font-mono"> ({cls.classCode})</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
                <div className="mt-1.5 text-[11px] text-slate-500">
                  Lớp mở thêm sau này trong khóa sẽ TỰ ĐỘNG có toàn bộ học viên của khóa.
                </div>
              </>
            ) : (
              <div className="text-xs font-semibold text-amber-800">
                Khóa này chưa có lớp đang hoạt động — cần tạo lớp trước khi ghi danh học viên.
              </div>
            )}
          </div>
          <div>
            <div className="flex items-center justify-between gap-3 mb-1.5">
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">Chọn thành viên *</label>
              <span className="text-xs font-semibold text-indigo-600">Đã chọn {selectedStudentIds.length}</span>
            </div>
            <input
              type="text"
              placeholder="Tìm theo tên, sđt hoặc email..."
              value={studentQuery}
              onChange={(e) => setStudentQuery(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 mb-2 text-sm transition-all duration-150"
            />
            {selectableStudentIds.length > 0 && (
              <button type="button" onClick={toggleFilteredStudentsSelection} className="mb-2 text-xs font-semibold text-indigo-600 hover:text-indigo-500">
                {allFilteredStudentsSelected ? 'Bỏ chọn kết quả đang lọc' : 'Chọn tất cả kết quả đang lọc'}
              </button>
            )}
            <div className="border border-slate-200 rounded-xl max-h-44 overflow-y-auto divide-y divide-slate-100 bg-white">
              {filteredStudents.length === 0 ? (
                <div className="p-3 text-slate-400 text-xs text-center">Không còn học viên phù hợp để thêm vào lớp</div>
              ) : (
                filteredStudents.map((student) => {
                  const studentId = String(student.id);
                  const isSelected = selectedStudentIds.includes(studentId);

                  return (
                    <label key={student.id} className={`flex items-center gap-3 p-2.5 hover:bg-slate-50 cursor-pointer text-sm ${isSelected ? 'bg-indigo-50/50 font-semibold text-indigo-700' : ''}`}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleStudentSelection(studentId)}
                        className="text-indigo-600 focus:ring-indigo-500 h-4 w-4 border-slate-300"
                      />
                      <div>
                        <div>{student.fullName}</div>
                        <div className="text-[10px] text-slate-400 font-normal">SĐT: {student.phone || '—'} | Email: {student.email || '—'}</div>
                      </div>
                    </label>
                  );
                })
              )}
            </div>
          </div>
        </MemberModal>
      )}

      {editingEnrollment && (
        <MemberModal
          title={`Sửa ${editingEnrollment.user.fullName}`}
          submitLabel="Cập nhật"
          onSubmit={handleUpdate}
          onClose={() => setEditingEnrollment(null)}
          roleInCourse={roleInCourse}
          setRoleInCourse={setRoleInCourse}
          joinedAt={joinedAt}
          setJoinedAt={setJoinedAt}
          endDate={endDate}
          setEndDate={setEndDate}
        />
      )}
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl px-4 py-3">
      <div className="text-[11px] uppercase font-bold text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-extrabold text-slate-900 truncate">{value}</div>
    </div>
  );
}

function MemberModal({
  title,
  submitLabel,
  children,
  onSubmit,
  onClose,
  roleInCourse,
  setRoleInCourse,
  joinedAt,
  setJoinedAt,
  endDate,
  setEndDate,
}: {
  title: string;
  submitLabel: string;
  children?: React.ReactNode;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
  roleInCourse: string;
  setRoleInCourse: (value: string) => void;
  joinedAt: string;
  setJoinedAt: (value: string) => void;
  endDate: string;
  setEndDate: (value: string) => void;
}) {
  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
      <div className="w-full max-w-xl bg-white border border-slate-105 p-6 rounded-2xl shadow-xl relative text-slate-800 animate-in zoom-in-95 duration-200">
        <h3 className="text-lg font-bold mb-4 text-slate-900">
          {title}
        </h3>
        <form onSubmit={onSubmit} className="space-y-4">
          {children}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Vai trò</label>
              <select
                value={roleInCourse}
                onChange={(e) => setRoleInCourse(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:bg-white focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 text-sm transition-all duration-150"
              >
                <option value="HOMEROOM_TEACHER">Chủ nhiệm</option>
                <option value="CLASS_LEADER">Lớp trưởng</option>
                <option value="STUDENT">Học viên</option>
                <option value="ASSISTANT">Trợ giảng</option>
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
          <div className="flex justify-end gap-2.5 pt-4 mt-6 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition cursor-pointer"
            >
              Hủy
            </button>
            <button
              type="submit"
              className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition shadow-sm cursor-pointer"
            >
              {submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
