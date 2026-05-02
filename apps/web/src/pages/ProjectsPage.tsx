import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { celebrate } from "../lib/celebrate.js";
import { useConfirm } from "../components/ConfirmDialog.js";
import type { Project } from "@loom/core";
import { api, type CreateProjectBody } from "../api/client.js";
import { Button, Card, Field, Input, Textarea } from "../components/ui.js";
import { Skeleton } from "../components/ui/skeleton.js";
import { PageScroll } from "../components/PageScroll.js";
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
      celebrate("firstProject");
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
  const agents = useQuery({
    queryKey: ["agents", { projectId: project.id }],
    queryFn: () => api.listAgents({ projectId: project.id }),
  });
  const agentCount = agents.data?.agents.length ?? 0;

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
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <Link
          to={`/projects/${project.id}`}
          className="hover:underline"
        >
          {t("projects.agentsLink", { count: agentCount })}
        </Link>
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
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button
          disabled={submitting || !name || !path}
          onClick={() =>
            onSubmit({ name, path, description: description || null })
          }
        >
          {submitting ? t("common.creating") : t("common.create")}
        </Button>
      </div>
    </Card>
  );
}
