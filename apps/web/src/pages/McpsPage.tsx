// 시스템 레벨 MCP 서버 카탈로그. 여기서 한 번 추가하면 어떤 프로젝트의
// 어떤 에이전트라도 자기 권한 안에 있는 서버를 골라 쓸 수 있음.
// SpecsPage와 같은 좌측 리스트 + 우측 에디터 패턴.

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Plug, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { McpServer, McpServerKind } from "@loom/core";
import {
  api,
  type CreateMcpServerBody,
  type UpdateMcpServerBody,
} from "../api/client.js";
import { Button, Card, Field, Input, Textarea } from "../components/ui.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select.js";
import { PageScroll } from "../components/PageScroll.js";
import { PageHeader } from "../components/PageHeader.js";
import { useI18n } from "../context/I18nContext.js";
import { useConfirm } from "../components/ConfirmDialog.js";
import { cn } from "../lib/utils.js";

const BASE_URL = "/mcps";

const EMPTY: CreateMcpServerBody = {
  name: "",
  description: "",
  kind: "stdio",
  command: "",
  args: [],
  env: {},
  url: "",
  headers: {},
};

export function McpsPage() {
  const { t } = useI18n();
  const { mcpId } = useParams<{ mcpId?: string }>();
  const navigate = useNavigate();
  const isNew = mcpId === "new";
  const selectedId = !mcpId || isNew ? null : mcpId;

  const list = useQuery({
    queryKey: ["mcp-servers"],
    queryFn: api.listMcpServers,
  });

  return (
    <PageScroll className="space-y-4">
      <PageHeader
        title={t("mcps.title")}
        description={t("mcps.subtitle")}
        action={
          <Button onClick={() => navigate(`${BASE_URL}/new`)}>
            {t("mcps.new")}
          </Button>
        }
      />
      <div className="grid gap-4 md:grid-cols-[260px_1fr]">
        <ServerList
          servers={list.data?.servers ?? []}
          loading={list.isLoading}
          selectedId={selectedId}
        />
        <div>
          {isNew ? (
            <ServerEditor key="new" server={null} />
          ) : selectedId ? (
            <ServerEditorById key={selectedId} id={selectedId} />
          ) : (
            <Card className="text-sm text-muted-foreground">
              {t("mcps.helpUnselected")}
            </Card>
          )}
        </div>
      </div>
    </PageScroll>
  );
}

function ServerList({
  servers,
  loading,
  selectedId,
}: {
  servers: McpServer[];
  loading: boolean;
  selectedId: string | null;
}) {
  const { t } = useI18n();
  if (loading)
    return (
      <p className="text-muted-foreground text-sm">{t("common.loading")}</p>
    );
  if (servers.length === 0) {
    return (
      <Card className="text-sm text-muted-foreground">{t("mcps.empty")}</Card>
    );
  }
  return (
    <div className="space-y-1">
      {servers.map((s) => (
        <Link
          key={s.id}
          to={`${BASE_URL}/${s.id}`}
          className={cn(
            "block rounded-md border px-3 py-2 transition-colors",
            selectedId === s.id
              ? "border-zinc-400 bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-800/60"
              : "border-zinc-200 bg-zinc-50/50 hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900/50 dark:hover:border-zinc-700",
          )}
        >
          <div className="flex items-center gap-1.5 text-sm font-medium truncate">
            <Plug className="size-3.5 text-violet-600 dark:text-violet-400 shrink-0" />
            {s.name}
          </div>
          <div className="mt-0.5 text-[10px] text-muted-foreground/70 mono">
            {s.kind} · {new Date(s.updatedAt).toLocaleString()}
          </div>
          {s.description ? (
            <div className="mt-0.5 text-[11px] text-muted-foreground line-clamp-1">
              {s.description}
            </div>
          ) : null}
        </Link>
      ))}
    </div>
  );
}

function ServerEditorById({ id }: { id: string }) {
  const { t } = useI18n();
  const q = useQuery({
    queryKey: ["mcp-server", id],
    queryFn: () => api.getMcpServer(id),
  });
  if (q.isLoading)
    return <p className="text-muted-foreground text-sm">{t("common.loading")}</p>;
  if (q.isError)
    return <p className="text-destructive text-sm">{q.error.message}</p>;
  if (!q.data) return null;
  return <ServerEditor server={q.data.server} />;
}

function ServerEditor({ server }: { server: McpServer | null }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const confirm = useConfirm();

  const [name, setName] = useState(server?.name ?? EMPTY.name);
  const [description, setDescription] = useState(
    server?.description ?? EMPTY.description ?? "",
  );
  const [kind, setKind] = useState<McpServerKind>(server?.kind ?? "stdio");
  const [command, setCommand] = useState(server?.command ?? EMPTY.command ?? "");
  const [argsText, setArgsText] = useState((server?.args ?? []).join("\n"));
  const [envText, setEnvText] = useState(
    formatKeyValueText(server?.env ?? {}),
  );
  const [url, setUrl] = useState(server?.url ?? EMPTY.url ?? "");
  const [headersText, setHeadersText] = useState(
    formatKeyValueText(server?.headers ?? {}),
  );

  // 외부에서 spec이 바뀌면(다른 행 클릭) 폼 재초기화. spec.id를 키로.
  useEffect(() => {
    if (!server) return;
    setName(server.name);
    setDescription(server.description ?? "");
    setKind(server.kind);
    setCommand(server.command ?? "");
    setArgsText(server.args.join("\n"));
    setEnvText(formatKeyValueText(server.env));
    setUrl(server.url ?? "");
    setHeadersText(formatKeyValueText(server.headers));
  }, [server?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const args = useMemo(
    () =>
      argsText
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
    [argsText],
  );
  const env = useMemo(() => parseKeyValueText(envText), [envText]);
  const headers = useMemo(() => parseKeyValueText(headersText), [headersText]);

  const create = useMutation({
    mutationFn: (body: CreateMcpServerBody) => api.createMcpServer(body),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["mcp-servers"] });
      toast.success(t("mcps.toast.created", { name: r.server.name }));
      navigate(`${BASE_URL}/${r.server.id}`);
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : String(err)),
  });
  const update = useMutation({
    mutationFn: (body: UpdateMcpServerBody) =>
      api.updateMcpServer(server!.id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mcp-servers"] });
      qc.invalidateQueries({ queryKey: ["mcp-server", server!.id] });
      toast.success(t("mcps.toast.updated"));
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : String(err)),
  });
  const remove = useMutation({
    mutationFn: () => api.deleteMcpServer(server!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mcp-servers"] });
      toast.success(t("mcps.toast.deleted"));
      navigate(BASE_URL);
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : String(err)),
  });

  const body: CreateMcpServerBody = {
    name,
    description: description || null,
    kind,
    command: kind === "stdio" ? command || null : null,
    args: kind === "stdio" ? args : [],
    env: kind === "stdio" ? env : {},
    url: kind !== "stdio" ? url || null : null,
    headers: kind !== "stdio" ? headers : {},
  };

  const isDirty = server
    ? body.name !== server.name ||
      (body.description ?? null) !== (server.description ?? null) ||
      body.kind !== server.kind ||
      (body.command ?? null) !== (server.command ?? null) ||
      JSON.stringify(body.args) !== JSON.stringify(server.args) ||
      JSON.stringify(body.env) !== JSON.stringify(server.env) ||
      (body.url ?? null) !== (server.url ?? null) ||
      JSON.stringify(body.headers) !== JSON.stringify(server.headers)
    : !!name;

  return (
    <Card className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
        <Field label={t("mcps.field.name")} hint={t("mcps.field.nameHint")}>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="github"
          />
        </Field>
        <Field label={t("mcps.field.kind")}>
          <Select
            value={kind}
            onValueChange={(v) => setKind(v as McpServerKind)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="stdio">stdio</SelectItem>
              <SelectItem value="http">http</SelectItem>
              <SelectItem value="sse">sse</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>

      <Field label={t("mcps.field.description")}>
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t("mcps.placeholder.description")}
        />
      </Field>

      {kind === "stdio" ? (
        <>
          <Field label={t("mcps.field.command")} hint={t("mcps.field.commandHint")}>
            <Input
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="npx"
              className="mono"
            />
          </Field>
          <Field label={t("mcps.field.args")} hint={t("mcps.field.argsHint")}>
            <Textarea
              value={argsText}
              onChange={(e) => setArgsText(e.target.value)}
              rows={3}
              placeholder={"-y\n@modelcontextprotocol/server-github"}
              className="mono text-xs"
            />
          </Field>
          <Field label={t("mcps.field.env")} hint={t("mcps.field.envHint")}>
            <Textarea
              value={envText}
              onChange={(e) => setEnvText(e.target.value)}
              rows={4}
              placeholder={"GITHUB_TOKEN=ghp_xxx\nLOG_LEVEL=info"}
              className="mono text-xs"
            />
          </Field>
        </>
      ) : (
        <>
          <Field label={t("mcps.field.url")} hint={t("mcps.field.urlHint")}>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/mcp"
              className="mono"
            />
          </Field>
          <Field label={t("mcps.field.headers")} hint={t("mcps.field.headersHint")}>
            <Textarea
              value={headersText}
              onChange={(e) => setHeadersText(e.target.value)}
              rows={4}
              placeholder={"Authorization=Bearer xxx"}
              className="mono text-xs"
            />
          </Field>
        </>
      )}

      <div className="flex items-center justify-between">
        <div>
          {server ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                const ok = await confirm({
                  title: t("mcps.deleteConfirm", { name: server.name }),
                  destructive: true,
                });
                if (ok) remove.mutate();
              }}
            >
              <Trash2 className="size-3.5 mr-1" />
              {t("common.delete")}
            </Button>
          ) : null}
        </div>
        <Button
          disabled={!isDirty || !name}
          onClick={() => (server ? update.mutate(body) : create.mutate(body))}
        >
          {server ? t("common.save") : t("common.create")}
        </Button>
      </div>
    </Card>
  );
}

// "KEY=VALUE" 줄별 텍스트 ↔ Record<string, string>. 빈 줄/주석 무시.
function parseKeyValueText(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1);
    if (key) out[key] = value;
  }
  return out;
}

function formatKeyValueText(obj: Record<string, string>): string {
  return Object.entries(obj)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
}
