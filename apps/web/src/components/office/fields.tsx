// Office 디테일 편집기 공용 프리미티브 — 필드 라벨/세그먼트/저장줄/칩/마크다운 등.
// 각 디테일(AgentDetail 등)이 import 해 폼을 조립한다.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Eye } from "lucide-react";
import type { AdapterKind, Office } from "@loom/core";
import { api } from "../../api/client.js";
import { AgentAvatar } from "../AgentAvatar.js";
import { Markdown } from "../Markdown.js";
import { Button } from "../ui.js";
import { useI18n } from "../../context/I18nContext.js";
import { useConfirm } from "../../context/DialogContext.js";
import { cn } from "../../lib/utils.js";
import type { Selection } from "./shared.js";
import { inputCls, areaCls } from "./shared.js";

export function UsedByBar({
  kind,
  name,
  office,
  onSelect,
}: {
  kind: "rule" | "skill" | "mcp";
  name: string;
  office: Office;
  onSelect: (s: Selection) => void;
}) {
  const { t } = useI18n();
  const users = office.agents.filter((a) => (a[kind === "rule" ? "rules" : kind === "skill" ? "skills" : "mcp"] ?? []).includes(name));
  return (
    <div className="mb-5 flex flex-wrap items-center gap-2 rounded-xl border border-border/40 bg-muted/20 px-3 py-2">
      <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{t("office.usedBy.label")}</span>
      {users.length === 0 ? (
        <span className="text-xs text-muted-foreground/70">{t("office.usedBy.none")}</span>
      ) : (
        users.map((u) => (
          <button
            key={u.name}
            type="button"
            onClick={() => onSelect({ kind: "agent", name: u.name })}
            className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card px-2 py-0.5 text-xs transition-colors hover:border-primary/40 hover:bg-primary/5"
          >
            <AgentAvatar adapter={u.adapter} size={14} className="rounded-full" />
            <span className="font-medium">{u.label || u.name}</span>
          </button>
        ))
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Reused primitives
// ─────────────────────────────────────────────────────────────────────────────

export function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="mb-1.5 block text-xs font-medium text-muted-foreground">{children}</span>;
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T | undefined;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-md px-3 py-1 text-xs font-medium transition-colors",
            value === o.value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function SaveRow({ onSave, pending, saved }: { onSave: () => void; pending: boolean; saved?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="mt-6 flex items-center justify-end gap-3">
      {saved && !pending ? (
        <span className="flex items-center gap-1 text-xs font-medium text-primary">
          <Check className="size-3.5" />
          {t("office.saved")}
        </span>
      ) : null}
      <Button size="sm" onClick={onSave} disabled={pending}>
        {pending ? t("office.saving") : t("office.save")}
      </Button>
    </div>
  );
}

// 합성 프롬프트 프리뷰 — run 시작 시 CLI 에 실제 들어갈 텍스트(규약 + 지침 + loadout 인덱스).
export function PromptPreview({ agent }: { agent: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ["runPreview", agent],
    queryFn: () => api.previewRun({ agent }),
    enabled: open,
    staleTime: 0,
  });
  return (
    <div className="mb-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
      >
        <Eye className="size-3" />
        {open ? t("office.agent.previewHide") : t("office.agent.preview")}
      </button>
      {open ? (
        q.isLoading ? (
          <p className="mt-2 text-xs text-muted-foreground">…</p>
        ) : q.isError ? (
          <p className="mt-2 text-xs text-destructive">{q.error instanceof Error ? q.error.message : String(q.error)}</p>
        ) : (
          <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg border border-border/60 bg-muted/30 px-3 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
            {q.data?.prompt}
          </pre>
        )
      ) : null}
    </div>
  );
}

export function ModelField({ adapter, value, onChange }: { adapter: AdapterKind; value?: string; onChange: (v: string | undefined) => void }) {
  const { t } = useI18n();
  const models = useQuery({
    queryKey: ["models", adapter],
    queryFn: () => api.listAdapterModels(adapter),
    staleTime: 5 * 60_000,
  });
  const list = models.data?.models.models ?? [];
  const known = new Set(list.map((m) => m.value));
  const [custom, setCustom] = useState(!!value && !known.has(value) && list.length > 0);

  const grouped = new Map<string, typeof list>();
  for (const m of list) {
    const g = m.category ?? "";
    if (!grouped.has(g)) grouped.set(g, []);
    grouped.get(g)!.push(m);
  }

  if (custom || (value && !known.has(value) && list.length === 0)) {
    return (
      <div className="flex gap-1.5">
        <input className={cn(inputCls, "font-mono")} value={value ?? ""} placeholder="claude-fable-5" onChange={(e) => onChange(e.target.value || undefined)} />
        {list.length > 0 ? (
          <button
            type="button"
            onClick={() => {
              setCustom(false);
              onChange(undefined);
            }}
            className="shrink-0 rounded-lg border border-border px-2 text-xs text-muted-foreground hover:bg-muted/60"
          >
            ↩
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <select
      className={cn(inputCls, "font-mono")}
      value={value ?? ""}
      onChange={(e) => {
        if (e.target.value === "__custom") {
          setCustom(true);
          return;
        }
        onChange(e.target.value || undefined);
      }}
    >
      <option value="">{t("office.agent.model.default")}</option>
      {[...grouped.entries()].map(([g, items]) =>
        g ? (
          <optgroup key={g} label={g}>
            {items.map((m) => (
              <option key={m.value} value={m.value}>
                {m.value}
              </option>
            ))}
          </optgroup>
        ) : (
          items.map((m) => (
            <option key={m.value} value={m.value}>
              {m.value}
            </option>
          ))
        ),
      )}
      <option value="__custom">{t("office.agent.model.custom")}</option>
    </select>
  );
}

export function Chips({ label, all, selected, onToggle }: { label: string; all: string[]; selected: string[]; onToggle: (n: string) => void }) {
  const { t } = useI18n();
  return (
    <div className="mt-3 first:mt-0">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {all.length === 0 ? (
          <span className="text-xs text-muted-foreground/70">{t("office.empty")}</span>
        ) : (
          all.map((n) => {
            const on = selected.includes(n);
            return (
              <button
                key={n}
                type="button"
                onClick={() => onToggle(n)}
                className={cn(
                  "rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors",
                  on ? "border-primary/50 bg-primary/15 text-foreground" : "border-border text-muted-foreground hover:bg-muted/60",
                )}
              >
                {on ? "✓ " : ""}
                {n}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

// 마크다운 본문 편집기 — Edit/Preview 토글. value/onChange 로 제어되며,
// 부모가 저장 시점에 value 를 그대로 보낸다(기존 textarea#id 패턴 폐기).
export function MarkdownField({
  value,
  onChange,
  placeholder,
  minH = "min-h-32",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  minH?: string;
}) {
  const { t } = useI18n();
  const [mode, setMode] = useState<"edit" | "preview">(value.trim() ? "preview" : "edit");
  return (
    <div>
      <div className="mb-1.5 inline-flex rounded-lg border border-border bg-muted/40 p-0.5">
        {(["preview", "edit"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={cn(
              "rounded-md px-2.5 py-0.5 text-xs font-medium transition-colors",
              mode === m ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t(`office.md.${m}`)}
          </button>
        ))}
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(areaCls, minH, mode === "preview" && "hidden")}
      />
      {mode === "preview" ? (
        value.trim() ? (
          <div className="rounded-lg border border-border bg-background px-3.5 py-2.5">
            <Markdown>{value}</Markdown>
          </div>
        ) : (
          <p className="py-2 text-xs text-muted-foreground">{t("office.md.empty")}</p>
        )
      ) : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Skill files editor (ops 로 저장소 추상화)
// ─────────────────────────────────────────────────────────────────────────────

export interface SkillFileOps {
  list: string[];
  read: (path: string) => Promise<string>;
  write: (path: string, content: string) => Promise<void>;
  remove: (path: string) => Promise<void>;
}

export function SkillFiles({ ops }: { ops: SkillFileOps }) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<string | null>(null);
  const [pathInput, setPathInput] = useState("");
  const [content, setContent] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function run(fn: () => Promise<void>) {
    setPending(true);
    setErr(null);
    try {
      await fn();
      setEditing(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }

  async function openFile(f: string) {
    setErr(null);
    setPathInput(f);
    try {
      setContent(await ops.read(f));
      setEditing(f);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="mt-3">
      <span className="text-xs font-medium text-muted-foreground">{t("office.skill.files")}</span>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {ops.list.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => void openFile(f)}
            className={cn(
              "rounded-md border px-1.5 py-0.5 font-mono text-[11px] transition-colors",
              editing === f ? "border-primary/50 bg-primary/10 text-foreground" : "border-border bg-muted/40 text-muted-foreground hover:text-foreground",
            )}
          >
            {f}
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            setEditing("__new");
            setPathInput("");
            setContent("");
            setErr(null);
          }}
          className="rounded-md border border-dashed border-border px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
        >
          + {t("office.skill.file.add")}
        </button>
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground">{t("office.skill.files.hint")}</p>

      {editing ? (
        <div className="mt-2 rounded-lg border border-border bg-background p-3">
          <input
            className={cn(inputCls, "max-w-72 font-mono text-xs")}
            value={pathInput}
            placeholder="reference.md · docs/guide.md"
            readOnly={editing !== "__new"}
            autoFocus={editing === "__new"}
            onChange={(e) => setPathInput(e.target.value.replace(/[^a-zA-Z0-9._/-]/g, ""))}
          />
          <textarea className={cn(areaCls, "mt-2 min-h-32")} value={content} placeholder="# File contents" onChange={(e) => setContent(e.target.value)} />
          {err ? <p className="mt-1 text-xs text-destructive">{err}</p> : null}
          <div className="mt-2 flex items-center justify-end gap-2">
            {editing !== "__new" ? (
              <button
                type="button"
                onClick={async () => { if (await confirm({ body: t("office.deleteConfirm", { name: editing }), tone: "danger", confirmLabel: t("common.delete") })) void run(() => ops.remove(editing)); }}
                className="text-xs text-muted-foreground transition-colors hover:text-destructive"
              >
                {t("office.skill.file.delete")}
              </button>
            ) : null}
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setEditing(null);
                setErr(null);
              }}
            >
              {t("office.skill.file.cancel")}
            </Button>
            <Button size="sm" disabled={!pathInput.trim() || pending} onClick={() => void run(() => ops.write(pathInput.trim(), content))}>
              {pending ? t("office.saving") : t("office.save")}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
