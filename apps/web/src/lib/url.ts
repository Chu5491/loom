// 라우터 없는 셸의 경량 URL 상태 — 탭/프로젝트/스레드/뷰를 쿼리스트링에 반영해
// 새로고침·딥링크에서 위치를 복원한다. history.replaceState 라 뒤로가기 스택은
// 쌓지 않는다(탭 전환마다 히스토리 항목을 만들지 않으려는 의도).

export function getParam(key: string): string | null {
  return new URLSearchParams(window.location.search).get(key);
}

/** 넘긴 키만 갱신(나머지는 보존) — 여러 컴포넌트가 각자 키를 관리해도 충돌 없게.
 *  값이 null/빈 문자열이면 해당 키 제거. */
export function setParams(updates: Record<string, string | null>): void {
  const params = new URLSearchParams(window.location.search);
  for (const [key, value] of Object.entries(updates)) {
    if (value == null || value === "") params.delete(key);
    else params.set(key, value);
  }
  const qs = params.toString();
  window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
}
