import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { marked } from "marked";
import type { Spec } from "@loom/core";
import { api, type CreateSpecBody, type UpdateSpecBody } from "../api/client.js";
import { Badge, Button, Card, Field, Input, Textarea } from "../components/ui.js";
import { PageScroll } from "../components/PageScroll.js";
import { PageHeader } from "../components/PageHeader.js";
import { useI18n } from "../context/I18nContext.js";
import { useConfirm } from "../components/ConfirmDialog.js";

marked.setOptions({ breaks: true, gfm: true });

const EMPTY_SPEC: Pick<Spec, "name" | "content" | "agentId" | "tags"> = {
  name: "",
  content: "",
  agentId: null,
  tags: [],
};

export function SpecsPage() {
  const { t } = useI18n();
  // Nested under /projects/:id/skills/:specId? — both ids come through.
  const { id: projectId, specId } = useParams<{ id: string; specId?: string }>();
  const navigate = useNavigate();
  const isNew = specId === "new";
  const selectedId = !specId || isNew ? null : specId;
  const baseUrl = `/projects/${projectId}/skills`;

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
          <Button onClick={() => navigate(`${baseUrl}/new`)}>
            {t("specs.new")}
          </Button>
        }
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
            <SpecEditor key="new" spec={null} baseUrl={baseUrl} />
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

function SpecEditor({ spec, baseUrl }: { spec: Spec | null; baseUrl: string }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const agents = useQuery({ queryKey: ["agents"], queryFn: () => api.listAgents() });

  const [name, setName] = useState(spec?.name ?? EMPTY_SPEC.name);
  const [content, setContent] = useState(spec?.content ?? EMPTY_SPEC.content);
  const [tagsInput, setTagsInput] = useState((spec?.tags ?? EMPTY_SPEC.tags).join(", "));
  const [agentId, setAgentId] = useState<string | null>(spec?.agentId ?? null);
  const [view, setView] = useState<"edit" | "preview" | "split">("split");

  useEffect(() => {
    if (spec) {
      setName(spec.name);
      setContent(spec.content);
      setTagsInput(spec.tags.join(", "));
      setAgentId(spec.agentId);
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
      spec.tags.join(",") !== tags.join(",") ||
      (spec.agentId ?? null) !== (agentId ?? null)
    : !!(name || content || tags.length || agentId);

  const html = useMemo(() => {
    try {
      return marked.parse(content || t("specs.preview.empty")) as string;
    } catch {
      return `<p>${t("specs.preview.error")}</p>`;
    }
  }, [content, t]);

  return (
    <Card className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-[1fr_auto] items-end">
        <Field label={t("specs.field.name")}>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("specs.placeholder.name")}
          />
        </Field>
        <Field label={t("specs.field.linkedAgent")}>
          <select
            className="h-9 rounded-md border px-2 text-sm border-zinc-300 bg-white text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
            value={agentId ?? ""}
            onChange={(e) => setAgentId(e.target.value || null)}
          >
            <option value="">{t("specs.field.linkedAgent.none")}</option>
            {(agents.data?.agents ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

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
              const body = { name, content, tags, agentId };
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
