// 카톡 PC식 떠있는 채팅창. position: fixed로 에디터 위에 그림자 + border 띄우기.
// - 헤더 드래그로 이동, 위치는 localStorage에 저장
// - 더블클릭으로 기본 위치 리셋
// - X / ESC로 닫기
// - 백드롭 dim 없음 — 에디터 코드는 항상 보이게

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X } from "lucide-react";
import { useI18n } from "../context/I18nContext.js";

const STORAGE_KEY = "loom:chatOverlay:pos";
const DEFAULT_WIDTH = 400;
const DEFAULT_MARGIN_TOP = 60;
const DEFAULT_MARGIN_RIGHT = 56; // icon rail (44) + gap (12)
const MIN_VISIBLE = 120; // 화면 밖으로 끌고 가는 걸 방지하는 최소 보이는 영역

interface Position {
  /** viewport 기준 좌상단 픽셀. null이면 default(우측 상단) 위치 사용. */
  left: number;
  top: number;
}

function readStoredPosition(): Position | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { left?: unknown; top?: unknown };
    if (typeof parsed.left === "number" && typeof parsed.top === "number") {
      return { left: parsed.left, top: parsed.top };
    }
  } catch {
    // 무시
  }
  return null;
}

function storePosition(p: Position | null) {
  try {
    if (p) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 무시
  }
}

function clamp(p: Position, width: number): Position {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  return {
    left: Math.min(
      Math.max(p.left, MIN_VISIBLE - width),
      vw - MIN_VISIBLE,
    ),
    top: Math.min(Math.max(p.top, 0), vh - MIN_VISIBLE),
  };
}

export interface ChatOverlayProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}

export function ChatOverlay({ open, onClose, title, children }: ChatOverlayProps) {
  const { t } = useI18n();
  const [position, setPosition] = useState<Position | null>(() =>
    readStoredPosition(),
  );
  const sizeRef = useRef<{ w: number; h: number }>({
    w: DEFAULT_WIDTH,
    h: 600,
  });

  // ESC로 닫기.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // 드래그 시작 — 헤더 mousedown.
  const onDragStart = useCallback(
    (e: React.MouseEvent) => {
      // 입력 가능한 컨트롤 위에서 시작된 mousedown은 드래그 안 함 (X 버튼 등).
      const target = e.target as HTMLElement;
      if (target.closest("button, input, textarea, [data-no-drag]")) return;

      e.preventDefault();
      const startX = e.clientX;
      const startY = e.clientY;
      const startPos = position ?? defaultPosition();
      const onMove = (ev: MouseEvent) => {
        const next = clamp(
          {
            left: startPos.left + (ev.clientX - startX),
            top: startPos.top + (ev.clientY - startY),
          },
          sizeRef.current.w,
        );
        setPosition(next);
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
        // 마지막 위치를 저장. 함수형 업데이트로 최신 값 캡처.
        setPosition((p) => {
          if (p) storePosition(p);
          return p;
        });
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
      document.body.style.userSelect = "none";
      document.body.style.cursor = "grabbing";
    },
    [position],
  );

  // 헤더 더블클릭 → 기본 위치로 리셋.
  const onResetPosition = useCallback(() => {
    setPosition(null);
    storePosition(null);
  }, []);

  // 화면 리사이즈 시 영역 밖이면 다시 안으로 끌어옴.
  useEffect(() => {
    if (!position) return;
    const onResize = () => {
      setPosition((p) => (p ? clamp(p, sizeRef.current.w) : p));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [position]);

  const style = position
    ? { left: position.left, top: position.top }
    : {
        right: DEFAULT_MARGIN_RIGHT,
        top: DEFAULT_MARGIN_TOP,
      };

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="chat-overlay"
          initial={{ opacity: 0, scale: 0.96, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 8 }}
          transition={{ duration: 0.16, ease: "easeOut" }}
          className="fixed z-40 flex flex-col rounded-lg border border-border bg-card shadow-2xl overflow-hidden"
          style={{
            ...style,
            width: DEFAULT_WIDTH,
            // 뷰포트의 상하 여백 8px씩 빼고 max로 고정.
            height: "calc(100vh - 80px)",
            maxHeight: "calc(100vh - 80px)",
          }}
          ref={(el) => {
            if (el) {
              sizeRef.current = { w: el.offsetWidth, h: el.offsetHeight };
            }
          }}
        >
          <div
            onMouseDown={onDragStart}
            onDoubleClick={onResetPosition}
            className="flex items-center gap-2 px-3 h-9 border-b border-border/60 bg-muted/40 cursor-grab active:cursor-grabbing select-none shrink-0"
            title={t("chat.overlay.dragHint")}
          >
            <span className="text-[11px] font-semibold tracking-wide text-foreground/80 truncate">
              {title ?? t("chat.overlay.title")}
            </span>
            <button
              type="button"
              data-no-drag
              onClick={onClose}
              aria-label={t("chat.overlay.close")}
              title={t("chat.overlay.close")}
              className="ml-auto inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <X className="size-4" />
            </button>
          </div>
          <div className="flex-1 min-h-0 flex flex-col">{children}</div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function defaultPosition(): Position {
  // 기본 위치 = 우측 상단 — 드래그 시작점 계산용.
  const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
  return {
    left: vw - DEFAULT_MARGIN_RIGHT - DEFAULT_WIDTH,
    top: DEFAULT_MARGIN_TOP,
  };
}

