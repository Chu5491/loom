import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  ExternalLink,
  GitBranch,
  Globe,
  Lock,
  Search,
} from "lucide-react";
import { useConfirm } from "../components/ConfirmDialog.js";
import type { GitRepo, PreferredEditor, Project } from "@loom/core";
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
    onError: (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("not_a_git_repo")) {
        toast.error(t("projects.toast.notGitRepo"));
      } else {
        toast.error(msg);
      }
    },
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
              className="rounded-md border border-border bg-card p-4 space-y-2"
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

// ─── Create Project Form ──────────────────────────────────────────────────

type CreateMode = "local" | "clone" | "github";

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
  const [mode, setMode] = useState<CreateMode>("github");
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [cloneUrl, setCloneUrl] = useState("");
  const [description, setDescription] = useState("");
  const [editor, setEditor] = useState<PreferredEditor>("vscode");

  const [autoName, setAutoName] = useState(true);
  const onCloneUrlChange = (v: string) => {
    setCloneUrl(v);
    if (autoName) {
      const inferred = v.split("/").pop()?.replace(/\.git$/i, "")?.trim() ?? "";
      if (inferred) setName(inferred);
    }
  };
  const onNameChange = (v: string) => {
    setName(v);
    setAutoName(false);
  };

  const selectGitHubRepo = (repo: GitRepo) => {
    setCloneUrl(repo.sshUrl || repo.url);
    if (autoName || !name) {
      const repoName = repo.nameWithOwner.split("/").pop() ?? "";
      setName(repoName);
      setAutoName(true);
    }
    if (!description && repo.description) {
      setDescription(repo.description);
    }
    setMode("clone");
  };

  const canSubmit = (() => {
    if (submitting || !name) return false;
    if (mode === "local") return !!path;
    if (mode === "github") return false;
    return !!cloneUrl;
  })();

  return (
    <Card className="space-y-4">
      <h2 className="font-medium">{t("projects.new")}</h2>
      <ModeTabs value={mode} onChange={setMode} />

      {mode === "github" ? (
        <GitHubRepoBrowser onSelect={selectGitHubRepo} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("projects.field.name")}>
              <Input
                value={name}
                onChange={(e) => onNameChange(e.target.value)}
                placeholder={t("projects.placeholder.name")}
              />
            </Field>
            {mode === "local" ? (
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
            ) : (
              <Field
                label={t("projects.field.cloneUrl")}
                hint={t("projects.field.cloneUrlHint")}
              >
                <Input
                  value={cloneUrl}
                  onChange={(e) => onCloneUrlChange(e.target.value)}
                  placeholder={t("projects.placeholder.cloneUrl")}
                  className="mono"
                />
              </Field>
            )}
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
              disabled={!canSubmit}
              onClick={() =>
                onSubmit(
                  mode === "clone"
                    ? {
                        name,
                        cloneUrl: cloneUrl.trim(),
                        description: description || null,
                        preferredEditor: editor,
                      }
                    : {
                        name,
                        path,
                        description: description || null,
                        preferredEditor: editor,
                      },
                )
              }
            >
              {submitting
                ? mode === "clone"
                  ? t("projects.cloning")
                  : t("common.creating")
                : mode === "clone"
                  ? t("projects.cloneAndCreate")
                  : t("common.create")}
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}

// ─── Mode Tabs ────────────────────────────────────────────────────────────

function ModeTabs({
  value,
  onChange,
}: {
  value: CreateMode;
  onChange: (next: CreateMode) => void;
}) {
  const { t } = useI18n();
  const tabs: Array<{ key: CreateMode; label: string }> = [
    { key: "github", label: t("projects.mode.github") },
    { key: "clone", label: t("projects.mode.clone") },
    { key: "local", label: t("projects.mode.local") },
  ];
  return (
    <div className="inline-flex rounded-md border border-border/70 p-0.5">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          onClick={() => onChange(tab.key)}
          className={
            "px-3 h-7 text-xs rounded transition-colors " +
            (value === tab.key
              ? "bg-foreground/[0.08] text-foreground font-medium"
              : "text-muted-foreground hover:text-foreground")
          }
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

// ─── GitHub Repo Browser ──────────────────────────────────────────────────

function GitHubRepoBrowser({
  onSelect,
}: {
  onSelect: (repo: GitRepo) => void;
}) {
  const { t } = useI18n();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedOrg, setSelectedOrg] = useState<string | undefined>();

  const auth = useQuery({
    queryKey: ["git-account", "auth"],
    queryFn: api.getGitAuthStatus,
    staleTime: 60_000,
  });

  const orgs = useQuery({
    queryKey: ["git-account", "orgs"],
    queryFn: api.getGitOrgs,
    enabled: !!auth.data?.authenticated,
    staleTime: 120_000,
  });

  const repos = useQuery({
    queryKey: ["git-account", "repos", selectedOrg],
    queryFn: () => api.getGitRepos({ org: selectedOrg, limit: 30, sort: "updated" }),
    enabled: !!auth.data?.authenticated && !searchQuery,
    staleTime: 60_000,
  });

  const search = useQuery({
    queryKey: ["git-account", "search", searchQuery],
    queryFn: () => api.searchGitRepos(searchQuery),
    enabled: !!auth.data?.authenticated && searchQuery.length >= 2,
    staleTime: 30_000,
  });

  if (auth.isLoading) {
    return (
      <div className="space-y-3 py-4">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (!auth.data?.ghInstalled) {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <GitBranch className="size-10 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          {t("gitAccount.ghNotInstalled")}
        </p>
        <a
          href="https://cli.github.com"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-primary hover:underline inline-flex items-center gap-1"
        >
          cli.github.com <ExternalLink className="size-3" />
        </a>
      </div>
    );
  }

  if (!auth.data.authenticated) {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <GitBranch className="size-10 text-muted-foreground" />
        <p className="text-sm font-medium">{t("gitAccount.notConnected")}</p>
        <p className="text-xs text-muted-foreground max-w-sm">
          {t("gitAccount.connectHint")}
        </p>
        <code className="text-xs bg-muted px-3 py-1.5 rounded-md font-mono">
          gh auth login
        </code>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => auth.refetch()}
        >
          {t("common.refresh")}
        </Button>
      </div>
    );
  }

  const displayRepos = searchQuery.length >= 2
    ? search.data?.repos ?? []
    : repos.data?.repos ?? [];
  const isLoadingRepos = searchQuery.length >= 2 ? search.isLoading : repos.isLoading;

  return (
    <div className="space-y-3">
      {/* Header: connected user + orgs */}
      <div className="flex items-center gap-2 text-sm">
        <GitBranch className="size-4" />
        <span className="font-medium">
          {t("gitAccount.connected", { username: auth.data.username ?? "" })}
        </span>
        {orgs.data && orgs.data.orgs.length > 0 ? (
          <select
            className="ml-auto h-7 rounded-md border border-border bg-background px-2 text-xs"
            value={selectedOrg ?? ""}
            onChange={(e) => {
              setSelectedOrg(e.target.value || undefined);
              setSearchQuery("");
            }}
          >
            <option value="">{auth.data.username}</option>
            {orgs.data.orgs.map((o) => (
              <option key={o.login} value={o.login}>
                {o.login}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      {/* Search bar */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t("gitAccount.search")}
          className="pl-8 h-8 text-sm"
        />
      </div>

      {/* Repo list */}
      <div className="max-h-64 overflow-y-auto rounded-md border border-border divide-y divide-border">
        {isLoadingRepos ? (
          <div className="p-4 space-y-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : displayRepos.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground text-center">
            {t("gitAccount.noRepos")}
          </p>
        ) : (
          displayRepos.map((repo) => (
            <button
              key={repo.nameWithOwner}
              type="button"
              className="w-full text-left px-3 py-2 hover:bg-muted/50 transition-colors flex items-start gap-2"
              onClick={() => onSelect(repo)}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-medium truncate">
                    {repo.nameWithOwner}
                  </span>
                  {repo.isPrivate ? (
                    <Lock className="size-3 text-muted-foreground shrink-0" />
                  ) : (
                    <Globe className="size-3 text-muted-foreground shrink-0" />
                  )}
                </div>
                {repo.description ? (
                  <p className="text-xs text-muted-foreground truncate mt-0.5">
                    {repo.description}
                  </p>
                ) : null}
              </div>
              <span className="text-xs text-primary shrink-0 mt-0.5">
                {t("gitAccount.openAsProject")}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
