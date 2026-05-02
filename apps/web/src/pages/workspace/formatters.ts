// 워크스페이스 헤더용 포맷터.

// 작은 비용은 4자리, 10달러 미만은 3자리, 그 이상 2자리.
// 기본 3자리는 $0.043 합계가 "$0"으로 보이는 걸 방지.
export function formatThreadCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 10) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

// 컨텍스트 번들 크기를 짧게: 1234자 → "1.2k".
export function compactBundleSize(text: string): string {
  const n = text.length;
  if (n < 1000) return `${n}`;
  return `${(n / 1000).toFixed(1)}k`;
}
