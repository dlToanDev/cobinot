'use client';

import React, { useState } from 'react';
import { apiClient } from '@/lib/api-client';

export default function LoginPage() {
  const [email, setEmail] = useState('admin@hxstu.edu.vn');
  const [password, setPassword] = useState('admin123');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await apiClient.post('/auth/login', {
        email,
        password,
      });

      const { accessToken, user } = response.data;
      
      // Store token and user details in localStorage
      localStorage.setItem('accessToken', accessToken);
      localStorage.setItem('user', JSON.stringify(user));

      // Redirect to dashboard
      window.location.href = '/dashboard';
    } catch (err: any) {
      const msg = err.response?.data?.message || 'Có lỗi xảy ra, vui lòng thử lại';
      setError(Array.isArray(msg) ? msg[0] : msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-800 font-sans">
      <div className="w-full max-w-md p-8 bg-white border border-slate-200 rounded-2xl shadow-xl relative overflow-hidden">
        {/* Decorative background glow */}
        <div className="absolute -top-16 -left-16 w-32 h-32 bg-indigo-500 rounded-full blur-3xl opacity-20"></div>
        <div className="absolute -bottom-16 -right-16 w-32 h-32 bg-purple-500 rounded-full blur-3xl opacity-20"></div>

        <h2 className="text-3xl font-extrabold mb-2 text-center bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
          DLT Center
        </h2>
        <p className="text-slate-500 text-center text-sm mb-8 font-medium">
          Đăng nhập hệ thống quản lý đào tạo tích hợp xiuuu
        </p>

        {error && (
          <div className="mb-6 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}

        <form className="space-y-6" onSubmit={handleLogin}>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
              Địa chỉ Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="block w-full px-4 py-3 bg-white border border-slate-300 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 transition duration-200"
              placeholder="admin@hxstu.edu.vn"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
              Mật khẩu
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="block w-full px-4 py-3 bg-white border border-slate-300 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 transition duration-200"
              placeholder="••••••••"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 px-4 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-semibold rounded-xl shadow-md shadow-indigo-200 hover:shadow-indigo-300 transition-all duration-300 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? (
              <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
            ) : (
              'Đăng Nhập'
            )}
          </button>
        </form>

        <div className="mt-8 pt-6 border-t border-slate-200 text-center text-xs text-slate-500 font-medium">
          Tài khoản dùng thử: <strong className="text-slate-700">admin@hxstu.edu.vn</strong> / <strong className="text-slate-700">admin123</strong>
        </div>
      </div>
    </div>
  );
}
