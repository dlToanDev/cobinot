'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  LoaderCircle,
  MessageSquare,
  Pencil,
  Plus,
  Trash2,
  XCircle,
  ArrowRight,
} from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { setActiveCopilotSessionId } from '@/lib/copilot-session-storage';
import Navbar from '../../../components/Navbar';

type CopilotSession = {
  id: number;
  title?: string | null;
  status: string;
  updatedAt: string;
  state?: {
    pending_action?: unknown;
  } | null;
};

function getErrorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const response = (
      err as { response?: { data?: { message?: string | string[] } } }
    ).response;
    const message = response?.data?.message;
    if (message) {
      return Array.isArray(message) ? message.join(', ') : String(message);
    }
  }
  return fallback;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function CopilotSessionsPage() {
  const router = useRouter();
  const [sessions, setSessions] = useState<CopilotSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // id của phiên đang thực hiện thao tác (đóng/xóa) để disable đúng nút.
  const [busyId, setBusyId] = useState<number | null>(null);

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiClient.get('/copilot/sessions');
      setSessions((res.data as CopilotSession[]) || []);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Không thể tải danh sách phiên chat'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchSessions();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchSessions]);

  const openSession = useCallback(
    (id: number) => {
      // Trang /copilot đọc active session từ localStorage khi mount.
      setActiveCopilotSessionId(id);
      router.push('/copilot');
    },
    [router],
  );

  const createSession = useCallback(async () => {
    setBusyId(-1);
    setError('');
    try {
      const res = await apiClient.post('/copilot/sessions', {});
      const session = res.data as CopilotSession;
      setActiveCopilotSessionId(session.id);
      router.push('/copilot');
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Không thể tạo cuộc trò chuyện mới'));
      setBusyId(null);
    }
  }, [router]);

  const closeSession = useCallback(async (id: number) => {
    setBusyId(id);
    setError('');
    try {
      await apiClient.patch(`/copilot/sessions/${id}/close`);
      setSessions((current) =>
        current.map((session) =>
          session.id === id
            ? { ...session, status: 'CLOSED', state: null }
            : session,
        ),
      );
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Không thể đóng phiên chat'));
    } finally {
      setBusyId(null);
    }
  }, []);

  const renameSession = useCallback(async (session: CopilotSession) => {
    const nextTitle =
      typeof window !== 'undefined'
        ? window.prompt('Tên mới cho phiên chat:', session.title || '')
        : null;
    if (nextTitle === null) return; // user bấm Hủy
    const trimmed = nextTitle.trim();
    if (!trimmed || trimmed === session.title) return;

    setBusyId(session.id);
    setError('');
    try {
      const res = await apiClient.patch(
        `/copilot/sessions/${session.id}/title`,
        { title: trimmed },
      );
      const updated = res.data as CopilotSession;
      setSessions((current) =>
        current.map((item) =>
          item.id === session.id
            ? { ...item, title: updated.title ?? trimmed }
            : item,
        ),
      );
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Không thể đổi tên phiên chat'));
    } finally {
      setBusyId(null);
    }
  }, []);

  const deleteSession = useCallback(async (id: number) => {
    if (
      typeof window !== 'undefined' &&
      !window.confirm('Xóa vĩnh viễn phiên chat này? Không thể hoàn tác.')
    ) {
      return;
    }
    setBusyId(id);
    setError('');
    try {
      await apiClient.delete(`/copilot/sessions/${id}`);
      setSessions((current) => current.filter((session) => session.id !== id));
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Không thể xóa phiên chat'));
    } finally {
      setBusyId(null);
    }
  }, []);

  return (
    <div className="min-h-screen bg-slate-50">
      <Navbar />
      <div className="mx-auto max-w-3xl px-4 py-8">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              Lịch sử phiên chat
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Các cuộc trò chuyện trước đó với Copilot.
            </p>
          </div>
          <button
            type="button"
            onClick={createSession}
            disabled={busyId === -1}
            className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {busyId === -1 ? (
              <LoaderCircle size={16} className="animate-spin" />
            ) : (
              <Plus size={16} />
            )}
            Cuộc trò chuyện mới
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-slate-400">
            <LoaderCircle size={20} className="animate-spin" />
            Đang tải...
          </div>
        ) : sessions.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white py-16 text-center">
            <MessageSquare size={32} className="mx-auto mb-3 text-slate-300" />
            <p className="text-sm text-slate-500">
              Chưa có phiên chat nào. Hãy bắt đầu một cuộc trò chuyện mới.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {sessions.map((session) => {
              const isActive = session.status === 'ACTIVE';
              const hasPending = Boolean(session.state?.pending_action);
              const isBusy = busyId === session.id;
              return (
                <li
                  key={session.id}
                  className="group flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300"
                >
                  <button
                    type="button"
                    onClick={() => openSession(session.id)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                      <MessageSquare size={18} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate font-medium text-slate-900">
                          {session.title || 'Phiên chat'}
                        </span>
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                            isActive
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-slate-100 text-slate-500'
                          }`}
                        >
                          {isActive ? 'Đang mở' : 'Đã đóng'}
                        </span>
                        {hasPending && (
                          <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                            Chờ xác nhận
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-slate-400">
                        Cập nhật: {formatDateTime(session.updatedAt)}
                      </span>
                    </span>
                    <ArrowRight
                      size={16}
                      className="shrink-0 text-slate-300 transition group-hover:text-slate-500"
                    />
                  </button>

                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => renameSession(session)}
                      disabled={isBusy}
                      title="Đổi tên phiên"
                      className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Pencil size={16} />
                    </button>
                    {isActive && (
                      <button
                        type="button"
                        onClick={() => closeSession(session.id)}
                        disabled={isBusy}
                        title="Đóng phiên (hủy thao tác đang chờ)"
                        className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isBusy ? (
                          <LoaderCircle size={16} className="animate-spin" />
                        ) : (
                          <XCircle size={16} />
                        )}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => deleteSession(session.id)}
                      disabled={isBusy}
                      title="Xóa phiên"
                      className="rounded-lg p-2 text-slate-400 transition hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
