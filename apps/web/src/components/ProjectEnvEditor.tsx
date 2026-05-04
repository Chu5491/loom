// 프로젝트 단위 환경변수 편집기. 같은 프로젝트의 모든 에이전트 run에 공통 주입.
// 에이전트의 adapterConfig.env가 더 우선순위가 높음 — 여기는 base secret 보관용.
//
// 에디터 패턴: 일괄 PUT (loadedEnv 스냅샷과 비교해 dirty 플래그). 저장 전엔 빈
// key를 자동으로 거름. 값은 마스킹 토글로 시야 보호.

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Eye, EyeOff, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "../api/client.js";
import { Button, Input } from "./ui.js";
import { useI18n } from "../context/I18nContext.js";
import { cn } from "../lib/utils.js";

interface Row {
  key: string;
  value: string;
}

export function ProjectEnvEditor({ projectId }: { projectId: string }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);

  const q = useQuery({
    queryKey: ["projectEnv", projectId],
    queryFn: () => api.getProjectEnv(projectId),
    enabled: !!projectId,
  });

  // 서버 응답으로 로컬 state 동기화. 사용자가 편집 중에 다른 곳에서 갱신되면
  // 더러운 상태가 사라지지 않도록 dirty 비교 후 안전한 시점에만 sync.
  useEffect(() => {
    if (!q.data) return;
    const fresh = Object.entries(q.data.env).map(([key, value]) => ({
      key,
      value,
    }));
    setRows(fresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data?.env]);

  const save = useMutation({
    mutationFn: (env: Record<string, string>) =>
      api.setProjectEnv(projectId, env),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projectEnv", projectId] });
      toast.success(t("projectEnv.toast.saved"));
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : String(err)),
  });

  const original = useMemo(() => {
    return Object.entries(q.data?.env ?? {})
      .map(([k, v]) => `${k}=${v}`)
      .sort()
      .join("\n");
  }, [q.data?.env]);
  const current = useMemo(
    () =>
      rows
        .filter((r) => r.key.trim())
        .map((r) => `${r.key.trim()}=${r.value}`)
        .sort()
        .join("\n"),
    [rows],
  );
  const dirty = original !== current;

  const onSave = () => {
    const env: Record<string, string> = {};
    for (const r of rows) {
      const k = r.key.trim();
      if (!k) continue;
      env[k] = r.value;
    }
    save.mutate(env);
  };

  const count = Object.keys(q.data?.env ?? {}).length;

  return (
    <div className="rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/40 transition-colors rounded-lg"
      >
        {open ? (
          <ChevronDown className="size-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-4 text-muted-foreground" />
        )}
        <span className="text-sm font-medium">{t("projectEnv.title")}</span>
        <span className="text-xs text-muted-foreground mono">
          {t("projectEnv.count", { n: count })}
        </span>
        {dirty ? (
          <span className="ml-auto text-[10px] text-amber-600 dark:text-amber-400 mono">
            {t("common.unsaved")}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="px-3 pb-3 space-y-2 border-t border-border/60">
          <p className="pt-2 text-xs text-muted-foreground">
            {t("projectEnv.hint")}
          </p>
          <div className="space-y-1">
            {rows.length === 0 ? (
              <p className="text-xs text-muted-foreground/70 italic py-2">
                {t("projectEnv.empty")}
              </p>
            ) : null}
            {rows.map((row, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <Input
                  value={row.key}
                  onChange={(e) =>
                    setRows((rs) => {
                      const next = [...rs];
                      next[i] = { ...next[i]!, key: e.target.value };
                      return next;
                    })
                  }
                  placeholder="KEY"
                  className="mono text-xs flex-[1] min-w-0"
                />
                <span className="text-muted-foreground/40 mono">=</span>
                <Input
                  type={reveal ? "text" : "password"}
                  value={row.value}
                  onChange={(e) =>
                    setRows((rs) => {
                      const next = [...rs];
                      next[i] = { ...next[i]!, value: e.target.value };
                      return next;
                    })
                  }
                  placeholder="value"
                  className="mono text-xs flex-[2] min-w-0"
                />
                <button
                  type="button"
                  onClick={() =>
                    setRows((rs) => rs.filter((_, j) => j !== i))
                  }
                  title={t("common.remove")}
                  aria-label={t("common.remove")}
                  className="inline-flex size-7 items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-1.5 pt-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setRows((rs) => [...rs, { key: "", value: "" }])}
              className="gap-1"
            >
              <Plus className="size-3.5" />
              {t("projectEnv.add")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setReveal((v) => !v)}
              className="gap-1"
              aria-pressed={reveal}
            >
              {reveal ? (
                <EyeOff className="size-3.5" />
              ) : (
                <Eye className="size-3.5" />
              )}
              {reveal ? t("projectEnv.mask") : t("projectEnv.reveal")}
            </Button>
            <span className="ml-auto" />
            <Button
              variant="primary"
              size="sm"
              disabled={!dirty || save.isPending}
              onClick={onSave}
              className={cn(!dirty && "opacity-50")}
            >
              {save.isPending ? t("common.saving") : t("common.save")}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
