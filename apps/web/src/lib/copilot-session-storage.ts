export const COPILOT_ACTIVE_SESSION_STORAGE_KEY = "copilot.activeSessionId";

export const clearCopilotActiveSession = () => {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(COPILOT_ACTIVE_SESSION_STORAGE_KEY);
};
