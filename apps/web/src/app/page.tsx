'use client';

import { useEffect } from 'react';

export default function RootPage() {
  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (token) {
      window.location.href = '/dashboard';
    } else {
      window.location.href = '/login';
    }
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 text-white">
      <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
    </div>
  );
}
