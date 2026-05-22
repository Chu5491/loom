/**
 * Adapter manifest — UI / discovery metadata served via /api/adapters.
 * The web UI uses this to render the agent creation form without any hardcoded
 * adapter knowledge.
 */
import type { AdapterKind } from "./types.js";

export interface PolicyWarning {
  /** "info" = neutral notice, "warn" = yellow, "danger" = red/blocking. */
  level: "info" | "warn" | "danger";
  /** Short title shown in the banner header. */
  title: string;
  /** Longer explanation. UI renders as markdown. */
  body: string;
  /** Optional link for the user to read more. */
  url?: string;
}

export interface AdapterManifest {
  kind: AdapterKind;
  /** Short human-friendly name shown in the picker (e.g. "Claude Code"). */
  displayName: string;
  /** One-line description shown in the picker. */
  description: string;
  /** Single-character or short emoji fallback (used when iconSvg is absent). */
  icon?: string;
  /** Inline SVG markup for a branded icon. Must be self-contained (no external refs). */
  iconSvg?: string;
  /** Documentation URL for this adapter. */
  docsUrl?: string;
  /** Default `command` (binary name we look up on PATH). */
  defaultCommand: string;
  /** Defaults applied when creating a new agent of this kind. */
  defaultConfig: Record<string, unknown>;
  /** Form fields rendered in order. */
  fields: AdapterField[];
  /** Policy/legal warnings shown in the agent creation form and run UI. */
  policyWarnings?: PolicyWarning[];
}

export type AdapterField =
  | AdapterStringField
  | AdapterBooleanField
  | AdapterSelectField
  | AdapterStringListField
  | AdapterEnvMapField;

export interface AdapterFieldBase {
  /** Path inside the adapter config object. */
  key: string;
  /** English label, used as fallback when no i18n key resolves. */
  label: string;
  /** English help text, shown under the field. */
  help?: string;
  /** Group key — UI may visually group fields with the same group. */
  group?: "basic" | "advanced";
  /**
   * Marks the field as security-sensitive. UI renders in a warning box with a
   * shield icon and explicit copy. Use for "skip permissions" / "auto-approve" toggles.
   */
  danger?: boolean;
}

export interface AdapterStringField extends AdapterFieldBase {
  kind: "string";
  placeholder?: string;
}

export interface AdapterBooleanField extends AdapterFieldBase {
  kind: "boolean";
}

export interface AdapterSelectOption {
  value: string;
  label: string;
  description?: string;
  /** Optional grouping label — UI renders as <optgroup>. Used to group models by family / tier. */
  category?: string;
}

export interface AdapterSelectField extends AdapterFieldBase {
  kind: "select";
  options: AdapterSelectOption[];
  /** Allow free-form value not in `options`. Default false. */
  allowCustom?: boolean;
  placeholder?: string;
}

export interface AdapterStringListField extends AdapterFieldBase {
  kind: "stringList";
  itemPlaceholder?: string;
}

export interface AdapterEnvMapField extends AdapterFieldBase {
  kind: "envMap";
  /** Suggested env keys, rendered as quick-add chips above the editor. */
  suggestions?: EnvSuggestion[];
}

export interface EnvSuggestion {
  key: string;
  description?: string;
  /** True if this variable is required for auth. UI may emphasize. */
  required?: boolean;
}

// ---------------------------------------------------------------------------
// Probe — runtime "is this adapter ready?" check, served via
// GET /api/adapters/:kind/probe.
// ---------------------------------------------------------------------------

export interface AdapterProbeResult {
  binary: BinaryStatus;
  auth: AuthStatus;
  /** When this probe was generated (server time, ISO 8601). */
  checkedAt: string;
}

export interface BinaryStatus {
  /** True iff the binary is on PATH (or at the configured absolute path). */
  available: boolean;
  /** The command we resolved (`claude`, `/opt/homebrew/bin/claude`, etc.). */
  command: string;
  /** Version string parsed from `<cmd> --version`, if available. */
  version?: string;
  /** Resolved absolute path on disk, if obtainable. */
  path?: string;
  /** Human-readable error if the probe failed. */
  error?: string;
}

export type AuthState =
  /** API key / login token confirmed via env var or local credential file. */
  | "authenticated"
  /** Binary works but no credential signal found. */
  | "unauthenticated"
  /** Could not determine (e.g. binary not installed). */
  | "unknown";

export interface AuthStatus {
  state: AuthState;
  /** One-line explanation: which env var / file was found, or what's missing. */
  hint?: string;
}

export interface ProbeInput {
  /** Optional `command` override matching the agent's adapter_config.command. */
  command?: string;
}

export type ProbeFn = (input: ProbeInput) => Promise<AdapterProbeResult>;

// ---------------------------------------------------------------------------
// Live model listing — served via GET /api/adapters/:kind/models.
// Each adapter may optionally fetch its provider's live model catalogue;
// adapters without a `listModels` impl fall back to manifest preset options.
// ---------------------------------------------------------------------------

export interface ModelListResult {
  /** Where the data came from. UI shows this so the user knows what they're seeing. */
  source: "live" | "presets" | "error";
  models: AdapterSelectOption[];
  /** When the result was generated (server time, ISO 8601). */
  fetchedAt: string;
  /** Human-readable status / hint. */
  hint?: string;
  /** Error detail when source === "error". */
  error?: string;
}

export interface ListModelsInput {
  /** Optional `command` override matching the agent's adapter_config.command. */
  command?: string;
}

export type ListModelsFn = (input: ListModelsInput) => Promise<ModelListResult>;

// ---------------------------------------------------------------------------
// Connection test — POST /api/adapters/:kind/test runs a tiny prompt through
// the adapter to verify the full stack actually works (binary + auth + model).
// Distinct from probe (which only checks binary presence + credential signal).
// ---------------------------------------------------------------------------

export interface TestAdapterResult {
  /** True iff the adapter spawned, exited with code 0, wasn't killed by timeout. */
  ok: boolean;
  /** Wall-clock duration of the spawn in ms. */
  durationMs: number;
  /** Process exit code; null if it never exited (e.g. spawn failure). */
  exitCode: number | null;
  /** Cleaned final response text — parsed `result` field for stream-json adapters. */
  output: string;
  /** Tail of stderr (≤500 chars). */
  stderr: string;
  /** Set when an exception was thrown before the process exited. */
  error?: string;
  /** True iff the test was killed by our timeout. */
  timedOut?: boolean;
}
