/**
 * Deterministic color assignment for an agent. Same agent.id always maps
 * to the same palette entry, so re-renders keep the visual identity stable.
 *
 * Tailwind v4 JIT only sees full class names that appear *literally* in
 * source, so we keep the per-tone class strings in a fixed lookup rather
 * than building them with template literals.
 */

// 신규 색은 항상 PALETTE 끝에 추가. agentColorFor() 의 해시가 인덱스
// 기반이라 기존 자동 색 안정성을 유지하려면 순서를 절대 바꾸지 말 것.
const PALETTE = [
  "sky",
  "emerald",
  "amber",
  "rose",
  "violet",
  "teal",
  "fuchsia",
  "lime",
  "orange",
  "cyan",
  "red",
  "yellow",
  "green",
  "blue",
  "indigo",
  "purple",
  "pink",
  "slate",
] as const;

export type AgentColor = (typeof PALETTE)[number];

/** Whole list — exposed so the agent form can render a swatch picker. */
export const AGENT_COLORS: ReadonlyArray<AgentColor> = PALETTE;

/** Picker 시각 정렬용 — 색상환을 따라 도는 순서. PALETTE 와 별도로
 *  유지해서 해시 안정성을 깨지 않으면서 UI 만 자연스럽게 보이게 함. */
export const PICKER_ORDER: ReadonlyArray<AgentColor> = [
  "red",
  "orange",
  "amber",
  "yellow",
  "lime",
  "green",
  "emerald",
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "violet",
  "purple",
  "fuchsia",
  "pink",
  "rose",
  "slate",
];

export function agentColorFor(agentId: string): AgentColor {
  let h = 0;
  for (let i = 0; i < agentId.length; i++) {
    h = (Math.imul(h, 31) + agentId.charCodeAt(i)) | 0;
  }
  return PALETTE[Math.abs(h) % PALETTE.length]!;
}

/** Validates and narrows a stored value to a known palette color. */
export function isAgentColor(v: unknown): v is AgentColor {
  return typeof v === "string" && (PALETTE as readonly string[]).includes(v);
}

/** Resolve an agent's display color: explicit `adapterConfig.color`
 *  if set, otherwise the deterministic hash of its id. Used everywhere
 *  the UI tints an agent (chips, dots, avatars). */
export function agentColorOf(agent: {
  id: string;
  adapterConfig?: Record<string, unknown> | null;
}): AgentColor {
  const explicit = agent.adapterConfig?.color;
  if (isAgentColor(explicit)) return explicit;
  return agentColorFor(agent.id);
}

export interface ColorClasses {
  /** Light tinted background for avatars / chips. */
  bgSoft: string;
  /** Solid colored text. */
  text: string;
  /** Border accent (avatar ring + message left rail). */
  border: string;
  /** Solid filled dot / accent. */
  dot: string;
  /** Soft ring for hover/focus states. */
  ring: string;
  /** working 펄스 링용 — bg/40 페이드. */
  ringPulse: string;
  /** running run 그라디언트 보더의 from/via/to. */
  gradientFrom: string;
  gradientVia: string;
  gradientTo: string;
}

const CLASSES: Record<AgentColor, ColorClasses> = {
  sky: {
    bgSoft: "bg-sky-100 dark:bg-sky-950/50",
    text: "text-sky-700 dark:text-sky-300",
    border: "border-sky-400 dark:border-sky-700",
    dot: "bg-sky-500",
    ring: "ring-sky-200 dark:ring-sky-900/50",
    ringPulse: "bg-sky-400/40 dark:bg-sky-500/40",
    gradientFrom: "from-sky-500",
    gradientVia: "via-cyan-400",
    gradientTo: "to-blue-500",
  },
  emerald: {
    bgSoft: "bg-emerald-100 dark:bg-emerald-950/50",
    text: "text-emerald-700 dark:text-emerald-300",
    border: "border-emerald-400 dark:border-emerald-700",
    dot: "bg-emerald-500",
    ring: "ring-emerald-200 dark:ring-emerald-900/50",
    ringPulse: "bg-emerald-400/40 dark:bg-emerald-500/40",
    gradientFrom: "from-emerald-500",
    gradientVia: "via-teal-400",
    gradientTo: "to-green-500",
  },
  amber: {
    bgSoft: "bg-amber-100 dark:bg-amber-950/50",
    text: "text-amber-700 dark:text-amber-300",
    border: "border-amber-400 dark:border-amber-700",
    dot: "bg-amber-500",
    ring: "ring-amber-200 dark:ring-amber-900/50",
    ringPulse: "bg-amber-400/40 dark:bg-amber-500/40",
    gradientFrom: "from-amber-500",
    gradientVia: "via-yellow-400",
    gradientTo: "to-orange-500",
  },
  rose: {
    bgSoft: "bg-rose-100 dark:bg-rose-950/50",
    text: "text-rose-700 dark:text-rose-300",
    border: "border-rose-400 dark:border-rose-700",
    dot: "bg-rose-500",
    ring: "ring-rose-200 dark:ring-rose-900/50",
    ringPulse: "bg-rose-400/40 dark:bg-rose-500/40",
    gradientFrom: "from-rose-500",
    gradientVia: "via-pink-400",
    gradientTo: "to-red-500",
  },
  violet: {
    bgSoft: "bg-violet-100 dark:bg-violet-950/50",
    text: "text-violet-700 dark:text-violet-300",
    border: "border-violet-400 dark:border-violet-700",
    dot: "bg-violet-500",
    ring: "ring-violet-200 dark:ring-violet-900/50",
    ringPulse: "bg-violet-400/40 dark:bg-violet-500/40",
    gradientFrom: "from-violet-500",
    gradientVia: "via-purple-400",
    gradientTo: "to-indigo-500",
  },
  teal: {
    bgSoft: "bg-teal-100 dark:bg-teal-950/50",
    text: "text-teal-700 dark:text-teal-300",
    border: "border-teal-400 dark:border-teal-700",
    dot: "bg-teal-500",
    ring: "ring-teal-200 dark:ring-teal-900/50",
    ringPulse: "bg-teal-400/40 dark:bg-teal-500/40",
    gradientFrom: "from-teal-500",
    gradientVia: "via-cyan-400",
    gradientTo: "to-emerald-500",
  },
  fuchsia: {
    bgSoft: "bg-fuchsia-100 dark:bg-fuchsia-950/50",
    text: "text-fuchsia-700 dark:text-fuchsia-300",
    border: "border-fuchsia-400 dark:border-fuchsia-700",
    dot: "bg-fuchsia-500",
    ring: "ring-fuchsia-200 dark:ring-fuchsia-900/50",
    ringPulse: "bg-fuchsia-400/40 dark:bg-fuchsia-500/40",
    gradientFrom: "from-fuchsia-500",
    gradientVia: "via-pink-400",
    gradientTo: "to-purple-500",
  },
  lime: {
    bgSoft: "bg-lime-100 dark:bg-lime-950/50",
    text: "text-lime-700 dark:text-lime-300",
    border: "border-lime-400 dark:border-lime-700",
    dot: "bg-lime-500",
    ring: "ring-lime-200 dark:ring-lime-900/50",
    ringPulse: "bg-lime-400/40 dark:bg-lime-500/40",
    gradientFrom: "from-lime-500",
    gradientVia: "via-green-400",
    gradientTo: "to-yellow-500",
  },
  orange: {
    bgSoft: "bg-orange-100 dark:bg-orange-950/50",
    text: "text-orange-700 dark:text-orange-300",
    border: "border-orange-400 dark:border-orange-700",
    dot: "bg-orange-500",
    ring: "ring-orange-200 dark:ring-orange-900/50",
    ringPulse: "bg-orange-400/40 dark:bg-orange-500/40",
    gradientFrom: "from-orange-500",
    gradientVia: "via-amber-400",
    gradientTo: "to-red-500",
  },
  cyan: {
    bgSoft: "bg-cyan-100 dark:bg-cyan-950/50",
    text: "text-cyan-700 dark:text-cyan-300",
    border: "border-cyan-400 dark:border-cyan-700",
    dot: "bg-cyan-500",
    ring: "ring-cyan-200 dark:ring-cyan-900/50",
    ringPulse: "bg-cyan-400/40 dark:bg-cyan-500/40",
    gradientFrom: "from-cyan-500",
    gradientVia: "via-sky-400",
    gradientTo: "to-blue-500",
  },
  red: {
    bgSoft: "bg-red-100 dark:bg-red-950/50",
    text: "text-red-700 dark:text-red-300",
    border: "border-red-400 dark:border-red-700",
    dot: "bg-red-500",
    ring: "ring-red-200 dark:ring-red-900/50",
    ringPulse: "bg-red-400/40 dark:bg-red-500/40",
    gradientFrom: "from-red-500",
    gradientVia: "via-orange-400",
    gradientTo: "to-rose-500",
  },
  yellow: {
    bgSoft: "bg-yellow-100 dark:bg-yellow-950/50",
    text: "text-yellow-700 dark:text-yellow-300",
    border: "border-yellow-400 dark:border-yellow-700",
    dot: "bg-yellow-500",
    ring: "ring-yellow-200 dark:ring-yellow-900/50",
    ringPulse: "bg-yellow-400/40 dark:bg-yellow-500/40",
    gradientFrom: "from-yellow-500",
    gradientVia: "via-amber-400",
    gradientTo: "to-orange-500",
  },
  green: {
    bgSoft: "bg-green-100 dark:bg-green-950/50",
    text: "text-green-700 dark:text-green-300",
    border: "border-green-400 dark:border-green-700",
    dot: "bg-green-500",
    ring: "ring-green-200 dark:ring-green-900/50",
    ringPulse: "bg-green-400/40 dark:bg-green-500/40",
    gradientFrom: "from-green-500",
    gradientVia: "via-emerald-400",
    gradientTo: "to-lime-500",
  },
  blue: {
    bgSoft: "bg-blue-100 dark:bg-blue-950/50",
    text: "text-blue-700 dark:text-blue-300",
    border: "border-blue-400 dark:border-blue-700",
    dot: "bg-blue-500",
    ring: "ring-blue-200 dark:ring-blue-900/50",
    ringPulse: "bg-blue-400/40 dark:bg-blue-500/40",
    gradientFrom: "from-blue-500",
    gradientVia: "via-sky-400",
    gradientTo: "to-indigo-500",
  },
  indigo: {
    bgSoft: "bg-indigo-100 dark:bg-indigo-950/50",
    text: "text-indigo-700 dark:text-indigo-300",
    border: "border-indigo-400 dark:border-indigo-700",
    dot: "bg-indigo-500",
    ring: "ring-indigo-200 dark:ring-indigo-900/50",
    ringPulse: "bg-indigo-400/40 dark:bg-indigo-500/40",
    gradientFrom: "from-indigo-500",
    gradientVia: "via-blue-400",
    gradientTo: "to-violet-500",
  },
  purple: {
    bgSoft: "bg-purple-100 dark:bg-purple-950/50",
    text: "text-purple-700 dark:text-purple-300",
    border: "border-purple-400 dark:border-purple-700",
    dot: "bg-purple-500",
    ring: "ring-purple-200 dark:ring-purple-900/50",
    ringPulse: "bg-purple-400/40 dark:bg-purple-500/40",
    gradientFrom: "from-purple-500",
    gradientVia: "via-violet-400",
    gradientTo: "to-fuchsia-500",
  },
  pink: {
    bgSoft: "bg-pink-100 dark:bg-pink-950/50",
    text: "text-pink-700 dark:text-pink-300",
    border: "border-pink-400 dark:border-pink-700",
    dot: "bg-pink-500",
    ring: "ring-pink-200 dark:ring-pink-900/50",
    ringPulse: "bg-pink-400/40 dark:bg-pink-500/40",
    gradientFrom: "from-pink-500",
    gradientVia: "via-rose-400",
    gradientTo: "to-fuchsia-500",
  },
  slate: {
    bgSoft: "bg-slate-100 dark:bg-slate-900/50",
    text: "text-slate-700 dark:text-slate-300",
    border: "border-slate-400 dark:border-slate-600",
    dot: "bg-slate-500",
    ring: "ring-slate-200 dark:ring-slate-800/50",
    ringPulse: "bg-slate-400/40 dark:bg-slate-500/40",
    gradientFrom: "from-slate-500",
    gradientVia: "via-zinc-400",
    gradientTo: "to-gray-500",
  },
};

export function classesFor(color: AgentColor): ColorClasses {
  return CLASSES[color];
}

/** First non-space character of the name, uppercased. Falls back to "?". */
export function initialFor(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  // Grab the first grapheme cluster naively — works for ASCII + most CJK.
  return trimmed[0]!.toUpperCase();
}
