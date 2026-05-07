// skills.sh API fetcher.
//
//   GET https://skills.sh/api/v1/skills?page=N&perPage=M
//     - 인증 옵션: 없으면 60 req/min, LOOM_SKILLS_SH_API_KEY 있으면 600
//     - 응답: { data: [{id, slug, name, source, installs, sourceType, installUrl, url}], pagination }
//     - **list 에는 description / content 가 없음** — 그건 detail 호출 필요.
//
//   GET https://skills.sh/api/v1/skills/{source}/{skill}
//     - SKILL.md 본문 + 모든 파일 내용 + content hash
//     - install 누를 때만 lazy fetch (list 단계엔 metadata 만)
//
// 캐시:
//   - 목록: 24h (8000+ 개라 자주 안 바뀌고, 사용자 만족도 > 신선도)
//   - 본문: 1h (한 번 fetch 한 본문은 보통 install 직후라 더 안 봄)

import type { MarketplaceSkill } from "../marketplace/skill-catalog.js";
import { logger } from "../logger.js";

const SKILLS_SH_BASE_URL =
  process.env.LOOM_SKILLS_SH_BASE_URL ?? "https://skills.sh";
const LIST_CACHE_MS = 24 * 60 * 60 * 1000;
const DETAIL_CACHE_MS = 60 * 60 * 1000;
const FETCH_LIMIT = Number(process.env.LOOM_SKILLS_SH_LIMIT ?? "200");

interface ListCache {
  fetchedAt: number;
  entries: MarketplaceSkill[];
}
let listCache: ListCache | null = null;

interface DetailCacheEntry {
  fetchedAt: number;
  content: string;
}
const detailCache = new Map<string, DetailCacheEntry>();

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": "loom",
  };
  const key = process.env.LOOM_SKILLS_SH_API_KEY;
  if (key) headers.Authorization = `Bearer ${key}`;
  return headers;
}

/** 첫 페이지에서 metadata 만 가져옴. content 는 install 시 lazy. */
export async function fetchSkillsShCatalog(): Promise<MarketplaceSkill[]> {
  if (listCache && Date.now() - listCache.fetchedAt < LIST_CACHE_MS) {
    return listCache.entries;
  }
  try {
    const url = `${SKILLS_SH_BASE_URL}/api/v1/skills?page=0&perPage=${FETCH_LIMIT}`;
    const res = await fetch(url, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      throw new Error(`skills.sh http ${res.status}`);
    }
    const json = (await res.json()) as unknown;
    const data = (json as { data?: unknown[] })?.data ?? [];
    if (!Array.isArray(data)) throw new Error("skills.sh: unexpected shape");

    const entries: MarketplaceSkill[] = [];
    for (const raw of data) {
      const e = parseListItem(raw);
      if (e) entries.push(e);
    }
    listCache = { fetchedAt: Date.now(), entries };
    return entries;
  } catch (err) {
    logger.warn(
      { err: (err as Error).message },
      "skills.sh fetch failed (will retry next request after short cache)",
    );
    listCache = {
      fetchedAt: Date.now() - (LIST_CACHE_MS - 60_000),
      entries: [],
    };
    return [];
  }
}

interface SkillsShListItem {
  id?: string;
  slug?: string;
  name?: string;
  source?: string;
  description?: string;
  sourceType?: string;
  installUrl?: string;
  url?: string;
  installs?: number;
}

/** list 응답의 한 entry 를 우리 MarketplaceSkill 로. content 는 빈 문자열 —
 *  install 단계에서 detail 로 채움. 마켓플레이스 카드는 content 없이도 OK. */
function parseListItem(raw: unknown): MarketplaceSkill | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as SkillsShListItem;
  const id = r.id?.trim();
  const name = r.name?.trim();
  const source = r.source?.trim();
  if (!id || !name || !source) return null;
  // skills.sh 가 description 을 list 에 붙여줄 수도 / 안 줄 수도 — 있으면 사용.
  const description =
    r.description?.trim() ??
    `${source} · ${(r.installs ?? 0).toLocaleString()} installs`;
  return {
    id: `skills.sh:${id}`,
    name,
    description,
    source: r.url ?? r.installUrl,
    publisher: "Community",
    tags: ["skills.sh", source.split("/")[0] ?? "skill"],
    content: "", // detail 호출이 채워줌
  };
}

/** Install 시 SKILL.md 본문 가져오기. id 는 우리가 부여한 "skills.sh:<source>/<slug>" 포맷. */
export async function fetchSkillsShDetail(id: string): Promise<string | null> {
  // "skills.sh:" prefix 떼기.
  const stripped = id.startsWith("skills.sh:") ? id.slice("skills.sh:".length) : id;
  const cached = detailCache.get(stripped);
  if (cached && Date.now() - cached.fetchedAt < DETAIL_CACHE_MS) {
    return cached.content;
  }
  try {
    // skills.sh detail 은 source/slug 형태의 path. id 에 이미 그 모양.
    const url = `${SKILLS_SH_BASE_URL}/api/v1/skills/${stripped}`;
    const res = await fetch(url, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`skills.sh detail http ${res.status}`);
    const json = (await res.json()) as unknown;
    const content = extractSkillContent(json);
    if (content === null) return null;
    detailCache.set(stripped, { fetchedAt: Date.now(), content });
    return content;
  } catch (err) {
    logger.warn(
      { err: (err as Error).message, id },
      "skills.sh detail fetch failed",
    );
    return null;
  }
}

/** detail 응답에서 SKILL.md 본문 추출. shape 이 다양할 수 있어 best-effort:
 *  - data.content 직접
 *  - data.files[].path === "SKILL.md" 의 contents
 *  - data.body / data.markdown 같은 fallback */
function extractSkillContent(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const root = json as Record<string, unknown>;
  // wrap layer { data: {...} } 일 수도.
  const data = (root.data as Record<string, unknown>) ?? root;

  // 1) 본문 직접 키.
  for (const key of ["content", "body", "markdown", "text"]) {
    const v = data[key];
    if (typeof v === "string" && v.trim()) return v;
  }

  // 2) files 배열 안에 SKILL.md.
  const files = data.files as Array<{ path?: string; contents?: string; content?: string }> | undefined;
  if (Array.isArray(files)) {
    const skillMd =
      files.find((f) => f.path?.toLowerCase().endsWith("skill.md")) ?? files[0];
    if (skillMd) {
      const v = skillMd.contents ?? skillMd.content;
      if (typeof v === "string" && v.trim()) return v;
    }
  }

  return null;
}

/** 테스트용. */
export function clearSkillsShCache(): void {
  listCache = null;
  detailCache.clear();
}
