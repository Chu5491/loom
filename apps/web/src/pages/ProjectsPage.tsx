import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { ExternalLink } from "lucide-react";
import { useConfirm } from "../components/ConfirmDialog.js";
import type { PreferredEditor, Project } from "@loom/core";
import { api, type CreateProjectBody } from "../api/client.js";
import { Button, Card, Field, Input, Textarea } from "../components/ui.js";
import { Skeleton } from "../components/ui/skeleton.js";
import { PageScroll } from "../components/PageScroll.js";
import { EditorPicker, editorLabel } from "../components/EditorPicker.js";
import { useI18n } from "../context/I18nContext.js";

export function ProjectsPage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const list = useQuery({ queryKey: ["projects"], queryFn: api.listProjects });

  const [showForm, setShowForm] = useState(false);

  const create = useMutation({
    mutationFn: api.createProject,
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      setShowForm(false);
      toast.success(t("projects.toast.created", { name: r.project.name }));
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : String(err)),
  });

  const remove = useMutation({
    mutationFn: api.deleteProject,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      toast.success(t("projects.toast.deleted"));
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : String(err)),
  });

  return (
    <PageScroll className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t("projects.title")}</h1>
        <Button onClick={() => setShowForm((s) => !s)}>
          {showForm ? t("common.cancel") : t("projects.new")}
        </Button>
      </div>

      {showForm ? (
        <CreateProjectForm
          onSubmit={(body) => create.mutate(body)}
          submitting={create.isPending}
          onCancel={() => setShowForm(false)}
        />
      ) : null}

      {list.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="rounded-lg border border-border bg-card p-4 space-y-2"
            >
              <Skeleton className="h-5 w-44" />
              <Skeleton className="h-3 w-64 max-w-full" />
              <Skeleton className="h-3 w-28" />
            </div>
          ))}
        </div>
      ) : list.isError ? (
        <p className="text-destructive text-sm">
          {list.error.message}
        </p>
      ) : list.data!.projects.length === 0 ? (
        <Card>
          <p className="text-sm text-muted-foreground">
            {t("projects.empty")}
          </p>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {list.data!.projects.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              onDelete={async () => {
                const ok = await confirm({
                  title: t("projects.deleteConfirm", { name: p.name }),
                  destructive: true,
                });
                if (ok) remove.mutate(p.id);
              }}
            />
          ))}
        </div>
      )}
    </PageScroll>
  );
}

function ProjectCard({
  project,
  onDelete,
}: {
  project: Project;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const agents = useQuery({
    queryKey: ["agents", { projectId: project.id }],
    queryFn: () => api.listAgents({ projectId: project.id }),
  });
  const agentCount = agents.data?.agents.length ?? 0;

  const setEditor = useMutation({
    mutationFn: (editor: PreferredEditor) =>
      api.updateProject(project.id, { preferredEditor: editor }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : String(err)),
  });

  const openInIde = useMutation({
    mutationFn: () => api.openInEditor(project.id, {}),
    onSuccess: (r) =>
      toast.success(
        t("projects.openedIn", { editor: editorLabel(r.editor) }),
      ),
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : String(err)),
  });

  return (
    <Card className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <Link
            to={`/projects/${project.id}`}
            className="font-medium hover:underline truncate block"
          >
            {project.name}
          </Link>
          <p className="text-xs text-muted-foreground mono truncate" title={project.path}>
            {project.path}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onDelete}>
          {t("common.delete")}
        </Button>
      </div>
      {project.description ? (
        <p className="text-xs text-muted-foreground line-clamp-2">
          {project.description}
        </p>
      ) : null}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Link
          to={`/projects/${project.id}`}
          className="hover:underline"
        >
          {t("projects.agentsLink", { count: agentCount })}
        </Link>
        <span className="text-border">·</span>
        {/* IDE picker — quick PATCH on change. 새 IDE를 골라도 하단의 "Open" 버튼은
            즉시 새 값으로 동작 (mutation 성공 후 query 무효화 → project 재조회). */}
        <EditorPicker
          value={project.preferredEditor}
          onChange={(next) => setEditor.mutate(next)}
          className="h-7 w-auto px-2 text-xs"
        />
        <Button
          variant="secondary"
          size="sm"
          className="ml-auto h-7 gap-1"
          disabled={openInIde.isPending}
          onClick={() => openInIde.mutate()}
          title={t("projects.openIn", {
            editor: editorLabel(project.preferredEditor),
          })}
        >
          <ExternalLink className="size-3.5" />
          {t("projects.open")}
        </Button>
      </div>
    </Card>
  );
}

function CreateProjectForm({
  onSubmit,
  submitting,
  onCancel,
}: {
  onSubmit: (body: CreateProjectBody) => void;
  submitting: boolean;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [description, setDescription] = useState("");
  const [editor, setEditor] = useState<PreferredEditor>("vscode");

  return (
    <Card className="space-y-4">
      <h2 className="font-medium">{t("projects.new")}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("projects.field.name")}>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("projects.placeholder.name")}
          />
        </Field>
        <Field
          label={t("projects.field.path")}
          hint={t("projects.field.pathHint")}
        >
          <Input
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder={t("projects.placeholder.path")}
            className="mono"
          />
        </Field>
      </div>
      <Field label={t("projects.field.description")}>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder={t("projects.placeholder.description")}
        />
      </Field>
      <Field label={t("projects.field.editor")} hint={t("projects.field.editorHint")}>
        <EditorPicker value={editor} onChange={setEditor} className="h-9" />
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button
          disabled={submitting || !name || !path}
          onClick={() =>
            onSubmit({
              name,
              path,
              description: description || null,
              preferredEditor: editor,
            })
          }
        >
          {submitting ? t("common.creating") : t("common.create")}
        </Button>
      </div>
    </Card>
  );
}
