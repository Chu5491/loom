// 워크스페이스 탭/스레드 상태를 localStorage에 보존. 손상된 JSON은 빈 기본값으로 폴백.

export interface PersistedTabs {
  openFiles: string[];
  activeTab: "chat" | string;
  activeThreadId: string | null;
}

const empty: PersistedTabs = {
  openFiles: [],
  activeTab: "chat",
  activeThreadId: null,
};

export function readPersistedTabs(key: string | null): PersistedTabs {
  if (!key || typeof window === "undefined") return empty;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as {
      openFiles?: unknown;
      activeTab?: unknown;
      activeThreadId?: unknown;
    };
    const openFiles =
      Array.isArray(parsed.openFiles) &&
      parsed.openFiles.every((p) => typeof p === "string")
        ? (parsed.openFiles as string[])
        : [];
    const activeTab =
      typeof parsed.activeTab === "string" &&
      (parsed.activeTab === "chat" || openFiles.includes(parsed.activeTab))
        ? (parsed.activeTab as "chat" | string)
        : "chat";
    const activeThreadId =
      typeof parsed.activeThreadId === "string"
        ? parsed.activeThreadId
        : null;
    return { openFiles, activeTab, activeThreadId };
  } catch {
    return empty;
  }
}
