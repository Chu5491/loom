import type {
  AdapterConfig,
  AdapterManifest,
  AdapterProbeResult,
  CliAdapter,
  ListModelsFn,
  ModelListResult,
  ProbeFn,
  TestAdapterResult,
} from "@loom/core";
import {
  claudeCodeAdapter,
  claudeCodeListModels,
  claudeCodeManifest,
  claudeCodeProbe,
} from "@loom/adapter-claude-code";
import {
  codexAdapter,
  codexListModels,
  codexManifest,
  codexProbe,
} from "@loom/adapter-codex";
import {
  geminiAdapter,
  geminiListModels,
  geminiManifest,
  geminiProbe,
} from "@loom/adapter-gemini";
import {
  opencodeAdapter,
  opencodeListModels,
  opencodeManifest,
  opencodeProbe,
} from "@loom/adapter-opencode";

interface RegistryEntry {
  adapter: CliAdapter;
  manifest: AdapterManifest;
  probe?: ProbeFn;
  listModels?: ListModelsFn;
}

const entries = new Map<string, RegistryEntry>();

export interface AdapterRegistration {
  manifest?: AdapterManifest;
  probe?: ProbeFn;
  listModels?: ListModelsFn;
}

export function registerAdapter(
  adapter: CliAdapter,
  reg: AdapterRegistration = {},
): void {
  entries.set(adapter.kind, {
    adapter,
    manifest: reg.manifest ?? fallbackManifest(adapter),
    probe: reg.probe,
    listModels: reg.listModels,
  });
}

export function getAdapter(kind: string): CliAdapter | null {
  return entries.get(kind)?.adapter ?? null;
}

export function getManifest(kind: string): AdapterManifest | null {
  return entries.get(kind)?.manifest ?? null;
}

export function listManifests(): AdapterManifest[] {
  return [...entries.values()].map((e) => e.manifest);
}

export function listAdapterKinds(): string[] {
  return [...entries.keys()];
}

export function clearAdapters(): void {
  entries.clear();
  probeCache.clear();
  modelsCache.clear();
}

// ---------------------------------------------------------------------------
// Caching layer. Spawning child processes (probe) and hitting external APIs
// (listModels) are both expensive enough that we don't want to run them per
// page paint. TTLs are tight so users see fresh data without manual refresh.
// ---------------------------------------------------------------------------

const PROBE_TTL_MS = 30_000;
const MODELS_TTL_MS = 5 * 60_000;

interface CacheEntry<T> {
  promise: Promise<T>;
  expiresAt: number;
}

const probeCache = new Map<string, CacheEntry<AdapterProbeResult>>();
const modelsCache = new Map<string, CacheEntry<ModelListResult>>();

function memoize<T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  ttl: number,
  fn: () => Promise<T>,
  refresh: boolean,
): Promise<T> {
  const cached = cache.get(key);
  if (!refresh && cached && cached.expiresAt > Date.now()) {
    return cached.promise;
  }
  const promise = fn();
  cache.set(key, { promise, expiresAt: Date.now() + ttl });
  promise.catch(() => cache.delete(key));
  return promise;
}

export interface ProbeOptions {
  command?: string;
  refresh?: boolean;
}

export async function probeAdapter(
  kind: string,
  options: ProbeOptions = {},
): Promise<AdapterProbeResult | null> {
  const entry = entries.get(kind);
  if (!entry) return null;
  if (!entry.probe) {
    return {
      binary: {
        available: false,
        command: options.command ?? entry.manifest.defaultCommand,
        error: "no probe defined",
      },
      auth: { state: "unknown" },
      checkedAt: new Date().toISOString(),
    };
  }
  const cacheKey = `${kind}::${options.command ?? ""}`;
  return memoize(
    probeCache,
    cacheKey,
    PROBE_TTL_MS,
    () => entry.probe!({ command: options.command }),
    options.refresh ?? false,
  );
}

export interface ListModelsOptions {
  command?: string;
  refresh?: boolean;
}

export async function listModelsForAdapter(
  kind: string,
  options: ListModelsOptions = {},
): Promise<ModelListResult | null> {
  const entry = entries.get(kind);
  if (!entry) return null;
  if (!entry.listModels) {
    return {
      source: "presets",
      models: extractPresetModels(entry.manifest),
      fetchedAt: new Date().toISOString(),
      hint: "This adapter has no live model fetcher; using manifest presets.",
    };
  }
  const cacheKey = `${kind}::${options.command ?? ""}`;
  return memoize(
    modelsCache,
    cacheKey,
    MODELS_TTL_MS,
    () => entry.listModels!({ command: options.command }),
    options.refresh ?? false,
  );
}

// ---------------------------------------------------------------------------
// Connection test — short, no DB persistence, no log file. Spawns the adapter
// with a tiny prompt and returns whatever the CLI replied.
// ---------------------------------------------------------------------------

const TEST_TIMEOUT_MS = 30_000;
const DEFAULT_TEST_PROMPT = "Reply with exactly the single word: ok";

export interface TestAdapterOptions {
  config: AdapterConfig;
  prompt?: string;
  cwd?: string;
}

export async function testAdapter(
  kind: string,
  opts: TestAdapterOptions,
): Promise<TestAdapterResult | null> {
  const entry = entries.get(kind);
  if (!entry) return null;

  const prompt = opts.prompt ?? DEFAULT_TEST_PROMPT;
  const cwd = opts.cwd ?? process.cwd();

  const stdoutBuf: string[] = [];
  const stderrBuf: string[] = [];
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, TEST_TIMEOUT_MS);

  const startedAt = Date.now();
  try {
    const handle = await entry.adapter.spawn(
      {
        prompt,
        cwd,
        env: {},
        signal: ctrl.signal,
        onStdout: (c) => stdoutBuf.push(c),
        onStderr: (c) => stderrBuf.push(c),
      },
      opts.config,
    );
    const result = await handle.promise;
    clearTimeout(timer);
    const durationMs = Date.now() - startedAt;
    return {
      ok: !timedOut && result.exitCode === 0,
      durationMs,
      exitCode: result.exitCode,
      output: extractResultText(stdoutBuf.join("")),
      stderr: stderrBuf.join("").trim().slice(-500),
      timedOut: timedOut || undefined,
    };
  } catch (err) {
    clearTimeout(timer);
    return {
      ok: false,
      durationMs: Date.now() - startedAt,
      exitCode: null,
      output: extractResultText(stdoutBuf.join("")),
      stderr: stderrBuf.join("").trim().slice(-500),
      error: (err as Error).message,
      timedOut: timedOut || undefined,
    };
  }
}

/**
 * Pulls the most useful response text out of an adapter's stdout. Recognizes
 * the stream-json `{type:"result", result:"..."}` final event used by Claude
 * Code, Gemini, and Codex; falls back to the tail of raw stdout otherwise.
 */
function extractResultText(stdout: string): string {
  const lines = stdout.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]?.trim();
    if (!line) continue;
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      if (parsed?.type === "result") {
        if (typeof parsed.result === "string" && parsed.result) {
          return parsed.result;
        }
        const errStatus = parsed.api_error_status;
        if (parsed.is_error || errStatus) {
          return `[error] ${JSON.stringify(parsed).slice(0, 300)}`;
        }
      }
    } catch {
      // not JSON, keep looking
    }
  }
  return stdout.trim().slice(-500);
}

function extractPresetModels(manifest: AdapterManifest) {
  const modelField = manifest.fields.find(
    (f) => f.kind === "select" && f.key === "model",
  );
  if (modelField && modelField.kind === "select") return modelField.options;
  return [];
}

function fallbackManifest(adapter: CliAdapter): AdapterManifest {
  return {
    kind: adapter.kind,
    displayName: adapter.kind,
    description: "",
    defaultCommand: adapter.kind,
    defaultConfig: {},
    fields: [],
  };
}

const builtIns: Array<[CliAdapter, AdapterRegistration]> = [
  [
    claudeCodeAdapter,
    {
      manifest: claudeCodeManifest,
      probe: claudeCodeProbe,
      listModels: claudeCodeListModels,
    },
  ],
  [
    geminiAdapter,
    {
      manifest: geminiManifest,
      probe: geminiProbe,
      listModels: geminiListModels,
    },
  ],
  [
    codexAdapter,
    { manifest: codexManifest, probe: codexProbe, listModels: codexListModels },
  ],
  [
    opencodeAdapter,
    {
      manifest: opencodeManifest,
      probe: opencodeProbe,
      listModels: opencodeListModels,
    },
  ],
];
for (const [adapter, reg] of builtIns) registerAdapter(adapter, reg);
