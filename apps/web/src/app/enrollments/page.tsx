'use client';

import Link from 'next/link';
import React, { useEffect, useMemo, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import Navbar from '../../components/Navbar';

export default function EnrollmentsPage() {
  const [enrollments, setEnrollments] = useState<any[]>([]);
  const [courses, setCourses] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    setError('');
    try {
      const [coursesRes, enrollmentsRes] = await Promise.all([
        apiClient.get('/courses'),
        apiClient.get('/enrollments'),
      ]);

      setCourses(coursesRes.data);
      setEnrollments(enrollmentsRes.data);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Không thể tải danh sách lớp học');
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

  const getCourseEnrollments = (courseId: number) =>
    enrollments.filter((enrollment) => enrollment.courseId === courseId);

  const visibleCourses = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return courses;

    return courses.filter((course) => {
      const courseText = `${course.title} ${course.courseCode}`.toLowerCase();
      const membersText = getCourseEnrollments(course.id)
        .map((enrollment) => `${enrollment.user.fullName} ${enrollment.user.phone || ''} ${enrollment.user.email || ''}`)
        .join(' ')
        .toLowerCase();

      return courseText.includes(keyword) || membersText.includes(keyword);
    });
  }, [courses, enrollments, search]);

  return (
    <div className="bg-slate-50 min-h-screen text-slate-800 font-sans flex flex-col">
      <Navbar />

      <div className="p-8 max-w-7xl w-full mx-auto flex-1">
        <div className="border-b border-slate-200 pb-6 mb-8">
          <h1 className="text-4xl font-extrabold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
            Quản Lý Lớp Học
          </h1>
          <p className="text-slate-500 text-sm mt-1 font-medium">
            Chọn một lớp để vào trang chi tiết và quản lý chủ nhiệm, lớp trưởng, học viên
          </p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
            {error}
          </div>
        )}

        <div className="mb-6">
          <input
            type="text"
            placeholder="Tìm lớp, mã khóa học hoặc học viên..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full px-4 py-3 bg-white border border-slate-300 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 transition duration-200 shadow-sm"
          />
        </div>

        {loading ? (
          <div className="p-12 flex justify-center">
            <span className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></span>
          </div>
        ) : visibleCourses.length === 0 ? (
          <div className="p-10 text-center bg-white border border-slate-200 rounded-2xl text-slate-400 font-medium">
            Không tìm thấy lớp học nào.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {visibleCourses.map((course) => {
              const courseEnrollments = getCourseEnrollments(course.id);
              const teacher = courseEnrollments.find((item) => item.roleInCourse === 'HOMEROOM_TEACHER');
              const leader = courseEnrollments.find((item) => item.roleInCourse === 'CLASS_LEADER');

              return (
                <Link
                  key={course.id}
                  href={`/enrollments/${course.id}`}
                  className="block bg-white border border-slate-200 rounded-2xl p-5 shadow-sm hover:shadow-md hover:border-indigo-400 transition duration-200"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xs font-bold text-indigo-600 font-mono">{course.courseCode}</div>
                      <h2 className="mt-1 text-lg font-extrabold text-slate-900 leading-tight">{course.title}</h2>
                    </div>
                    <span
                      className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-bold border ${
                        course.status === 'ACTIVE'
                          ? 'bg-green-50 text-green-700 border-green-200'
                          : 'bg-red-50 text-red-700 border-red-200'
                      }`}
                    >
                      {course.status === 'ACTIVE' ? 'Hoạt động' : 'Đã đóng'}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 mt-5">
                    <StatBox label="Thành viên" value={courseEnrollments.length} />
                    <StatBox label="Chủ nhiệm" value={teacher ? 1 : 0} />
                    <StatBox label="Lớp trưởng" value={leader ? 1 : 0} />
                  </div>

                  <div className="mt-4 space-y-1 text-sm text-slate-600">
                    <div>Chủ nhiệm: <span className="font-semibold text-slate-800">{teacher?.user.fullName || 'Chưa chọn'}</span></div>
                    <div>Lớp trưởng: <span className="font-semibold text-slate-800">{leader?.user.fullName || 'Chưa chọn'}</span></div>
                    <div>Thời gian: {formatDate(course.startDate) || '—'} - {formatDate(course.endDate) || '—'}</div>
                  </div>

                  <div className="mt-4 inline-flex h-9 items-center px-3 rounded-lg bg-indigo-50 text-indigo-700 border border-indigo-200 text-xs font-bold">
                    Xem chi tiết
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
      <div className="text-xl font-extrabold text-slate-900">{value}</div>
      <div className="text-[11px] font-semibold text-slate-500">{label}</div>
    </div>
  );
}
