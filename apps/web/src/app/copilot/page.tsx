"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useRef,
} from "react";
import {
  AlertTriangle,
  BookOpen,
  GraduationCap,
  LoaderCircle,
  Plus,
  Search,
  Sparkles,
  UserRound,
} from "lucide-react";
import { apiClient } from "@/lib/api-client";
import {
  getActiveCopilotSessionId,
  setActiveCopilotSessionId,
} from "@/lib/copilot-session-storage";
import Navbar from "../../components/Navbar";
import EditablePreviewCard from "./EditablePreviewCard";
import StudentCreateForm from "./StudentCreateForm";
import CourseCreateForm from "./CourseCreateForm";
import {
  CopilotCandidateList,
  CopilotClarificationCard,
  CopilotComposer,
  CopilotEmptyState,
  CopilotErrorCard,
  CopilotHeader,
  CopilotMessageBubble,
  CopilotResultCard,
  CopilotSessionSidebar,
  CopilotTypingIndicator,
  type CopilotSelectionOption,
} from "./CopilotUI";
import {
  ActionInputSummary,
  ClassTableBlock,
  DeleteResultBlock,
  EnrollmentResultBlock,
  ProfileResultBlocks,
  StudentTableBlock,
  formatFieldLabel,
} from "./ResultBlocks";

type CopilotSession = {
  id: number;
  title?: string | null;
  status: string;
  updatedAt: string;
  state?: {
    pending_action?: PendingActionSnapshot;
  } | null;
};

type PendingActionSnapshot = {
  status?: string;
  display_input?: Record<string, unknown>;
  input?: Record<string, unknown>;
  tool_name?: string;
  source?: string;
  draftId?: string;
  idempotency_key?: string;
  summary?: string;
  severity?: string;
  requires_modal_confirmation?: boolean;
  confirmation_title?: string;
  confirm_label?: string;
  cancel_label?: string;
  impact?: Record<string, unknown>;
};

type CopilotMessage = {
  id: number;
  role: "assistant" | "user" | string;
  content: string;
  createdAt?: string;
};

const buildPendingPreviewMessage = (
  sessionId: number,
  pendingAction: PendingActionSnapshot,
): CopilotMessage => ({
  id: -sessionId,
  role: "assistant",
  content: JSON.stringify({
    type: "preview_card",
    status: pendingAction.status,
    title: "Kiểm tra lại yêu cầu",
    message:
      pendingAction.status === "validation_error"
        ? "Mình vẫn giữ bản nháp này. Bạn sửa các trường còn lỗi rồi xác nhận lại nhé."
        : "Mình vẫn giữ bản nháp này. Bạn kiểm tra lại rồi bấm Xác nhận nhé.",
    fields: Object.entries(
      pendingAction.display_input || pendingAction.input || {},
    ).map(([label, value]) => ({ label, value })),
    tool_name: pendingAction.tool_name,
    input: pendingAction.input || {},
    display_input: pendingAction.display_input,
    pending_action: pendingAction,
    missingFields:
      pendingAction.tool_name === "create_class" &&
      !Number(pendingAction.input?.courseId || 0)
        ? ["courseId"]
        : [],
    summary: pendingAction.summary,
    severity: pendingAction.severity,
    requires_modal_confirmation: pendingAction.requires_modal_confirmation,
    confirmation_title: pendingAction.confirmation_title,
    confirm_label: pendingAction.confirm_label,
    cancel_label: pendingAction.cancel_label,
    impact: pendingAction.impact,
  }),
});

const readStoredActiveSessionId = () => getActiveCopilotSessionId();

// Sidebar chỉ tải từng trang session; bấm "Xem thêm" mới tải trang kế.
const SESSIONS_PAGE_SIZE = 10;
// Trần limit phía backend (service clamp 50) — refresh không vượt quá mức này.
const SESSIONS_MAX_LIMIT = 50;

type CopilotSessionsResponse = {
  items: CopilotSession[];
  hasMore: boolean;
};

// Mở phiên chỉ tải ~20 tin MỚI NHẤT (memory giữ khoảng 20~50 tin vì sau mỗi
// lượt chat list reset về trang đầu). Cuộn lên đầu khung chat thì tải thêm
// từng 10 tin cũ hơn qua GET /messages?before=<id oldest>&limit=10.
const MESSAGES_INITIAL_LIMIT = 20;
const MESSAGES_OLDER_PAGE_SIZE = 10;

type CopilotMessagesResponse = {
  items: CopilotMessage[];
  hasMore: boolean;
};

const storeActiveSessionId = (sessionId: number | null) => {
  setActiveCopilotSessionId(sessionId);
};

type SuggestionOption = {
  id: number | string;
  label: string;
  entity_type?: "student" | "course" | "class" | "enrollment" | "action";
  reason?: string;
  draft_message?: string;
  action?: SuggestionAction;
  priority?: number;
  metadata?: Record<string, unknown>;
};

type SuggestionAction = {
  type: "suggestion_action";
  action: string;
  input: Record<string, unknown>;
  source?: string;
  draftId?: string;
};

type ProactiveSuggestion = {
  id: string;
  title: string;
  message: string;
  intent: string;
  draft_message: string;
  priority?: number;
  kind?:
    | "action"
    | "course_picker"
    | "class_picker"
    | "student_picker"
    | "enrollment_picker";
  options?: SuggestionOption[];
  action?: SuggestionAction;
  reason?: string;
};

type PendingConfirmation = {
  confirmation_title?: string;
  confirm_label?: string;
  cancel_label?: string;
  summary?: string;
  display_input?: Record<string, unknown>;
  input?: Record<string, unknown>;
  impact?: Record<string, unknown>;
};

type CopilotClientSnapshot = {
  sessions: CopilotSession[];
  messages: CopilotMessage[];
  activeSessionId: number | null;
  activePendingAction: PendingActionSnapshot | null;
  input: string;
  pendingConfirmation: PendingConfirmation | null;
  scrollTop: number;
};

const copilotClientSnapshot: CopilotClientSnapshot = {
  sessions: [],
  messages: [],
  activeSessionId: null,
  activePendingAction: null,
  input: "",
  pendingConfirmation: null,
  scrollTop: 0,
};

const createDraftId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `draft-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const EMPTY_DRAFT_INPUTS: Record<string, Record<string, unknown>> = {
  create_student: {
    fullName: "",
    email: "",
    phone: "",
    birthDate: "",
    address: "",
  },
  create_course: {
    title: "",
    courseCode: "",
    level: "",
    description: "",
  },
  create_class: {
    courseId: "",
    courseTitle: "",
    title: "",
    classCode: "",
    classType: "",
    teacherName: "",
    description: "",
    startDate: "",
    endDate: "",
  },
};

function getErrorMessage(err: unknown, fallback: string) {
  if (err && typeof err === "object" && "response" in err) {
    const response = (err as { response?: { data?: { message?: string } } })
      .response;
    return response?.data?.message || fallback;
  }

  return fallback;
}

function makeSessionTitle(content: string) {
  const title = content.replace(/\s+/g, " ").trim();
  if (title.length <= 80) return title;

  return `${title.slice(0, 77)}...`;
}

const QUICK_SUGGESTIONS = [
  {
    label: "Tạo học viên",
    draft: "Tạo học viên",
    icon: UserRound,
  },
  {
    label: "Tạo khóa học",
    draft: "Tạo khóa học",
    icon: BookOpen,
  },
  {
    label: "Tạo lớp học",
    draft: "Tạo lớp học",
    icon: GraduationCap,
  },
  {
    label: "Tìm học viên",
    draft: "Tìm học viên tên An",
    icon: Search,
  },
  {
    label: "Thêm vào lớp học",
    draft: "Thêm Nguyễn Văn A vào lớp IELTS 6.5 tối 2-4-6",
    icon: Plus,
  },
];

export default function CopilotPage() {
  // Render đầu tiên phải SSR-safe: KHÔNG đọc localStorage/snapshot ở đây (server
  // luôn trả null) để tránh hydration mismatch. Khôi phục session được thực hiện
  // trong useEffect sau khi hydrate (xem effect bootstrap bên dưới).
  const [sessions, setSessions] = useState<CopilotSession[]>([]);
  const [hasMoreSessions, setHasMoreSessions] = useState(false);
  const [loadingMoreSessions, setLoadingMoreSessions] = useState(false);
  const [messages, setMessages] = useState<CopilotMessage[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [pendingConfirmation, setPendingConfirmation] =
    useState<PendingConfirmation | null>(null);
  const [activePendingAction, setActivePendingAction] =
    useState<PendingActionSnapshot | null>(null);
  // Trạng thái của session đang mở: phiên CLOSED vẫn xem lại được (read-only,
  // khóa composer) thay vì bị đá về phiên ACTIVE hiện tại.
  const [activeSessionStatus, setActiveSessionStatus] =
    useState<string>("ACTIVE");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const shouldRestoreScrollRef = useRef(false);
  const didBootstrapRef = useRef(false);
  // Số session đang hiển thị — dùng làm offset khi "Xem thêm" và giữ nguyên
  // số lượng khi refresh (không co list về 1 trang sau mỗi tin nhắn).
  const sessionsCountRef = useRef(0);
  // Khi prepend tin cũ: lưu scrollHeight/scrollTop trước đó để giữ nguyên vị
  // trí đang đọc thay vì auto-scroll xuống cuối.
  const prependScrollRef = useRef<{ height: number; top: number } | null>(
    null,
  );
  // Chặn gọi trùng khi scroll bắn nhiều event trước lúc state loading kịp
  // cập nhật (set state là async, ref thì đồng bộ).
  const loadingOlderRef = useRef(false);

  const activateSession = useCallback((sessionId: number | null) => {
    setActiveSessionId(sessionId);
    storeActiveSessionId(sessionId);
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  }, []);

  useEffect(() => {
    if (prependScrollRef.current) {
      const previous = prependScrollRef.current;
      prependScrollRef.current = null;
      window.requestAnimationFrame(() => {
        const el = messagesScrollRef.current;
        if (el) {
          el.scrollTop = el.scrollHeight - previous.height + previous.top;
        }
      });
      return;
    }

    if (shouldRestoreScrollRef.current) {
      window.requestAnimationFrame(() => {
        if (messagesScrollRef.current) {
          messagesScrollRef.current.scrollTop = copilotClientSnapshot.scrollTop;
        }
        shouldRestoreScrollRef.current = false;
      });
      return;
    }

    scrollToBottom();
  }, [messages, sending, scrollToBottom]);

  useEffect(() => {
    sessionsCountRef.current = sessions.length;
    copilotClientSnapshot.sessions = sessions;
    copilotClientSnapshot.messages = messages;
    copilotClientSnapshot.activeSessionId = activeSessionId;
    copilotClientSnapshot.activePendingAction = activePendingAction;
    copilotClientSnapshot.input = input;
    copilotClientSnapshot.pendingConfirmation = pendingConfirmation;
  }, [
    activePendingAction,
    activeSessionId,
    input,
    messages,
    pendingConfirmation,
    sessions,
  ]);

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      // Refresh giữ nguyên số session đang hiển thị: đã "Xem thêm" tới đâu
      // thì tải lại tới đó, không co về 1 trang.
      const limit = Math.min(
        SESSIONS_MAX_LIMIT,
        Math.max(SESSIONS_PAGE_SIZE, sessionsCountRef.current),
      );
      const res = await apiClient.get(
        `/copilot/sessions?limit=${limit}&offset=0`,
      );
      const data = res.data as CopilotSessionsResponse;
      setSessions(data.items || []);
      setHasMoreSessions(Boolean(data.hasMore));
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Không thể tải phiên chat"));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMoreSessions = useCallback(async () => {
    setLoadingMoreSessions(true);
    setError("");
    try {
      const res = await apiClient.get(
        `/copilot/sessions?limit=${SESSIONS_PAGE_SIZE}&offset=${sessionsCountRef.current}`,
      );
      const data = res.data as CopilotSessionsResponse;
      setSessions((current) => {
        // Offset có thể lệch khi session mới được tạo -> lọc trùng theo id.
        const seen = new Set(current.map((item) => item.id));
        return [
          ...current,
          ...(data.items || []).filter((item) => !seen.has(item.id)),
        ];
      });
      setHasMoreSessions(Boolean(data.hasMore));
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Không thể tải thêm phiên chat"));
    } finally {
      setLoadingMoreSessions(false);
    }
  }, []);

  const fetchMessages = useCallback(async (sessionId: number) => {
    setLoadingMessages(true);
    try {
      const [messagesRes, sessionRes] = await Promise.all([
        apiClient.get(
          `/copilot/sessions/${sessionId}/messages?limit=${MESSAGES_INITIAL_LIMIT}`,
        ),
        apiClient.get(`/copilot/sessions/${sessionId}`),
      ]);
      const messagesData = messagesRes.data as CopilotMessagesResponse;
      setHasOlderMessages(Boolean(messagesData.hasMore));
      const sessionData = sessionRes.data as CopilotSession;
      if (sessionData?.status && sessionData.status !== "ACTIVE") {
        // Phiên đã đóng vẫn XEM LẠI được: hiển thị read-only, composer bị khóa,
        // không đụng pending. Muốn chat tiếp thì bấm "Đoạn chat mới".
        setActiveSessionStatus(sessionData.status);
        setActivePendingAction(null);
        setMessages(messagesData.items || []);
        return true;
      }
      setActiveSessionStatus("ACTIVE");
      const nextMessages = messagesData.items || [];
      const pendingAction = sessionData?.state?.pending_action;
      setActivePendingAction(pendingAction || null);
      if (pendingAction) {
        const lastAssistant = [...nextMessages]
          .reverse()
          .find((message) => message.role === "assistant");
        let lastHasPendingPreview = false;
        if (lastAssistant) {
          try {
            const parsed = JSON.parse(lastAssistant.content);
            lastHasPendingPreview = Boolean(
              parsed?.type === "preview_card" && parsed?.pending_action,
            );
          } catch {
            lastHasPendingPreview = false;
          }
        }

        setMessages(
          lastHasPendingPreview
            ? nextMessages
            : [
                ...nextMessages,
                buildPendingPreviewMessage(sessionId, pendingAction),
              ],
        );
        return true;
      }

      setActivePendingAction(null);
      setMessages(nextMessages);
      return true;
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Không thể tải tin nhắn"));
      return false;
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  const loadOlderMessages = useCallback(async () => {
    const sessionId = activeSessionId;
    if (!sessionId || loadingOlderRef.current) return;
    // Tin preview pending là tin ảo (id âm) -> lấy id thật nhỏ nhất làm mốc.
    const oldestId = messages.reduce(
      (min, message) =>
        message.id > 0 && message.id < min ? message.id : min,
      Number.POSITIVE_INFINITY,
    );
    if (!Number.isFinite(oldestId)) return;

    loadingOlderRef.current = true;
    setLoadingOlderMessages(true);
    setError("");
    try {
      const res = await apiClient.get(
        `/copilot/sessions/${sessionId}/messages?limit=${MESSAGES_OLDER_PAGE_SIZE}&before=${oldestId}`,
      );
      const data = res.data as CopilotMessagesResponse;
      const items = data.items || [];
      if (items.length > 0) {
        const el = messagesScrollRef.current;
        if (el) {
          prependScrollRef.current = {
            height: el.scrollHeight,
            top: el.scrollTop,
          };
        }
        setMessages((current) => {
          const seen = new Set(current.map((message) => message.id));
          return [
            ...items.filter((message) => !seen.has(message.id)),
            ...current,
          ];
        });
      }
      setHasOlderMessages(Boolean(data.hasMore));
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Không thể tải tin nhắn cũ hơn"));
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlderMessages(false);
    }
  }, [activeSessionId, messages]);

  // Bootstrap an toàn khi reload: hỏi backend session ACTIVE hiện tại (tạo mới
  // nếu chưa có). Không bao giờ dùng session đã CLOSED.
  const bootstrapCurrentSession = useCallback(async () => {
    try {
      const res = await apiClient.get("/copilot/sessions/current");
      const session = res.data as CopilotSession;
      if (session?.id) {
        setSessions((current) =>
          current.some((item) => item.id === session.id)
            ? current
            : [session, ...current],
        );
        activateSession(session.id);
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Không thể khởi tạo phiên chat"));
    }
  }, [activateSession]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchSessions();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [fetchSessions]);

  // Sau khi hydrate (chỉ chạy 1 lần ở client): đọc storage/snapshot rồi khôi phục
  // session, hoặc bootstrap session ACTIVE mới. Đọc localStorage ở đây (không phải
  // trong render) để tránh hydration mismatch.
  useEffect(() => {
    if (didBootstrapRef.current) return;
    didBootstrapRef.current = true;

    const timer = window.setTimeout(() => {
      const storedId = readStoredActiveSessionId();
      if (!storedId) {
        void bootstrapCurrentSession();
        return;
      }

      const snapshotMatches =
        copilotClientSnapshot.activeSessionId === storedId &&
        copilotClientSnapshot.messages.length > 0;
      if (snapshotMatches) {
        setSessions(copilotClientSnapshot.sessions);
        setMessages(copilotClientSnapshot.messages);
        setActivePendingAction(copilotClientSnapshot.activePendingAction);
        setInput(copilotClientSnapshot.input);
        setPendingConfirmation(copilotClientSnapshot.pendingConfirmation);
        shouldRestoreScrollRef.current = true;
      } else {
        setLoadingMessages(true);
      }
      // fetchMessages effect sẽ chạy khi activeSessionId set; session CLOSED
      // hiển thị read-only, chỉ khi lỗi/không tồn tại mới fallback bootstrap.
      setActiveSessionId(storedId);
    }, 0);

    return () => window.clearTimeout(timer);
  }, [bootstrapCurrentSession]);

  useEffect(() => {
    if (activeSessionId) {
      const timer = window.setTimeout(() => {
        void fetchMessages(activeSessionId).then((loaded) => {
          if (!loaded) {
            // Session không tồn tại/lỗi tải -> bootstrap session ACTIVE mới.
            activateSession(null);
            setMessages([]);
            void bootstrapCurrentSession();
          }
        });
      }, 0);

      return () => window.clearTimeout(timer);
    }
  }, [activeSessionId, activateSession, fetchMessages, bootstrapCurrentSession]);

  const hasPendingPreview = Boolean(activePendingAction);
  const activePreviewMessageId = useMemo(() => {
    if (!activePendingAction) return null;
    const previewMessage = [...messages].reverse().find((message) => {
      if (message.role !== "assistant") return false;
      try {
        const parsed = JSON.parse(message.content);
        return Boolean(
          parsed?.type === "preview_card" && parsed?.pending_action,
        );
      } catch {
        return false;
      }
    });
    return previewMessage?.id ?? null;
  }, [activePendingAction, messages]);
  // Phiên đã đóng vẫn nhắn tiếp được: gửi tin sẽ tự mở lại phiên (reopen).
  const viewingClosedSession = activeSessionStatus !== "ACTIVE";
  // Khóa composer chỉ khi đang gửi. Khi có pending preview, vẫn cho chat để
  // bổ sung thông tin (SĐT, email...) vào bản nháp qua backend draft-patch.
  const composerLocked = sending;

  const startNewSession = useCallback(async () => {
    if (sending) return;
    setError("");
    setSidebarOpen(false);

    // KHÔNG đóng session cũ nữa: user có thể quay lại đoạn chat cũ nhắn tiếp
    // với nguyên ngữ cảnh (học viên/lớp vừa tạo...). Pending cũ (nếu có) vẫn
    // phải được user xác nhận tường minh mới chạy nên không nguy hiểm.

    // Reset UI ngay để không thao tác nhầm pending cũ.
    activateSession(null);
    setMessages([]);
    setInput("");
    setPendingConfirmation(null);
    setActivePendingAction(null);
    setActiveSessionStatus("ACTIVE");
    setLoadingMessages(false);

    try {
      const res = await apiClient.post("/copilot/sessions", {});
      const session = res.data as CopilotSession;
      setSessions((current) => [
        session,
        ...current.filter((item) => item.id !== session.id),
      ]);
      activateSession(session.id);
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Không thể tạo cuộc trò chuyện mới"));
    }
  }, [activateSession, sending]);

  const selectSession = useCallback(
    (sessionId: number) => {
      if (sending) return;
      setError("");
      setSidebarOpen(false);
      setPendingConfirmation(null);
      setActivePendingAction(null);
      if (sessionId !== activeSessionId) {
        setMessages([]);
        setLoadingMessages(true);
      }
      activateSession(sessionId);
      if (sessionId === activeSessionId) {
        void fetchMessages(sessionId);
      }
    },
    [activeSessionId, activateSession, fetchMessages, sending],
  );

  const deleteSession = async (sessionId: number) => {
    if (sending) return;
    const session = sessions.find((item) => item.id === sessionId);
    const confirmed = window.confirm(
      `Xóa cuộc trò chuyện "${session?.title || `Phiên #${sessionId}`}"?`,
    );
    if (!confirmed) return;

    setError("");
    try {
      await apiClient.delete(`/copilot/sessions/${sessionId}`);
      const remainingSessions = sessions.filter(
        (item) => item.id !== sessionId,
      );
      setSessions(remainingSessions);

      if (activeSessionId === sessionId) {
        activateSession(null);
        setMessages([]);
        setInput("");
        setPendingConfirmation(null);
        setActivePendingAction(null);
        setLoadingMessages(false);
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Không thể xóa cuộc trò chuyện"));
    }
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    const content = input.trim();
    // Chặn cả submit programmatic (Enter/requestSubmit) khi composer bị khóa
    // do đang có bản nháp chờ xác nhận.
    if (composerLocked || !content) return;

    let sessionId = activeSessionId;
    setSending(true);
    setError("");

    try {
      if (!sessionId) {
        const sessionRes = await apiClient.post("/copilot/sessions", {
          title: makeSessionTitle(content),
        });
        sessionId = (sessionRes.data as CopilotSession).id;
        // POST /sessions có thể tái sử dụng session trống đã có trong list.
        setSessions((current) => [
          sessionRes.data as CopilotSession,
          ...current.filter((item) => item.id !== sessionId),
        ]);
        activateSession(sessionId);
      }

      if (!sessionId) {
        throw new Error("Không thể xác định phiên chat để gửi tin nhắn");
      }

      // Nhắn trong đoạn chat CŨ (đã đóng): mở lại phiên rồi gửi bình thường.
      if (viewingClosedSession) {
        await apiClient.patch(`/copilot/sessions/${sessionId}/reopen`);
        setActiveSessionStatus("ACTIVE");
      }

      setInput("");
      await apiClient.post(`/copilot/sessions/${sessionId}/turns`, { content });
      await fetchMessages(sessionId);
      await fetchSessions();
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Không thể gửi tin nhắn"));
    } finally {
      setSending(false);
    }
  };

  const confirmPendingAction = async (
    overrideInput?: Record<string, unknown>,
  ) => {
    if (!activeSessionId || sending) return;
    setSending(true);
    setError("");
    try {
      await apiClient.post(`/copilot/sessions/${activeSessionId}/confirm`, {
        input: overrideInput || pendingConfirmation?.input,
        inputOverride: overrideInput || pendingConfirmation?.input,
        // Chống double-submit: backend bỏ qua confirm lặp lại cùng key.
        idempotencyKey: activePendingAction?.idempotency_key,
      });
      setPendingConfirmation(null);
      await Promise.all([fetchMessages(activeSessionId), fetchSessions()]);
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Không thể xác nhận thao tác"));
    } finally {
      setSending(false);
    }
  };

  const updatePendingDraft = useCallback(
    async (input: Record<string, unknown>) => {
      if (!activeSessionId || !activePendingAction) return;
      try {
        const res = await apiClient.patch(
          `/copilot/sessions/${activeSessionId}/pending-action`,
          { input },
        );
        const session = res.data?.session as CopilotSession | undefined;
        setActivePendingAction(session?.state?.pending_action || null);
      } catch {
        // Form vẫn gửi inputOverride khi confirm; lỗi sync draft không chặn nhập liệu.
      }
    },
    [activePendingAction, activeSessionId],
  );

  const cancelPendingAction = async () => {
    if (!activeSessionId || sending) return;
    setSending(true);
    setError("");
    try {
      await apiClient.post(`/copilot/sessions/${activeSessionId}/cancel`);
      setPendingConfirmation(null);
      await Promise.all([fetchMessages(activeSessionId), fetchSessions()]);
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Không thể hủy thao tác"));
    } finally {
      setSending(false);
    }
  };

  const applySuggestionDraft = async (
    draftMessage?: string,
    action?: SuggestionAction,
  ) => {
    if (!draftMessage?.trim() || sending) return;
    setSending(true);
    setError("");
    let sessionId = activeSessionId;
    try {
      // Suggestion trong đoạn chat cũ (đã đóng): mở lại phiên rồi gửi tiếp.
      if (sessionId && viewingClosedSession) {
        await apiClient.patch(`/copilot/sessions/${sessionId}/reopen`);
        setActiveSessionStatus("ACTIVE");
      }
      if (!sessionId) {
        const sessionRes = await apiClient.post("/copilot/sessions", {
          title: makeSessionTitle(draftMessage),
        });
        sessionId = (sessionRes.data as CopilotSession).id;
        // POST /sessions có thể tái sử dụng session trống đã có trong list.
        setSessions((current) => [
          sessionRes.data as CopilotSession,
          ...current.filter((item) => item.id !== sessionId),
        ]);
        activateSession(sessionId);
      }

      if (!sessionId) {
        throw new Error("Không thể xác định phiên chat để gửi tin nhắn");
      }

      setInput("");
      await apiClient.post(`/copilot/sessions/${sessionId}/turns`, {
        content: draftMessage.trim(),
        ...(action ? { action } : {}),
      });
      await fetchMessages(sessionId);
      await fetchSessions();
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Không thể gửi tin nhắn"));
    } finally {
      setSending(false);
    }
  };

  const openEmptyDraft = async (toolName: string, label: string) => {
    const input = EMPTY_DRAFT_INPUTS[toolName];
    if (!input) {
      await applySuggestionDraft(label);
      return;
    }

    const draftId = createDraftId();
    await applySuggestionDraft(label, {
      type: "suggestion_action",
      action: toolName,
      input,
      source: "quick_action_empty_form",
      draftId,
    });
  };

  const handleQuickSuggestion = (draft: string) => {
    if (draft === "Tạo học viên") {
      void openEmptyDraft("create_student", draft);
      return;
    }
    if (draft === "Tạo khóa học") {
      void openEmptyDraft("create_course", draft);
      return;
    }
    if (draft === "Tạo lớp học") {
      void openEmptyDraft("create_class", draft);
      return;
    }
    void applySuggestionDraft(draft);
  };

  const buildCandidateSelectionMessage = (
    option: CopilotSelectionOption,
    index: number,
    entity?: string,
    intent?: string,
  ) => {
    if (entity === "course" && intent === "create_class") {
      return `Chọn khóa học ${option.label} #${option.id} để tạo lớp`;
    }
    if (entity === "student" && intent === "assign_student_to_class") {
      return `Chọn học viên ${option.label} #${option.id} để thêm vào lớp`;
    }
    if (entity === "class" && intent === "assign_student_to_class") {
      return `Chọn lớp học ${option.label} #${option.id} để thêm học viên`;
    }
    if (entity === "course") {
      return `Chọn khóa học số ${index + 1}`;
    }
    if (entity === "class") {
      return `Chọn lớp học số ${index + 1}`;
    }
    if (entity === "student") {
      return `Chọn học viên số ${index + 1}`;
    }
    return `Chọn ${option.label} #${option.id}`;
  };

  const renderSuggestionButton = (
    label: string,
    description: string | undefined,
    draftMessage: string | undefined,
    key: string,
    metadata?: Record<string, unknown>,
    action?: SuggestionAction,
  ) => {
    const courseTitle = metadata?.courseTitle
      ? String(metadata.courseTitle)
      : "";
    const displayDescription = courseTitle
      ? `Khóa học: ${courseTitle}${description ? ` • ${description}` : ""}`
      : description;

    return (
      <button
        key={key}
        type="button"
        onClick={() => {
          void applySuggestionDraft(draftMessage, action);
        }}
        className="group flex w-full min-w-0 items-start gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-left transition hover:border-zinc-300 hover:bg-zinc-50"
      >
        <Sparkles
          size={13}
          className="mt-1 shrink-0 text-zinc-300 transition group-hover:text-zinc-500"
        />
        <span className="min-w-0 flex-1">
          <span className="block break-words text-[13px] font-medium text-zinc-800">
            {label}
          </span>
          {displayDescription && (
            <span className="mt-0.5 block break-words text-xs leading-4 text-zinc-500">
              {displayDescription}
            </span>
          )}
        </span>
      </button>
    );
  };

  const renderSuggestions = (suggestions: unknown) => {
    if (!Array.isArray(suggestions) || suggestions.length === 0) return null;
    const validSuggestions = suggestions.filter(
      (item): item is ProactiveSuggestion =>
        Boolean(item) && typeof item === "object" && "title" in item,
    );
    if (validSuggestions.length === 0) return null;

    return (
      <div className="space-y-2">
        <div className="text-[11px] font-medium text-zinc-400">
          Gợi ý tiếp theo
        </div>
        <div className="space-y-2">
          {validSuggestions.map((suggestion) => {
            const options = Array.isArray(suggestion.options)
              ? suggestion.options
              : [];
            if (options.length === 0) {
              return renderSuggestionButton(
                suggestion.title,
                suggestion.message,
                suggestion.draft_message,
                suggestion.id,
                undefined,
                suggestion.action,
              );
            }

            return (
              <div key={suggestion.id} className="space-y-1.5">
                <div>
                  <div className="text-[13px] font-medium text-zinc-800">
                    {suggestion.title}
                  </div>
                  <div className="text-xs leading-5 text-zinc-500">
                    {suggestion.message}
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-1.5">
                  {options.map((option) =>
                    renderSuggestionButton(
                      option.label,
                      option.reason,
                      option.draft_message || suggestion.draft_message,
                      `${suggestion.id}-${option.id}`,
                      option.metadata,
                      option.action || suggestion.action,
                    ),
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const withSuggestions = (content: React.ReactNode, suggestions: unknown) => (
    <div className="space-y-3">
      {content}
      {renderSuggestions(suggestions)}
    </div>
  );

  const renderAssistantContent = (content: string, canAct = false) => {
    try {
      const data = JSON.parse(content);

      if (data.type === "clarification") {
        return withSuggestions(
          <CopilotClarificationCard
            message={String(
              data.message || "Bạn bổ sung thêm thông tin giúp mình nhé.",
            )}
            missingFields={
              Array.isArray(data.missing_fields) ? data.missing_fields : []
            }
            options={
              data.clarification_type === "target_disambiguation" &&
              Array.isArray(data.options)
                ? data.options
                : []
            }
            sending={sending}
            labelForField={formatFieldLabel}
            onSelectOption={(value) => void applySuggestionDraft(value)}
          />,
          data.suggestions,
        );
      }

      if (data.type === "student_create_form") {
        return withSuggestions(
          <StudentCreateForm
            data={data}
            sending={sending}
            canAct={canAct}
            onSubmit={(input) => {
              const name = String(input.fullName || "").trim();
              void applySuggestionDraft(
                name ? `Tạo học viên: ${name}` : "Tạo học viên",
                {
                  type: "suggestion_action",
                  action: "create_student",
                  input,
                },
              );
            }}
          />,
          data.suggestions,
        );
      }

      if (data.type === "course_create_form") {
        return withSuggestions(
          <CourseCreateForm
            data={data}
            sending={sending}
            canAct={canAct}
            onSubmit={(input) => {
              const title = String(input.title || "").trim();
              void applySuggestionDraft(
                title ? `Tạo khóa học: ${title}` : "Tạo khóa học",
                {
                  type: "suggestion_action",
                  action: "create_course",
                  input,
                },
              );
            }}
          />,
          data.suggestions,
        );
      }

      if (data.type === "student_table") {
        return withSuggestions(
          <StudentTableBlock
            title={typeof data.title === "string" ? data.title : undefined}
            message={
              typeof data.message === "string" ? data.message : undefined
            }
            students={Array.isArray(data.students) ? data.students : []}
          />,
          data.suggestions,
        );
      }

      if (data.type === "class_table") {
        return withSuggestions(
          <ClassTableBlock
            title={typeof data.title === "string" ? data.title : undefined}
            message={
              typeof data.message === "string" ? data.message : undefined
            }
            classes={Array.isArray(data.classes) ? data.classes : []}
          />,
          data.suggestions,
        );
      }

      if (data.type === "selection_list") {
        const options = Array.isArray(data.options)
          ? (data.options as CopilotSelectionOption[])
          : [];
        const totalCount =
          typeof data.total_count === "number"
            ? data.total_count
            : options.length;

        return withSuggestions(
          <CopilotCandidateList
            title={
              data.entity === "student"
                ? "Tìm thấy nhiều học viên phù hợp"
                : data.entity === "course"
                  ? "Tìm thấy nhiều khóa học phù hợp"
                  : data.entity === "class"
                    ? "Tìm thấy nhiều lớp học phù hợp"
                    : "Tìm thấy nhiều kết quả phù hợp"
            }
            message={data.message}
            entity={data.entity}
            totalCount={totalCount}
            options={options}
            sending={sending}
            onSelect={(option, index) =>
              void applySuggestionDraft(
                buildCandidateSelectionMessage(
                  option,
                  index,
                  data.entity,
                  data.intent,
                ),
              )
            }
          />,
          data.suggestions,
        );
      }

      if (data.type === "preview_card") {
        return withSuggestions(
          <EditablePreviewCard
            key={[
              data.pending_action?.tool_name || data.tool_name,
              data.pending_action?.draftId || "no-draft",
              data.pending_action?.source || "backend",
              JSON.stringify(data.pending_action?.input || data.input || {}),
            ].join(":")}
            data={data}
            sending={sending}
            canAct={canAct}
            onCancel={() => void cancelPendingAction()}
            onDraftChange={(nextInput) => void updatePendingDraft(nextInput)}
            onConfirm={(overrideInput) => {
              if (!canAct) return;
              if (data.requires_modal_confirmation) {
                setPendingConfirmation({
                  confirmation_title: data.confirmation_title,
                  confirm_label: data.confirm_label,
                  cancel_label: data.cancel_label,
                  summary: data.summary,
                  display_input: data.display_input,
                  input: overrideInput
                    ? { ...data.input, ...overrideInput }
                    : data.input,
                  impact: data.impact,
                });
                return;
              }
              void confirmPendingAction(overrideInput);
            }}
          />,
          data.suggestions,
        );
      }

      if (data.type === "tool_result") {
        const isEnrollmentResult =
          data.tool_name === "assign_student_to_course" ||
          data.tool_name === "assign_student_to_class" ||
          data.tool_name === "update_student_class_role" ||
          data.tool_name === "remove_student_from_class";
        const enrollmentTitle =
          data.tool_name === "assign_student_to_course"
            ? "Thông tin ghi danh vào khóa học"
            : data.tool_name === "assign_student_to_class"
              ? "Thông tin thêm vào lớp"
              : "Thông tin lớp học";

        return withSuggestions(
          <CopilotResultCard
            status={data.status}
            toolName={data.tool_name}
            message={data.message}
          >
            {data.tool_name === "delete_students" ||
            data.tool_name === "delete_courses" ? (
              <DeleteResultBlock data={data.result || {}} />
            ) : isEnrollmentResult ? (
              <EnrollmentResultBlock
                data={data.result || {}}
                title={enrollmentTitle}
              />
            ) : (
              <ProfileResultBlocks
                data={data.result || {}}
                toolName={data.tool_name}
                onSelect={(msg) => void applySuggestionDraft(msg)}
              />
            )}
          </CopilotResultCard>,
          data.suggestions,
        );
      }

      if (data.type === "error") {
        return withSuggestions(
          <CopilotErrorCard
            message={
              String(data.message || "").includes("quota") ||
              String(data.code || "").includes("QUOTA")
                ? "Nhà cung cấp AI đang lỗi hoặc hết quota. Bạn có thể thử lại sau hoặc kiểm tra cấu hình API key."
                : String(
                    data.message ||
                      "AI Agent chưa thể xử lý yêu cầu này. Vui lòng thử lại hoặc nhập rõ hơn.",
                  )
            }
          />,
          data.suggestions,
        );
      }

      return withSuggestions(
        <p className="whitespace-pre-wrap text-sm leading-6 text-zinc-800">
          {data.message || content}
        </p>,
        data.suggestions,
      );
    } catch {
      return (
        <p className="whitespace-pre-wrap text-sm leading-6 text-zinc-800">
          {content}
        </p>
      );
    }
  };

  const isRestoringActiveSession =
    Boolean(activeSessionId) && loadingMessages && messages.length === 0;

  const composerNode = (
    <CopilotComposer
      input={input}
      setInput={setInput}
      locked={composerLocked}
      sending={sending}
      hasPendingPreview={hasPendingPreview}
      onSubmit={sendMessage}
    />
  );

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-white text-zinc-900">
      <Navbar />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <CopilotSessionSidebar
          sessions={sessions}
          activeSessionId={activeSessionId}
          loading={loading}
          sending={sending}
          open={sidebarOpen}
          hasMore={hasMoreSessions}
          loadingMore={loadingMoreSessions}
          onLoadMore={() => void loadMoreSessions()}
          onClose={() => setSidebarOpen(false)}
          onNewSession={() => void startNewSession()}
          onSelectSession={selectSession}
          onDeleteSession={(sessionId) => void deleteSession(sessionId)}
        />

        <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-white">
          <CopilotHeader
            hasPendingPreview={hasPendingPreview}
            sending={sending}
            onNewChat={() => void startNewSession()}
            onToggleSidebar={() => setSidebarOpen(true)}
          />

          {isRestoringActiveSession ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 pb-16 text-zinc-400">
              <LoaderCircle size={20} className="animate-spin" />
              <div className="text-[13px]">Đang mở lại cuộc trò chuyện...</div>
            </div>
          ) : messages.length === 0 ? (
            <CopilotEmptyState
              error={error}
              suggestions={QUICK_SUGGESTIONS}
              disabled={composerLocked}
              onApplySuggestion={handleQuickSuggestion}
              composer={composerNode}
            />
          ) : (
            <>
              <div
                ref={messagesScrollRef}
                onScroll={(event) => {
                  copilotClientSnapshot.scrollTop =
                    event.currentTarget.scrollTop;
                  // Cuộn lên gần đầu -> tự tải trang tin cũ hơn (infinite
                  // scroll kiểu ChatGPT). Vị trí đọc được giữ nguyên khi
                  // prepend nên không giật xuống cuối.
                  if (
                    event.currentTarget.scrollTop < 80 &&
                    hasOlderMessages &&
                    !loadingMessages &&
                    !loadingOlderMessages
                  ) {
                    void loadOlderMessages();
                  }
                }}
                className="flex-1 overflow-y-auto [scrollbar-width:thin] [scrollbar-color:#d4d4d8_transparent]"
              >
                <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6">
                  {error && <CopilotErrorCard message={error} />}
                  {loadingOlderMessages && (
                    <div className="flex items-center justify-center gap-2 py-1 text-[12px] text-zinc-400">
                      <LoaderCircle size={14} className="animate-spin" />
                      Đang tải tin nhắn cũ hơn...
                    </div>
                  )}
                  {messages.map((message) => (
                    <CopilotMessageBubble
                      key={message.id}
                      role={message.role}
                      createdAt={message.createdAt}
                    >
                      {message.role === "assistant"
                        ? renderAssistantContent(
                            message.content,
                            message.id === activePreviewMessageId,
                          )
                        : message.content}
                    </CopilotMessageBubble>
                  ))}
                  {sending && <CopilotTypingIndicator />}
                  <div ref={messagesEndRef} />
                </div>
              </div>

              <div className="shrink-0 bg-white px-4 pb-3 pt-1">
                <div className="mx-auto w-full max-w-3xl">
                  {composerNode}
                  <p
                    className={`mt-2 text-center text-[11px] leading-4 ${
                      hasPendingPreview || viewingClosedSession
                        ? "text-amber-700"
                        : "text-zinc-400"
                    }`}
                  >
                    {viewingClosedSession
                      ? "Phiên chat này đã kết thúc trước đó — gửi tin nhắn để mở lại và tiếp tục trò chuyện."
                      : hasPendingPreview
                        ? "Bạn có thể gõ thêm thông tin (VD: SĐT, email) để cập nhật bản nháp, hoặc bấm Xác nhận/Hủy trên card."
                        : "AI Agent có thể nhầm lẫn. Hãy kiểm tra kỹ trước khi xác nhận thao tác."}
                  </p>
                </div>
              </div>
            </>
          )}
        </main>
      </div>

      {pendingConfirmation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/50 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="danger-confirmation-title"
            className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-xl"
          >
            <div className="flex items-start gap-3 border-b border-zinc-100 px-5 py-4">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600">
                <AlertTriangle size={18} />
              </div>
              <div className="min-w-0">
                <h3
                  id="danger-confirmation-title"
                  className="text-[15px] font-semibold text-zinc-900"
                >
                  {pendingConfirmation.confirmation_title ||
                    "Bạn có chắc chắn không?"}
                </h3>
                {pendingConfirmation.summary && (
                  <p className="mt-0.5 text-[13px] leading-5 text-zinc-500">
                    {pendingConfirmation.summary}
                  </p>
                )}
              </div>
            </div>

            <div className="max-h-[55vh] space-y-3 overflow-y-auto px-5 py-4">
              <ActionInputSummary
                input={
                  pendingConfirmation.display_input ||
                  pendingConfirmation.input ||
                  {}
                }
              />
              {pendingConfirmation.impact &&
                Object.keys(pendingConfirmation.impact).length > 0 && (
                  <div>
                    <div className="mb-1.5 text-xs font-medium text-zinc-500">
                      Dữ liệu bị ảnh hưởng
                    </div>
                    <ActionInputSummary input={pendingConfirmation.impact} />
                  </div>
                )}
              <p className="text-xs leading-5 text-zinc-500">
                Hãy kiểm tra đúng học viên, khóa học và lớp trước khi tiếp tục.
                Thao tác chỉ được thực hiện sau khi bạn bấm nút xác nhận.
              </p>
            </div>

            <div className="flex justify-end gap-2 border-t border-zinc-100 px-5 py-3.5">
              <button
                type="button"
                disabled={sending}
                onClick={() => void cancelPendingAction()}
                className="h-9 rounded-[10px] border border-zinc-200 bg-white px-4 text-[13px] font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-50"
              >
                {pendingConfirmation.cancel_label || "Không, quay lại"}
              </button>
              <button
                type="button"
                disabled={sending}
                onClick={() => void confirmPendingAction()}
                className="inline-flex h-9 items-center gap-1.5 rounded-[10px] bg-red-600 px-4 text-[13px] font-medium text-white transition hover:bg-red-700 disabled:opacity-50"
              >
                {sending && (
                  <LoaderCircle size={14} className="animate-spin" />
                )}
                {sending
                  ? "Đang thực hiện..."
                  : pendingConfirmation.confirm_label || "Xác nhận"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
