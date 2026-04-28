import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, NavLink, Outlet, useNavigate, useParams } from "react-router-dom";
import type { Project } from "@loom/core";
import { api } from "../api/client.js";
import { Button, Card, Field, Input, Textarea } from "./ui.js";
import { useI18n } from "../context/I18nContext.js";

/**
 * Layout shell for everything under /projects/:id. Owns the project header
 * (with edit/delete) and the sub-nav (Overview / Agents / Specs / Runs).
 * Each tab renders into the <Outlet />.
 */
export function ProjectShell() {
  const { t } = useI18n();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const project = useQuery({
    queryKey: ["project", id],
    queryFn: () => api.getProject(id!),
    enabled: !!id,
  });

  const remove = useMutation({
    mutationFn: () => api.deleteProject(id!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      navigate("/projects");
    },
  });

  if (project.isLoading) {
    return <p className="text-zinc-500 text-sm">{t("common.loading")}</p>;
  }
  if (project.isError || !project.data) {
    return (
      <Card>
        <p className="text-sm text-red-500 dark:text-red-400">
          {project.error?.message ?? t("common.notFound")}
        </p>
        <Link
          to="/projects"
          className="mt-2 inline-block text-sm text-sky-600 hover:underline dark:text-sky-300"
        >
          {t("projectDetail.backToProjects")}
        </Link>
      </Card>
    );
  }

  const p = project.data.project;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm">
        <Link
          to="/projects"
          className="text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          ← {t("nav.projects")}
        </Link>
      </div>

      <ProjectHeader
        project={p}
        onDelete={() => {
          if (confirm(t("projects.deleteConfirm", { name: p.name }))) {
            remove.mutate();
          }
        }}
      />

      <ProjectSubNav projectId={p.id} />

      <Outlet />
    </div>
  );
}

function ProjectSubNav({ projectId }: { projectId: string }) {
  const { t } = useI18n();
  const tabs = [
    { to: `/projects/${projectId}`, label: t("projectShell.tab.room"), end: true },
    { to: `/projects/${projectId}/agents`, label: t("projectShell.tab.agents") },
    { to: `/projects/${projectId}/specs`, label: t("projectShell.tab.specs") },
    { to: `/projects/${projectId}/runs`, label: t("projectShell.tab.runs") },
  ];
  return (
    <nav className="flex items-center gap-1 border-b border-zinc-200 dark:border-zinc-800">
      {tabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.end}
          className={({ isActive }) =>
            [
              "px-3 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px",
              isActive
                ? "border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100"
                : "border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-200",
            ].join(" ")
          }
        >
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}

function ProjectHeader({
  project,
  onDelete,
}: {
  project: Project;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);

  const update = useMutation({
    mutationFn: (body: {
      name?: string;
      path?: string;
      description?: string | null;
    }) => api.updateProject(project.id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project", project.id] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      setEditing(false);
    },
  });

  if (editing) {
    return (
      <ProjectEditForm
        project={project}
        submitting={update.isPending}
        error={update.error?.message ?? null}
        onSubmit={(body) => update.mutate(body)}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <Card className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold truncate">{project.name}</h1>
          <p className="mt-1 text-xs text-zinc-500 mono break-all">
            {project.path}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
            {t("common.edit")}
          </Button>
          <Button variant="ghost" size="sm" onClick={onDelete}>
            {t("common.delete")}
          </Button>
        </div>
      </div>
      {project.description ? (
        <p className="text-sm text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap">
          {project.description}
        </p>
      ) : null}
    </Card>
  );
}

function ProjectEditForm({
  project,
  submitting,
  error,
  onSubmit,
  onCancel,
}: {
  project: Project;
  submitting: boolean;
  error: string | null;
  onSubmit: (body: {
    name: string;
    path: string;
    description: string | null;
  }) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(project.name);
  const [path, setPath] = useState(project.path);
  const [description, setDescription] = useState(project.description ?? "");

  return (
    <Card className="space-y-4">
      <h2 className="font-medium">{t("projectDetail.editTitle")}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("projects.field.name")}>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field
          label={t("projects.field.path")}
          hint={t("projects.field.pathHint")}
        >
          <Input
            value={path}
            onChange={(e) => setPath(e.target.value)}
            className="mono"
          />
        </Field>
      </div>
      <Field label={t("projects.field.description")}>
        <Textarea
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
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
          {submitting ? t("common.saving") : t("common.save")}
        </Button>
      </div>
    </Card>
  );
}
