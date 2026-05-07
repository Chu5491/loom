// MCP 마켓플레이스 카탈로그.
//
// 출처: https://github.com/modelcontextprotocol/servers (공식 reference servers).
// 빌드 타임에 손으로 큐레이팅한 JSON — 런타임 fetch 안 함. 오프라인 동작 +
// 항상 같은 결과 (사용자가 같은 loom 빌드면 같은 카탈로그). 새 서버가 추가되면
// 이 파일을 수정 + 리빌드하면 됨.
//
// `template` 의 env / args 빈 값 placeholder = 사용자가 install 시 채워야 함.
// UI 가 "Install" 버튼 → 기존 MCP 추가 폼을 prefilled 로 열고, 사용자가 빈 값을
// 채우고 저장. 자동 활성화 안 함 (loom 의 원칙: 사용자 명시).

export interface MarketplaceMcp {
  /** 카탈로그 안에서 안정적인 id. dedup / "이미 설치됨" 체크용. */
  id: string;
  /** 화면 + 기본 server name (사용자 변경 가능). */
  name: string;
  /** 한 줄 설명. */
  description: string;
  /** GitHub / 공식 페이지. UI 에 "More" 링크. */
  source: string;
  /** 카드 우측 위 pill — Anthropic 공식 / 커뮤니티 등. */
  publisher: "Anthropic" | "Community";
  /** 필터 / 검색용. */
  tags: string[];
  /** install 시 prefill 될 server 설정. */
  template:
    | {
        kind: "stdio";
        command: string;
        args: string[];
        env: Record<string, string>;
      }
    | {
        kind: "http" | "sse";
        url: string;
        headers: Record<string, string>;
      };
  /** placeholder 안내 — 어떤 env 값 / arg 가 사용자 입력 필요한지. UI 의 hint. */
  placeholders?: Array<{
    /** env key 또는 args 의 인덱스 (e.g. "args[1]"). */
    where: string;
    label: string;
    hint?: string;
  }>;
}

export const MARKETPLACE: ReadonlyArray<MarketplaceMcp> = [
  {
    id: "filesystem",
    name: "filesystem",
    description:
      "Read / write files in a sandboxed directory tree. Useful for giving an agent scoped local FS access.",
    source: "https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem",
    publisher: "Anthropic",
    tags: ["files", "official"],
    template: {
      kind: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/allowed/dir"],
      env: {},
    },
    placeholders: [
      {
        where: "args[2]",
        label: "Allowed directory",
        hint: "Absolute path the server is permitted to read/write under.",
      },
    ],
  },
  {
    id: "github",
    name: "github",
    description:
      "Search code, read issues / PRs, and create issues against GitHub repositories.",
    source: "https://github.com/modelcontextprotocol/servers/tree/main/src/github",
    publisher: "Anthropic",
    tags: ["github", "official"],
    template: {
      kind: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: "" },
    },
    placeholders: [
      {
        where: "GITHUB_PERSONAL_ACCESS_TOKEN",
        label: "GitHub token",
        hint: "Classic or fine-grained PAT with repo scope.",
      },
    ],
  },
  {
    id: "git",
    name: "git",
    description:
      "Read commit history, diff, blame, and tree contents from a local git repo.",
    source: "https://github.com/modelcontextprotocol/servers/tree/main/src/git",
    publisher: "Anthropic",
    tags: ["git", "official"],
    template: {
      kind: "stdio",
      command: "uvx",
      args: ["mcp-server-git", "--repository", "/path/to/repo"],
      env: {},
    },
    placeholders: [
      {
        where: "args[2]",
        label: "Repository path",
        hint: "Absolute path to a local git repo.",
      },
    ],
  },
  {
    id: "fetch",
    name: "fetch",
    description: "Fetch a URL and return its contents as plain text or markdown.",
    source: "https://github.com/modelcontextprotocol/servers/tree/main/src/fetch",
    publisher: "Anthropic",
    tags: ["web", "official"],
    template: {
      kind: "stdio",
      command: "uvx",
      args: ["mcp-server-fetch"],
      env: {},
    },
  },
  {
    id: "memory",
    name: "memory",
    description:
      "A persistent knowledge graph the agent can write entities / observations / relations into across runs.",
    source: "https://github.com/modelcontextprotocol/servers/tree/main/src/memory",
    publisher: "Anthropic",
    tags: ["memory", "official"],
    template: {
      kind: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-memory"],
      env: {},
    },
  },
  {
    id: "sequentialthinking",
    name: "sequentialthinking",
    description:
      "A 'think step-by-step' tool: lets the agent revise its own plan as it goes.",
    source:
      "https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking",
    publisher: "Anthropic",
    tags: ["reasoning", "official"],
    template: {
      kind: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-sequential-thinking"],
      env: {},
    },
  },
  {
    id: "time",
    name: "time",
    description:
      "Time + timezone utilities — current time, conversions, formatting.",
    source: "https://github.com/modelcontextprotocol/servers/tree/main/src/time",
    publisher: "Anthropic",
    tags: ["utilities", "official"],
    template: {
      kind: "stdio",
      command: "uvx",
      args: ["mcp-server-time"],
      env: {},
    },
  },
  {
    id: "everything",
    name: "everything",
    description:
      "Reference / test server that exercises every MCP feature. Useful for trying loom's MCP wiring without setting anything up.",
    source: "https://github.com/modelcontextprotocol/servers/tree/main/src/everything",
    publisher: "Anthropic",
    tags: ["test", "official"],
    template: {
      kind: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-everything"],
      env: {},
    },
  },
];
