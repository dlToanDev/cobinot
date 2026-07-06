'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { clearCopilotActiveSession } from '@/lib/copilot-session-storage';

type NavUser = {
  fullName?: string;
  role?: string;
};

export default function Navbar() {
  const pathname = usePathname();
  const [user, setUser] = useState<NavUser | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const storedUser = localStorage.getItem('user');
      if (!storedUser) return;

      try {
        setUser(JSON.parse(storedUser) as NavUser);
      } catch {
        setUser(null);
      }
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('user');
    clearCopilotActiveSession();
    window.location.href = '/login';
  };

  const navItems = [
    { label: 'Dashboard', path: '/dashboard' },
    { label: 'Học Viên', path: '/students' },
    { label: 'Khóa Học', path: '/courses' },
    { label: 'Trợ lý AI', path: '/copilot' },
  ];

  return (
    <nav className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3 font-sans text-slate-800">
      <div className="flex items-center gap-8">
        <Link href="/dashboard" className="text-xl font-semibold text-slate-950">
          DLT Center
        </Link>
        <div className="flex gap-4">
          {navItems.map((item) => {
            const isActive = pathname.startsWith(item.path);
            return (
              <Link
                key={item.path}
                href={item.path}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition duration-200 ${
                  isActive
                    ? 'bg-slate-950 text-white'
                    : 'text-slate-500 hover:bg-slate-100 hover:text-slate-950'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-4">
        {user && (
          <div className="text-right hidden md:block">
            <div className="text-xs text-slate-500 font-semibold">{user.role}</div>
            <div className="text-sm text-slate-800 font-bold">{user.fullName}</div>
          </div>
        )}
        <button
          onClick={handleLogout}
          className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 hover:text-slate-900 px-3 py-1.5 rounded-lg transition duration-200 font-medium border border-slate-200"
        >
          Đăng xuất
        </button>
      </div>
    </nav>
  );
}
