import type { AdapterManifest } from "@loom/core";
import { DROID_PRESET_MODELS } from "./preset-models.js";

// Factory — 검은 라운드 타일 위 흰색 8엽 바람개비(풍차). factory.ai 실제 로고를 SVG
// 로 재현(벡터, PNG 불필요). 잎은 통통한 곡선이 한쪽으로 살짝 휘어 풍차감 — 8개를
// 45° 회전. 타일이 항상 검정이라 흰 잎이 light/dark 양쪽에서 또렷하다.
const ICON_SVG = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <rect x="2" y="2" width="20" height="20" rx="5" fill="#0A0A0A"/>
  <g fill="#FFFFFF">
    <path d="M12 12 Q14.2 6.6 13 2.6 Q10.2 6.2 12 12 Z" transform="rotate(0 12 12)"/>
    <path d="M12 12 Q14.2 6.6 13 2.6 Q10.2 6.2 12 12 Z" transform="rotate(45 12 12)"/>
    <path d="M12 12 Q14.2 6.6 13 2.6 Q10.2 6.2 12 12 Z" transform="rotate(90 12 12)"/>
    <path d="M12 12 Q14.2 6.6 13 2.6 Q10.2 6.2 12 12 Z" transform="rotate(135 12 12)"/>
    <path d="M12 12 Q14.2 6.6 13 2.6 Q10.2 6.2 12 12 Z" transform="rotate(180 12 12)"/>
    <path d="M12 12 Q14.2 6.6 13 2.6 Q10.2 6.2 12 12 Z" transform="rotate(225 12 12)"/>
    <path d="M12 12 Q14.2 6.6 13 2.6 Q10.2 6.2 12 12 Z" transform="rotate(270 12 12)"/>
    <path d="M12 12 Q14.2 6.6 13 2.6 Q10.2 6.2 12 12 Z" transform="rotate(315 12 12)"/>
  </g>
</svg>`;

export const factoryManifest: AdapterManifest = {
  kind: "factory",
  displayName: "Factory droid",
  description: "Factory's coding agent CLI (`droid exec`). 정액 구독으로 Claude·GPT·Gemini 멀티모델.",
  icon: "F",
  iconSvg: ICON_SVG,
  docsUrl: "https://docs.factory.ai/cli/droid-exec/overview",
  defaultCommand: "droid",
  defaultConfig: {
    model: "claude-sonnet-4-6",
    auto: "low",
  },
  fields: [
    {
      kind: "select",
      key: "model",
      label: "Model",
      help: "구독 관리형 모델(Anthropic·OpenAI·Google) + Droid Core 폴백. 정확한 id 는 로그인 후 확인. Custom… 으로 임의 id 입력 가능.",
      allowCustom: true,
      group: "basic",
      options: DROID_PRESET_MODELS,
    },
    {
      kind: "select",
      key: "reasoningEffort",
      label: "Reasoning effort",
      help: "추론 강도(--reasoning-effort). 모델별로 해석. 비우면 기본.",
      allowCustom: true,
      group: "basic",
      options: [
        { value: "", label: "Default" },
        { value: "low", label: "Low" },
        { value: "medium", label: "Medium" },
        { value: "high", label: "High" },
      ],
    },
    {
      kind: "select",
      key: "auto",
      label: "Autonomy (--auto)",
      help: "low=프로젝트 파일 편집 · medium=명령·git·빌드 · high=push 등 비가역. 기본 low(편집 허용 — 없으면 read-only 라 코딩이 막힘).",
      allowCustom: false,
      group: "basic",
      options: [
        { value: "low", label: "Low (파일 편집)" },
        { value: "medium", label: "Medium (명령·git)" },
        { value: "high", label: "High (push 등)" },
      ],
    },
    {
      kind: "boolean",
      key: "dangerouslySkipPermissions",
      label: "Skip all permissions (--skip-permissions-unsafe)",
      help: "모든 권한 확인을 건너뜀. 격리 환경 전용 — droid 가 무엇이든 읽고·쓰고·실행.",
      group: "basic",
      danger: true,
    },
    {
      kind: "string",
      key: "cwd",
      label: "Working directory override (--cwd)",
      help: "droid 가 보는 작업 디렉토리. spawn cwd 와 구분.",
      placeholder: "/Users/me/repo",
      group: "advanced",
    },
    {
      kind: "string",
      key: "command",
      label: "Command override",
      help: "절대 경로 또는 대체 바이너리명. 기본 `droid`.",
      placeholder: "droid",
      group: "advanced",
    },
    {
      kind: "stringList",
      key: "extraArgs",
      label: "Extra args",
      help: "CLI 명령 뒤에 그대로 덧붙임.",
      itemPlaceholder: "--tag",
      group: "advanced",
    },
    {
      kind: "envMap",
      key: "env",
      label: "Environment variables",
      help: "Factory 인증·설정 관련 변수.",
      group: "advanced",
      suggestions: [
        { key: "FACTORY_API_KEY", description: "Factory API key (헤드리스/CI 인증)" },
      ],
    },
  ],
};
