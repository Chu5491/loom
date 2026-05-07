// 클라가 unified diff 텍스트를 hunk 단위로 잘라 보여주고, 사용자가 고른 hunk
// 하나(혹은 여러 개)로 patch 를 재구성해 서버에 보낸다. 서버는 그 patch 를
// `git apply --cached` (stage) / `git apply --cached -R` (unstage) 로 흘림.
//
// `--unidiff-zero` 모드를 서버에서 켜기 때문에 hunk 가 컨텍스트 0 라도 통과.
// 단, 우리 git 서비스는 `git diff` 를 기본 컨텍스트(3) 로 만들어서 hunk 자체엔
// 컨텍스트가 살아있음 — 사용자가 보는 것과 정확히 같은 hunk 가 박힘.

export interface DiffHunk {
  /** "@@ -1,2 +1,3 @@ optional section header" 그대로의 hunk 헤더. */
  header: string;
  /** hunk header 포함 모든 줄. trailing newline 없음. */
  lines: string[];
}

export interface ParsedDiff {
  /** "diff --git ...", "index ...", "--- a/x", "+++ b/x" 같은 파일 prelude. */
  fileHeader: string[];
  hunks: DiffHunk[];
}

/** unified diff 텍스트를 prelude + hunk 들로 분리. file 이 1개 (단일 path) 라
 *  가정 — 멀티 파일 diff 는 호출 측에서 path 별로 자르는 책임. */
export function parseDiff(diff: string): ParsedDiff {
  const lines = diff.split("\n");
  const fileHeader: string[] = [];
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;
  let inPrelude = true;
  for (const line of lines) {
    if (line.startsWith("@@")) {
      inPrelude = false;
      if (current) hunks.push(current);
      current = { header: line, lines: [line] };
    } else if (inPrelude) {
      // 빈 trailing newline 도 prelude 에 들어와도 무해 — 다시 join 할 때 그대로.
      fileHeader.push(line);
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) hunks.push(current);
  return { fileHeader, hunks };
}

/** 선택된 hunk 들로 patch 재구성. 끝에 newline 하나 — git apply 가 기대. */
export function buildPatch(parsed: ParsedDiff, selected: DiffHunk[]): string {
  if (selected.length === 0) return "";
  const lines = [
    ...parsed.fileHeader,
    ...selected.flatMap((h) => h.lines),
  ];
  // 마지막이 newline 으로 끝나야 git apply 가 행복함.
  const text = lines.join("\n");
  return text.endsWith("\n") ? text : text + "\n";
}
