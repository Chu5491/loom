// 라인 단위 JSON(NDJSON) 스트림 파서 — 여러 CLI 가 stdout 에 한 줄당 JSON 한 객체씩
// 내보낸다(codex·opencode·antigravity 등). `{` 로 시작하는 줄만 파싱하고, 청크 경계로
// 잘렸거나 깨진 줄은 조용히 건너뛴다(다음 청크에서 완성되거나 버려진다).

export function* parseJsonLines<T>(chunk: string): Generator<T> {
  for (const raw of chunk.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line[0] !== "{") continue;
    try {
      yield JSON.parse(line) as T;
    } catch {
      // partial / malformed line — 다음 청크에서 완성되길 기대하고 건너뜀
    }
  }
}
