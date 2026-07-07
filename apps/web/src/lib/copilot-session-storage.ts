const STORAGE_KEY = "cobinot:copilot:activeSessionId";

// Backward-compatible export (một số nơi còn import hằng số này).
export const COPILOT_ACTIVE_SESSION_STORAGE_KEY = STORAGE_KEY;

const getStore = (): Storage | null => {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

export const getActiveCopilotSessionId = (): number | null => {
  const store = getStore();
  if (!store) return null;
  const raw = store.getItem(STORAGE_KEY);
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
};

export const setActiveCopilotSessionId = (id: number | null): void => {
  const store = getStore();
  if (!store) return;
  if (id && Number.isInteger(id) && id > 0) {
    store.setItem(STORAGE_KEY, String(id));
  } else {
    store.removeItem(STORAGE_KEY);
  }
};

export const clearActiveCopilotSessionId = (): void => {
  setActiveCopilotSessionId(null);
};

// Backward-compatible alias.
export const clearCopilotActiveSession = clearActiveCopilotSessionId;
