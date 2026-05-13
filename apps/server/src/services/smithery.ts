// smithery.ai MCP 레지스트리 fetcher.
//
// smithery (https://smithery.ai) 는 외부 MCP 서버 레지스트리. 사용자가 환경
// 변수 LOOM_SMITHERY_API_KEY 로 키를 제공하면 우리가 그 레지스트리에서 서버
// 목록을 받아 marketplace 카탈로그에 합쳐 보여줌.
//
// 정책:
//   - 키 없으면 disabled — 빈 배열 반환, 에러 안 던짐.
//   - 24h 메모리 캐시. 같은 프로세스 안에서 첫 호출만 네트워크.
//   - 응답 shape 이 예상과 달라도 throw 안 함 — best-effort 로 파싱하고 못
//     읽으면 그 항목만 스킵. smithery API 가 바뀌어도 다른 마켓플레이스 기능이
//     같이 깨지지 않게.
//
// **주의**: smithery API 의 정확한 endpoint / 응답 shape 은 변경될 수 있음.
// 이 파일이 그 shape 을 가정하는 유일한 곳 — bug 가 보이면 여기만 손보면 됨.

import type { MarketplaceMcp } from "../marketplace/mcp-catalog.js";
import { getSmitheryApiKey } from "../db/settings.js";
import { createCachedFetch } from "./cached-fetch.js";

const SMITHERY_BASE_URL =
  process.env.LOOM_SMITHERY_BASE_URL ?? "https://registry.smithery.ai";
const PAGE_SIZE = 50;
const CACHE_TTL = 24 * 60 * 60 * 1000;

export function smitheryAvailable(): boolean {
  return !!getSmitheryApiKey();
}

const smitheryCache = createCachedFetch<MarketplaceMcp>({
  name: "smithery",
  ttlMs: CACHE_TTL,
  // 실패 시 전체 TTL 캐시 — 같은 프로세스에서 매 클릭마다 재시도 안 하게.
  errorRetryMs: CACHE_TTL,
  fetch: () => fetchPage(1),
});

export async function fetchSmitheryCatalog(): Promise<MarketplaceMcp[]> {
  if (!smitheryAvailable()) return [];
  return smitheryCache.get();
}

async function fetchPage(page: number): Promise<MarketplaceMcp[]> {
  const apiKey = getSmitheryApiKey()!;
  const url = `${SMITHERY_BASE_URL}/servers?page=${page}&pageSize=${PAGE_SIZE}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      "User-Agent": "loom",
    },
    // network hang 방지 — smithery 가 응답 안 하면 빠르게 포기.
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`smithery http ${res.status}`);
  }
  const json = (await res.json()) as unknown;
  // 예상 shape: { servers: [...] }. 비슷한 변형도 best-effort.
  const list =
    (json as { servers?: unknown[] })?.servers ??
    (Array.isArray(json) ? (json as unknown[]) : []);
  if (!Array.isArray(list)) return [];

  const out: MarketplaceMcp[] = [];
  for (const raw of list) {
    const entry = parseSmitheryServer(raw);
    if (entry) out.push(entry);
  }
  return out;
}

/** smithery 의 server item 을 우리 MarketplaceMcp 로 변환. shape 이 안 맞으면
 *  null. 필드명 가정: qualifiedName, displayName, description, homepage. */
function parseSmitheryServer(raw: unknown): MarketplaceMcp | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const qualifiedName = pickString(r, "qualifiedName", "name", "id");
  const displayName = pickString(r, "displayName", "name", "qualifiedName");
  if (!qualifiedName || !displayName) return null;
  const description = pickString(r, "description", "summary") ?? "";
  const homepage =
    pickString(r, "homepage", "repository", "sourceUrl") ?? "https://smithery.ai";

  // smithery 는 보통 stdio 기반 npm 패키지로 배포 — 가장 흔한 형태로 prefill.
  // 사용자가 마켓플레이스 카드에서 install 누르면 우리 ServerEditor 의 prefill
  // 로 들어가고, 거기서 사용자가 정확한 command 를 조정할 수 있음.
  return {
    id: `smithery:${qualifiedName}`,
    name: displayName,
    description,
    source: homepage,
    publisher: "Community",
    tags: ["smithery"],
    template: {
      kind: "stdio",
      command: "npx",
      args: ["-y", `@smithery/cli@latest`, "run", qualifiedName],
      env: {},
    },
    placeholders: [
      {
        where: "args",
        label: "Verify command",
        hint: "Smithery often needs additional flags or env vars per server. Check the homepage.",
      },
    ],
  };
}

function pickString(
  obj: Record<string, unknown>,
  ...keys: string[]
): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

export const clearSmitheryCache = smitheryCache.clear;
