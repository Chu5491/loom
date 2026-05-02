// POSIX 스타일 경로의 마지막 세그먼트.
export function basename(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(i + 1) : path;
}

// POSIX 스타일 경로의 디렉토리 부분(마지막 `/` 이전).
export function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(0, i) : "";
}
