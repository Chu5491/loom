import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { marked } from "marked";
import { Sparkles } from "lucide-react";
import type { Spec } from "@loom/core";
import { api, type CreateSpecBody, type UpdateSpecBody } from "../api/client.js";
import { Badge, Button, Card, Field, Input, Textarea } from "../components/ui.js";
import { PageScroll } from "../components/PageScroll.js";
import { PageHeader } from "../components/PageHeader.js";
import { useI18n } from "../context/I18nContext.js";
import { useConfirm } from "../components/ConfirmDialog.js";
import { SkillMarketplaceDialog } from "./specs/SkillMarketplaceDialog.js";

marked.setOptions({ breaks: true, gfm: true });

const EMPTY_SPEC: Pick<Spec, "name" | "content" | "tags"> = {
  name: "",
  content: "",
  tags: [],
};

export function SpecsPage() {
  const { t } = useI18n();
  // Skills are now a system-level catalog. Mounted at /skills/:specId.
  const { specId } = useParams<{ specId?: string }>();
  const navigate = useNavigate();
  const isNew = specId === "new";
  const selectedId = !specId || isNew ? null : specId;
  const baseUrl = "/skills";
  const [marketplaceOpen, setMarketplaceOpen] = useState(false);

  const list = useQuery({
    queryKey: ["specs"],
    queryFn: () => api.listSpecs(),
  });

  return (
    <PageScroll className="space-y-4">
      <PageHeader
        title={t("specs.title")}
        description={t("specs.subtitle")}
        action={
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => setMarketplaceOpen(true)}
              className="gap-1.5"
            >
              <Sparkles className="size-3.5" />
              {t("specs.marketplace.button")}
            </Button>
            <Button onClick={() => navigate(`${baseUrl}/new`)}>
              {t("specs.new")}
            </Button>
          </div>
        }
      />
      <SkillMarketplaceDialog
        open={marketplaceOpen}
        onOpenChange={setMarketplaceOpen}
      />

      <div className="grid gap-4 md:grid-cols-[260px_1fr]">
        <SpecList
          specs={list.data?.specs ?? []}
          loading={list.isLoading}
          selectedId={selectedId}
          baseUrl={baseUrl}
        />
        <div>
          {isNew ? (
            <NewSpecEditor key="new" baseUrl={baseUrl} />
          ) : selectedId ? (
            <SpecEditorById key={selectedId} id={selectedId} baseUrl={baseUrl} />
          ) : (
            <Card className="text-sm text-muted-foreground">
              {t("specs.helpUnselected")}
            </Card>
          )}
        </div>
      </div>
    </PageScroll>
  );
}

/** /skills/new 진입 — ?from=<id> 가 있으면 marketplace 에서 prefill.
 *  list metadata 와 detail 본문이 분리돼 있어 두 query 가 필요:
 *    1) list: name/tags 같은 metadata
 *    2) content: SKILL.md 본문 (skills.sh 면 lazy fetch, builtin 이면 즉시) */
function NewSpecEditor({ baseUrl }: { baseUrl: string }) {
  const [params] = useSearchParams();
  const fromId = params.get("from");

  const marketplace = useQuery({
    queryKey: ["skill-marketplace", "all"] as const,
    queryFn: () => api.listSkillMarketplace("all"),
    enabled: !!fromId,
    staleTime: 60 * 60_000,
  });

  const detail = useQuery({
    queryKey: ["skill-marketplace-content", fromId] as const,
    queryFn: () => api.getSkillMarketplaceContent(fromId!),
    enabled: !!fromId,
    staleTime: 60 * 60_000,
    retry: false,
  });

  const prefill = useMemo<CreateSpecBody | null>(() => {
    if (!fromId) return null;
    const entry = marketplace.data?.entries.find((e) => e.id === fromId);
    if (!entry) return null;
    return {
      name: entry.name,
      content: detail.data?.content ?? entry.content ?? "",
      tags: entry.tags,
    };
  }, [fromId, marketplace.data?.entries, detail.data?.content]);

  // 둘 다 끝나야 prefill 안정 — 깜빡임 방지.
  if (fromId && (marketplace.isLoading || detail.isLoading)) return null;
  return <SpecEditor spec={null} baseUrl={baseUrl} prefill={prefill} />;
}

function SpecList({
  specs,
  loading,
  selectedId,
  baseUrl,
}: {
  specs: Spec[];
  loading: boolean;
  selectedId: string | null;
  baseUrl: string;
}) {
  const { t } = useI18n();
  if (loading) {
    return <p className="text-muted-foreground text-sm">{t("common.loading")}</p>;
  }
  if (specs.length === 0) {
    return (
      <Card className="text-sm text-muted-foreground">
        {t("specs.empty")}
      </Card>
    );
  }
  return (
    <div className="space-y-1">
      {specs.map((s) => (
        <Link
          key={s.id}
          to={`${baseUrl}/${s.id}`}
          className={
            "block rounded-md border px-3 py-2 transition-colors " +
            (selectedId === s.id
              ? "border-zinc-400 bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-800/60"
              : "border-zinc-200 bg-zinc-50/50 hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900/50 dark:hover:border-zinc-700")
          }
        >
          <div className="text-sm truncate font-medium">
            {s.name || t("common.untitled")}
          </div>
          {s.tags.length > 0 ? (
            <div className="mt-1 flex flex-wrap gap-1">
              {s.tags.map((tg) => (
                <Badge key={tg} tone="neutral">
                  {tg}
                </Badge>
              ))}
            </div>
          ) : null}
          <div className="mt-1 text-[10px] text-muted-foreground mono">
            {new Date(s.updatedAt).toLocaleString()}
          </div>
        </Link>
      ))}
    </div>
  );
}

function SpecEditorById({ id, baseUrl }: { id: string; baseUrl: string }) {
  const { t } = useI18n();
  const q = useQuery({ queryKey: ["spec", id], queryFn: () => api.getSpec(id) });
  if (q.isLoading) return <p className="text-muted-foreground text-sm">{t("common.loading")}</p>;
  if (q.isError) return <p className="text-destructive text-sm">{q.error.message}</p>;
  if (!q.data) return null;
  return <SpecEditor spec={q.data.spec} baseUrl={baseUrl} />;
}

function SpecEditor({
  spec,
  baseUrl,
  prefill,
}: {
  spec: Spec | null;
  baseUrl: string;
  /** 새 spec 만들 때 marketplace 같은 외부 소스에서 미리 채워줄 값. spec 이
   *  null 일 때만 의미. */
  prefill?: CreateSpecBody | null;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const navigate = useNavigate();

  const seed = spec ?? prefill ?? null;

  const [name, setName] = useState(seed?.name ?? EMPTY_SPEC.name);
  const [content, setContent] = useState(seed?.content ?? EMPTY_SPEC.content);
  const [tagsInput, setTagsInput] = useState(
    (seed?.tags ?? EMPTY_SPEC.tags).join(", "),
  );
  const [view, setView] = useState<"edit" | "preview" | "split">("split");

  useEffect(() => {
    if (spec) {
      setName(spec.name);
      setContent(spec.content);
      setTagsInput(spec.tags.join(", "));
    }
  }, [spec?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const tags = useMemo(
    () =>
      tagsInput
        .split(",")
        .map((tg) => tg.trim())
        .filter(Boolean),
    [tagsInput],
  );

  const create = useMutation({
    mutationFn: (body: CreateSpecBody) => api.createSpec(body),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["specs"] });
      navigate(`${baseUrl}/${data.spec.id}`);
    },
  });

  const update = useMutation({
    mutationFn: (body: UpdateSpecBody) => api.updateSpec(spec!.id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["specs"] });
      qc.invalidateQueries({ queryKey: ["spec", spec!.id] });
    },
  });

  const remove = useMutation({
    mutationFn: () => api.deleteSpec(spec!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["specs"] });
      navigate(baseUrl);
    },
  });

  const isDirty = spec
    ? spec.name !== name ||
      spec.content !== content ||
      spec.tags.join(",") !== tags.join(",")
    : !!(name || content || tags.length);

  const html = useMemo(() => {
    try {
      return marked.parse(content || t("specs.preview.empty")) as string;
    } catch {
      return `<p>${t("specs.preview.error")}</p>`;
    }
  }, [content, t]);

  return (
    <Card className="space-y-4">
      <Field label={t("specs.field.name")}>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("specs.placeholder.name")}
        />
      </Field>

      <Field label={t("specs.field.tags")}>
        <Input
          value={tagsInput}
          onChange={(e) => setTagsInput(e.target.value)}
          placeholder={t("specs.placeholder.tags")}
        />
      </Field>

      <div className="flex items-center justify-between">
        <Field label={t("specs.field.content")}>
          <span />
        </Field>
        <div className="flex rounded-md border border-zinc-300 dark:border-zinc-800 overflow-hidden text-xs">
          {(["edit", "split", "preview"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={
                "px-2 py-1 transition-colors " +
                (view === v
                  ? "bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
                  : "text-muted-foreground hover:text-zinc-900 dark:text-muted-foreground/80 dark:hover:text-zinc-100")
              }
            >
              {v === "edit"
                ? t("common.edit")
                : v === "preview"
                  ? t("common.preview")
                  : t("common.split")}
            </button>
          ))}
        </div>
      </div>

      <div
        className={
          view === "split" ? "grid gap-3 md:grid-cols-2" : "grid grid-cols-1"
        }
      >
        {view !== "preview" ? (
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={20}
            className="min-h-[400px]"
            placeholder={t("specs.placeholder.content")}
          />
        ) : null}
        {view !== "edit" ? (
          <div
            className="min-h-[400px] rounded-md border p-4 prose-loom border-zinc-200 bg-zinc-50/50 dark:border-zinc-800 dark:bg-zinc-950"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : null}
      </div>

      {(create.error || update.error || remove.error) && (
        <p className="text-xs text-destructive">
          {(create.error ?? update.error ?? remove.error)?.message}
        </p>
      )}

      <div className="flex items-center justify-between">
        <div>
          {spec ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                const ok = await confirm({
                  title: t("specs.deleteConfirm", { name: spec.name }),
                  destructive: true,
                });
                if (ok) remove.mutate();
              }}
              disabled={remove.isPending}
            >
              {remove.isPending ? t("common.deleting") : t("common.delete")}
            </Button>
          ) : null}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {isDirty ? <span>{t("common.unsaved")}</span> : <span>{t("common.saved")}</span>}
          <Button
            disabled={
              !name ||
              !isDirty ||
              create.isPending ||
              update.isPending
            }
            onClick={() => {
              // Skills are system-level — agentId is dropped from the body.
              // Assignment to specific agents now happens via AgentForm's
              // multi-select (writes to agent_skills join).
              const body = { name, content, tags };
              if (spec) update.mutate(body);
              else create.mutate(body);
            }}
          >
            {create.isPending || update.isPending
              ? t("common.saving")
              : spec
                ? t("specs.button.saveChanges")
                : t("specs.button.createSpec")}
          </Button>
        </div>
      </div>
    </Card>
  );
}
