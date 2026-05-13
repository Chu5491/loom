export interface PersistedState {
  activeThreadId: string | null;
}

const empty: PersistedState = { activeThreadId: null };

export function readPersistedState(key: string | null): PersistedState {
  if (!key || typeof window === "undefined") return empty;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as { activeThreadId?: unknown };
    const activeThreadId =
      typeof parsed.activeThreadId === "string"
        ? parsed.activeThreadId
        : null;
    return { activeThreadId };
  } catch {
    return empty;
  }
}
