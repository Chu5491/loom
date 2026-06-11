// office 가져오기 — zip/단일 .md 업로드로 스킬·규약 추가.
// 디폴트는 UI 입력이고 이건 옵션 경로(Claude 스킬 zip 같은 외부 번들 반입용).
// zip-slip(절대경로·..) 차단, 파일 수·크기 cap. 쓰기는 기존 office.ts 세이버 재사용.

import AdmZip from "adm-zip";
import fs from "node:fs";
import path from "node:path";
import { paths } from "./config.js";
import { readSkills, safeName, safeRelPath, writeRule, writeSkill } from "./office.js";
import type { RuleSpec, SkillSpec } from "@loom/core";

const MAX_ENTRIES = 100;
const MAX_FILE_BYTES = 2 * 1024 * 1024; // 파일당 2MB
const MAX_TOTAL_BYTES = 20 * 1024 * 1024; // 압축 해제 합계 20MB (zip bomb 가드)

function stem(filename: string): string {
  return filename.replace(/\.[^.]+$/, "");
}

interface Entry {
  rel: string; // 정규화된 상대경로 (root 폴더 strip 후)
  data: Buffer;
}

// zip 엔트리를 검증·정규화. 모든 파일이 단일 root 폴더 안이면 그 폴더를 벗긴다
// (Claude 스킬 zip 의 흔한 모양: my-skill/SKILL.md ...).
function readZipEntries(buf: Buffer): Entry[] {
  const zip = new AdmZip(buf);
  const files = zip.getEntries().filter((e) => !e.isDirectory && !path.basename(e.entryName).startsWith("."));
  if (files.length === 0) throw new Error("zip is empty");
  if (files.length > MAX_ENTRIES) throw new Error(`too many files (max ${MAX_ENTRIES})`);

  let total = 0;
  const raw = files.map((e) => {
    const name = e.entryName.replace(/\\/g, "/");
    if (name.startsWith("/") || name.split("/").some((s) => s === "..")) {
      throw new Error(`unsafe path in zip: ${name}`); // zip-slip
    }
    const data = e.getData();
    if (data.length > MAX_FILE_BYTES) throw new Error(`file too large: ${name}`);
    total += data.length;
    if (total > MAX_TOTAL_BYTES) throw new Error("archive too large");
    return { rel: name, data };
  });

  const roots = new Set(raw.map((e) => e.rel.split("/")[0]!));
  const stripRoot = roots.size === 1 && raw.every((e) => e.rel.includes("/"));
  return raw.map((e) => ({ ...e, rel: stripRoot ? e.rel.split("/").slice(1).join("/") : e.rel }));
}

/** 스킬 가져오기 — .md 단일(단일 파일 스킬) 또는 .zip(SKILL.md 필수, 폴더 스킬). */
export function importSkillArchive(filename: string, buf: Buffer): SkillSpec {
  if (filename.toLowerCase().endsWith(".md")) {
    const name = safeName(stem(path.basename(filename)));
    // frontmatter 가 있으면 writeSkill 이 다시 감싸므로 body 만 골라낸다.
    const text = buf.toString("utf8");
    const m = text.match(/^---\n[\s\S]*?\ndescription:\s*"?([^"\n]*)"?\n[\s\S]*?---\n?/);
    const body = m ? text.slice(m[0].length) : text;
    return writeSkill(name, m?.[1] ?? "", body);
  }

  const entries = readZipEntries(buf);
  const hasSkillMd = entries.some((e) => e.rel === "SKILL.md");
  if (!hasSkillMd) throw new Error("zip must contain SKILL.md at its root");

  const name = safeName(stem(path.basename(filename)));
  const folder = path.join(paths.office, "skills", name);
  if (fs.existsSync(folder) || fs.existsSync(path.join(paths.office, "skills", `${name}.md`))) {
    throw new Error(`skill already exists: ${name}`);
  }
  for (const e of entries) {
    const rel = e.rel === "SKILL.md" ? e.rel : safeRelPath(e.rel); // SKILL.md 는 예약어라 직접 통과
    const dest = path.join(folder, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, e.data);
  }
  const found = readSkills().find((s) => s.name === name);
  if (!found) throw new Error("import failed to materialize");
  return found;
}

/** 규약 가져오기 — .md 단일 또는 .zip 안의 모든 .md(파일명이 규약 이름). */
export function importRulesArchive(filename: string, buf: Buffer): RuleSpec[] {
  if (filename.toLowerCase().endsWith(".md")) {
    return [writeRule(safeName(stem(path.basename(filename))), buf.toString("utf8"))];
  }
  const mds = readZipEntries(buf).filter((e) => e.rel.toLowerCase().endsWith(".md"));
  if (mds.length === 0) throw new Error("zip has no .md files");
  return mds.map((e) => writeRule(safeName(stem(path.basename(e.rel))), e.data.toString("utf8")));
}
