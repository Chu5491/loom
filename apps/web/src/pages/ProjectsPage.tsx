import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import type { Project } from "@loom/core";
import { api, type CreateProjectBody } from "../api/client.js";
import { Button, Card, Field, Input, Textarea } from "../components/ui.js";
import { useI18n } from "../context/I18nContext.js";

export function ProjectsPage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["projects"], queryFn: api.listProjects });

  const [showForm, setShowForm] = useState(false);

  const create = useMutation({
    mutationFn: api.createProject,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      setShowForm(false);
    },
  });

  const remove = useMutation({
    mutationFn: api.deleteProject,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });

  return (
    <div className="space-y-6">
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
          error={create.error?.message ?? null}
          onCancel={() => setShowForm(false)}
        />
      ) : null}

      {list.isLoading ? (
        <p className="text-zinc-500 text-sm">{t("common.loading")}</p>
      ) : list.isError ? (
        <p className="text-red-500 dark:text-red-400 text-sm">
          {list.error.message}
        </p>
      ) : list.data!.projects.length === 0 ? (
        <Card>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {t("projects.empty")}
          </p>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {list.data!.projects.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              onDelete={() => {
                if (
                  confirm(
                    t("projects.deleteConfirm", { name: p.name }),
                  )
                ) {
                  remove.mutate(p.id);
                }
              }}
            />
          ))}
        </div>
      )}
    </div>
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
            to={`/agents?projectId=${project.id}`}
            className="font-medium hover:underline truncate block"
          >
            {project.name}
          </Link>
          <p className="text-xs text-zinc-500 mono truncate" title={project.path}>
            {project.path}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onDelete}>
          {t("common.delete")}
        </Button>
      </div>
      {project.description ? (
        <p className="text-xs text-zinc-600 dark:text-zinc-400 line-clamp-2">
          {project.description}
        </p>
      ) : null}
      <div className="flex items-center gap-3 text-xs text-zinc-500">
        <Link
          to={`/agents?projectId=${project.id}`}
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
  error,
  onCancel,
}: {
  onSubmit: (body: CreateProjectBody) => void;
  submitting: boolean;
  error: string | null;
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
            placeholder="/Users/me/projects/foo"
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
      {error ? (
        <p className="text-xs text-red-500 dark:text-red-400">{error}</p>
      ) : null}
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
