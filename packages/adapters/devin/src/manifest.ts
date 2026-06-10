import type { AdapterManifest } from "@loom/core";
import { DEVIN_PRESET_MODELS } from "./preset-models.js";

// Devin brand mark — three interlocking cubes (green / blue / light-blue).
const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 27.93 32" aria-hidden="true"><path d="M19.33 14.12c.67-.39 1.5-.39 2.18 0l1.74 1c.06.03.11.06.18.07h.04c.06.03.12.03.18.03h.02c.06 0 .11 0 .17-.02h.03c.06-.02.12-.05.17-.08h.02l3.48-2.01c.25-.14.4-.41.4-.7V8.4a.81.81 0 0 0-.4-.7l-3.48-2.01a.83.83 0 0 0-.81 0L19.77 7.7h-.01l-.15.12-.02.02s-.07.09-.1.14V8a.4.4 0 0 0-.08.17v.04c-.03.06-.03.12-.03.19v2.01c0 .78-.41 1.49-1.09 1.88-.67.39-1.5.39-2.18 0l-1.74-1a.6.6 0 0 0-.21-.08c-.06-.01-.12-.02-.18-.02h-.03c-.06 0-.11.01-.17.02h-.03c-.06.02-.12.04-.17.07h-.02l-3.47 2.01c-.25.14-.4.41-.4.7V18c0 .29.15.55.4.7l3.48 2.01h.02c.06.04.11.06.17.08h.03c.05.02.11.03.17.03h.02c.06 0 .12 0 .18-.02h.04c.06-.03.12-.05.18-.08l1.74-1c.67-.39 1.5-.39 2.17 0s1.09 1.11 1.09 1.88v2.01c0 .07 0 .13.02.19v.04c.03.06.05.12.08.17v.02s.08.09.12.13l.02.02s.09.08.15.11c0 0 .01 0 .01.01l3.48 2.01c.25.14.56.14.81 0l3.48-2.01c.25-.14.4-.41.4-.7v-4.01a.81.81 0 0 0-.4-.7l-3.48-2.01h-.02c-.05-.04-.11-.06-.17-.08h-.03a.5.5 0 0 0-.17-.03h-.03c-.06 0-.12 0-.18.02-.07.02-.15.05-.21.08l-1.74 1c-.67.39-1.5.39-2.17 0a2.19 2.19 0 0 1-1.09-1.88c0-.78.42-1.49 1.09-1.88Z" style="fill:#5dbf9d"/><path d="m.4 13.11 3.47 2.01c.25.14.56.14.8 0l3.47-2.01h.01l.15-.12.02-.02s.07-.09.1-.14l.02-.02c.03-.05.05-.11.07-.17v-.04c.03-.06.03-.12.03-.19V10.4c0-.78.42-1.49 1.09-1.88s1.5-.39 2.18 0l1.74 1c.07.04.14.07.21.08.06.01.12.02.18.02h.03c.06 0 .11-.01.17-.02h.03c.06-.02.12-.04.17-.07h.02l3.47-2.02c.25-.14.4-.41.4-.7v-4a.81.81 0 0 0-.4-.7l-3.46-2a.83.83 0 0 0-.81 0l-3.48 2.01h-.01l-.15.12-.02.02-.1.13-.02.02c-.03.05-.05.11-.07.17v.04c-.03.06-.03.12-.03.19v2.01c0 .78-.42 1.49-1.09 1.88s-1.5.39-2.18 0l-1.74-1a.6.6 0 0 0-.21-.08c-.06-.01-.12-.02-.18-.02h-.03c-.06 0-.11.01-.17.02h-.03c-.06.02-.12.05-.17.08h-.02L.4 7.71c-.25.14-.4.41-.4.69v4.01c0 .29.15.56.4.7" style="fill:#4468c4"/><path d="m17.84 24.48-3.48-2.01h-.02c-.05-.04-.11-.06-.17-.08h-.03a.5.5 0 0 0-.17-.03h-.03c-.06 0-.12 0-.18.02h-.04c-.06.03-.12.05-.18.08l-1.74 1c-.67.39-1.5.39-2.18 0a2.19 2.19 0 0 1-1.09-1.88v-2.01c0-.06 0-.13-.02-.19v-.04c-.03-.06-.05-.11-.08-.17l-.02-.02s-.06-.09-.1-.13L8.29 19s-.09-.08-.15-.11h-.01l-3.47-2.02a.83.83 0 0 0-.81 0L.37 18.88a.87.87 0 0 0-.37.71v4.01c0 .29.15.55.4.7l3.47 2.01h.02c.05.04.11.06.17.08h.03c.05.02.11.03.16.03h.03c.06 0 .12 0 .18-.02h.04c.06-.03.12-.05.18-.08l1.74-1c.67-.39 1.5-.39 2.17 0s1.09 1.11 1.09 1.88v2.01c0 .07 0 .13.02.19v.04c.03.06.05.11.08.17l.02.02s.06.09.1.14l.02.02s.09.08.15.11h.01l3.48 2.02c.25.14.56.14.81 0l3.48-2.01c.25-.14.4-.41.4-.7V25.2a.81.81 0 0 0-.4-.7Z" style="fill:#4293d9"/></svg>`;

export const devinManifest: AdapterManifest = {
  kind: "devin",
  displayName: "Devin CLI",
  description:
    "Cognition's Devin — a fast, minimal agent that lives in your terminal and the cloud.",
  icon: "D",
  iconSvg: ICON_SVG,
  docsUrl: "https://docs.devin.ai/",
  defaultCommand: "devin",
  defaultConfig: {},
  policyWarnings: [
    {
      level: "warn",
      title: "Devin account required — sign in first",
      body: "Authenticate with `devin auth` (or `devin setup`). A Devin / Cognition account and its billing apply.",
      url: "https://devin.ai",
    },
    {
      level: "info",
      title: "MCP via project-local config",
      body: "Loom injects MCP servers by writing `.devin/config.local.json` in the run's working directory (devin's project-local config — your `~/.config/devin` is never touched). Add `.devin/` to that project's .gitignore.",
      url: "https://docs.devin.ai/",
    },
    {
      level: "info",
      title: "No cross-turn session resume from Loom",
      body: "Devin's --print output isn't machine-parsed for a session id, so each Loom run is a fresh turn. Use `devin -c` / `devin --resume` directly in a terminal for continuity.",
    },
  ],
  fields: [
    {
      kind: "select",
      key: "model",
      label: "Model",
      help: "Devin routes to the chosen model. Leave empty for Devin's default. Use Custom… for any id.",
      options: DEVIN_PRESET_MODELS,
      allowCustom: true,
      placeholder: "Devin default",
      group: "basic",
    },
    {
      kind: "boolean",
      key: "dangerouslySkipPermissions",
      label: "Auto-approve all tools (--permission-mode dangerous)",
      help: "Default is 'auto' (read-only tools auto-approved, writes prompt). Enable to auto-approve writes/execs too — only in trusted, sandboxed directories.",
      group: "basic",
      danger: true,
    },
    {
      kind: "string",
      key: "command",
      label: "Command override",
      help: "Absolute path or alternative binary name. Defaults to `devin` on PATH.",
      placeholder: "devin",
      group: "advanced",
    },
    {
      kind: "stringList",
      key: "extraArgs",
      label: "Extra args",
      help: "Appended to the CLI command verbatim.",
      itemPlaceholder: "--sandbox",
      group: "advanced",
    },
    {
      kind: "envMap",
      key: "env",
      label: "Environment variables",
      help: "Click a suggestion to add it.",
      group: "advanced",
      suggestions: [
        { key: "DEVIN_MODEL", description: "Pin a default model via env" },
        { key: "DEVIN_PERMISSION_MODE", description: "auto | dangerous" },
        { key: "DEVIN_API_KEY", description: "API key (if your setup uses one)" },
      ],
    },
  ],
};
