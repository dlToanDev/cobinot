'use client';

import React, { useEffect, useState } from 'react';
import Navbar from '../../components/Navbar';

export default function DashboardPage() {
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (storedUser) {
      setUser(JSON.parse(storedUser));
    } else {
      window.location.href = '/login';
    }
  }, []);

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-800">
        <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="bg-slate-50 min-h-screen text-slate-800 font-sans flex flex-col">
      <Navbar />

      <div className="p-8 max-w-6xl w-full mx-auto flex-1">
        <div className="border-b border-slate-250 pb-6 mb-8">
          <h1 className="text-4xl font-extrabold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
            Dashboard Tổng Quan
          </h1>
          <p className="text-slate-500 text-sm mt-1 font-medium">
            Hệ thống quản lý đào tạo DLT Center - {user.role} Portal
          </p>
        </div>

        {/* Admin Card */}
        <div className="p-6 bg-white border border-slate-200 rounded-2xl mb-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shadow-sm">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Người vận hành</div>
            <div className="text-2xl font-bold mt-1 text-slate-800">{user.fullName}</div>
            <div className="text-slate-500 text-sm mt-1">{user.email}</div>
          </div>
          <div className="flex gap-4">
            <div className="px-4 py-2 bg-indigo-50 border border-indigo-200 rounded-xl">
              <span className="text-xs block text-indigo-600 font-semibold uppercase">Vai trò</span>
              <span className="font-bold text-indigo-950 text-sm">{user.role}</span>
            </div>
            <div className="px-4 py-2 bg-purple-50 border border-purple-200 rounded-xl">
              <span className="text-xs block text-purple-600 font-semibold uppercase">Tenant ID</span>
              <span className="font-bold text-purple-950 text-sm">#{user.tenantId}</span>
            </div>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="p-6 bg-white border border-slate-200 rounded-2xl relative overflow-hidden shadow-sm">
            <div className="text-sm font-semibold text-slate-400">Tổng học viên</div>
            <div className="text-4xl font-extrabold mt-3 text-slate-800">6</div>
            <div className="text-xs text-green-600 mt-2 font-medium">● Đang hoạt động</div>
          </div>
          <div className="p-6 bg-white border border-slate-200 rounded-2xl relative overflow-hidden shadow-sm">
            <div className="text-sm font-semibold text-slate-400">Tổng khóa học</div>
            <div className="text-4xl font-extrabold mt-3 text-slate-800">5</div>
            <div className="text-xs text-green-600 mt-2 font-medium">● Đang hoạt động</div>
          </div>
          <div className="p-6 bg-white border border-slate-200 rounded-2xl relative overflow-hidden shadow-sm">
            <div className="text-sm font-semibold text-slate-400">xiuuu</div>
            <div className="text-4xl font-extrabold mt-3 text-indigo-600">ONLINE</div>
            <div className="text-xs text-indigo-600 mt-2 font-medium">● Trợ lý AI đang sẵn sàng</div>
          </div>
          <div className="p-6 bg-white border border-slate-200 rounded-2xl relative overflow-hidden shadow-sm">
            <div className="text-sm font-semibold text-slate-400">Database Connection</div>
            <div className="text-4xl font-extrabold mt-3 text-green-600 font-mono">READY</div>
            <div className="text-xs text-green-600 mt-2 font-medium">● PostgreSQL v15 via Port 5435</div>
          </div>
        </div>
      </div>
    </div>
  );
}
