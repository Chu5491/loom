// 공식 MCP Registry fetcher.
//
// Anthropic 운영하는 모든 MCP 서버의 source of truth.
//   GET https://registry.modelcontextprotocol.io/v0/servers?limit=N&cursor=X
//   - 인증 불필요
//   - cursor-based pagination
//
// 응답:
//   { servers: [{server: {...}, _meta: {...}}], metadata: {nextCursor, count} }
//
// 각 server.server 항목에 다음 중 하나(또는 둘 다):
//   - packages: stdio installer (npm / pypi / docker)
//   - remotes:  HTTP/SSE endpoints
//
// 우리 MarketplaceMcp 로 변환할 때:
//   - packages 우선 (stdio 가 사용자 경험상 가장 흔함)
//   - 없으면 remotes 의 첫 entry 를 http/sse 로
//   - 둘 다 없으면 skip
//
// 캐시: 24h in-memory. 처음 요청만 네트워크.

import type { MarketplaceMcp } from "../marketplace/mcp-catalog.js";
import { createCachedFetch } from "./cached-fetch.js";

const REGISTRY_BASE_URL =
  process.env.LOOM_MCP_REGISTRY_URL ?? "https://registry.modelcontextprotocol.io";
const FETCH_LIMIT = Number(process.env.LOOM_MCP_REGISTRY_LIMIT ?? "200");

const registryCache = createCachedFetch<MarketplaceMcp>({
  name: "mcp-registry",
  ttlMs: 24 * 60 * 60 * 1000,
  errorRetryMs: 60_000,
  fetch: async () => {
    const url = `${REGISTRY_BASE_URL}/v0/servers?limit=${FETCH_LIMIT}`;
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "loom" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`mcp-registry http ${res.status}`);
    const json = (await res.json()) as unknown;
    const servers = (json as { servers?: unknown[] })?.servers ?? [];
    if (!Array.isArray(servers)) {
      throw new Error("mcp-registry: unexpected response shape");
    }
    const entries: MarketplaceMcp[] = [];
    for (const wrap of servers) {
      const e = parseRegistryServer(wrap);
      if (e) entries.push(e);
    }
    return entries;
  },
});

export const fetchOfficialMcpRegistry = registryCache.get;

interface RegistryServer {
  name?: string;
  title?: string;
  description?: string;
  version?: string;
  repository?: { url?: string; source?: string };
  packages?: Array<{
    registryType?: string;
    identifier?: string;
    version?: string;
    transport?: { type?: string };
    runtimeArguments?: unknown[];
    packageArguments?: unknown[];
    environmentVariables?: unknown[];
  }>;
  remotes?: Array<{ type?: string; url?: string; headers?: unknown }>;
}

/** registry 의 한 entry 를 우리 MarketplaceMcp 로. shape 안 맞으면 null. */
function parseRegistryServer(raw: unknown): MarketplaceMcp | null {
  if (!raw || typeof raw !== "object") return null;
  const wrap = raw as { server?: RegistryServer };
  const s = wrap.server;
  if (!s || !s.name) return null;

  const description = s.description ?? "";
  const homepage = s.repository?.url ?? `https://registry.modelcontextprotocol.io`;

  // packages 우선 — stdio 가 가장 흔하고 사용자가 즉시 install 가능.
  const pkg = s.packages?.[0];
  if (pkg && pkg.identifier) {
    const tpl = packageToTemplate(pkg);
    if (tpl) {
      return {
        id: `mcp-registry:${s.name}`,
        name: s.title?.trim() || lastSegment(s.name),
        description,
        source: homepage,
        publisher: "Community",
        tags: ["registry", pkg.registryType ?? "package"],
        template: tpl,
      };
    }
  }

  // packages 가 없거나 매핑 안 되면 remote.
  const remote = s.remotes?.[0];
  if (remote && remote.url) {
    const kind: "http" | "sse" =
      remote.type === "sse" || remote.type === "streamable-sse" ? "sse" : "http";
    return {
      id: `mcp-registry:${s.name}`,
      name: s.title?.trim() || lastSegment(s.name),
      description,
      source: homepage,
      publisher: "Community",
      tags: ["registry", "remote"],
      template: {
        kind,
        url: remote.url,
        headers: {},
      },
    };
  }

  return null;
}

/** registryType → 우리 stdio template 의 command/args.
 *
 *   npm   → npx -y <id>
 *   pypi  → uvx <id>            (uv 가 가장 가벼운 python runner)
 *   docker → docker run -i --rm <id>
 *   기타  → null (지원 안 함)
 */
function packageToTemplate(pkg: NonNullable<RegistryServer["packages"]>[0]):
  | { kind: "stdio"; command: string; args: string[]; env: Record<string, string> }
  | null {
  if (!pkg.identifier) return null;
  const id = pkg.identifier;
  switch (pkg.registryType) {
    case "npm":
      return { kind: "stdio", command: "npx", args: ["-y", id], env: {} };
    case "pypi":
      return { kind: "stdio", command: "uvx", args: [id], env: {} };
    case "docker":
    case "oci":
      return {
        kind: "stdio",
        command: "docker",
        args: ["run", "-i", "--rm", id],
        env: {},
      };
    default:
      return null;
  }
}

function lastSegment(qualifiedName: string): string {
  const slash = qualifiedName.lastIndexOf("/");
  return slash >= 0 ? qualifiedName.slice(slash + 1) : qualifiedName;
}

export const clearMcpRegistryCache = registryCache.clear;
