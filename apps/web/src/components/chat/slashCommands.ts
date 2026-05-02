// composer가 `/`로 시작하면 띄우는 슬래시 커맨드 팔레트 정의.
// 서버는 이 prefix를 파싱하지 않음 — 사용자 의도 라벨 + 스레드 가독성용.

export interface SlashCommand {
  cmd: string;
  i18nLabel: string;
  i18nHint: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { cmd: "/ask", i18nLabel: "chat.slash.ask.label", i18nHint: "chat.slash.ask.hint" },
  { cmd: "/fix", i18nLabel: "chat.slash.fix.label", i18nHint: "chat.slash.fix.hint" },
  { cmd: "/review", i18nLabel: "chat.slash.review.label", i18nHint: "chat.slash.review.hint" },
  { cmd: "/explain", i18nLabel: "chat.slash.explain.label", i18nHint: "chat.slash.explain.hint" },
  { cmd: "/test", i18nLabel: "chat.slash.test.label", i18nHint: "chat.slash.test.hint" },
];
