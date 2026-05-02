import { useState } from "react";
import type { TestAdapterResult } from "@loom/core";
import { api } from "../api/client.js";
import { useI18n } from "../context/I18nContext.js";
import { Button } from "./ui.js";

/**
 * "Test connection" button — sends a tiny prompt through the adapter and
 * shows whatever the CLI replies with. Verifies the full path: binary +
 * auth + model + (whatever the CLI does to reach the provider).
 */
export function AdapterTestButton({
  kind,
  config,
  cwd,
}: {
  kind: string;
  config: Record<string, unknown>;
  cwd?: string;
}) {
  const { t } = useI18n();
  const [result, setResult] = useState<TestAdapterResult | null>(null);
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
    setResult(null);
    try {
      const { test } = await api.testAdapter(kind, { config, cwd });
      setResult(test);
    } catch (err) {
      setResult({
        ok: false,
        durationMs: 0,
        exitCode: null,
        output: "",
        stderr: "",
        error: (err as Error).message,
      });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={run}
          disabled={running}
        >
          {running ? t("adapter.test.running") : t("adapter.test.button")}
        </Button>
        <span className="text-xs text-muted-foreground">
          {t("adapter.test.hint")}
        </span>
      </div>
      {result ? <TestResult result={result} /> : null}
    </div>
  );
}

function TestResult({ result }: { result: TestAdapterResult }) {
  const { t } = useI18n();
  const ok = result.ok;
  const tone = ok
    ? "border-emerald-300 bg-emerald-50 dark:border-emerald-900/50 dark:bg-emerald-950/30"
    : "border-red-300 bg-red-50 dark:border-red-900/50 dark:bg-red-950/30";

  const icon = ok ? "✓" : "✗";
  const iconColor = ok
    ? "text-success"
    : "text-destructive";

  return (
    <div className={`rounded-md border p-3 text-xs space-y-2 ${tone}`}>
      <div className="flex items-center justify-between">
        <span className={`font-semibold ${iconColor}`}>
          {icon}{" "}
          {result.timedOut
            ? t("adapter.test.timedOut")
            : ok
              ? t("adapter.test.passed")
              : t("adapter.test.failed")}
        </span>
        <span className="text-muted-foreground mono">
          {(result.durationMs / 1000).toFixed(2)}s
          {result.exitCode !== null ? ` · exit ${result.exitCode}` : ""}
        </span>
      </div>
      {result.output ? (
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">
            {t("adapter.test.response")}
          </div>
          <pre className="mono whitespace-pre-wrap break-words bg-muted rounded p-2 text-foreground/90 max-h-32 overflow-y-auto">
            {result.output}
          </pre>
        </div>
      ) : null}
      {result.error ? (
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">
            {t("adapter.test.error")}
          </div>
          <pre className="mono whitespace-pre-wrap break-words text-destructive">
            {result.error}
          </pre>
        </div>
      ) : null}
      {result.stderr && !ok ? (
        <details>
          <summary className="cursor-pointer text-muted-foreground">{t("adapter.test.stderr")}</summary>
          <pre className="mono whitespace-pre-wrap break-words bg-muted rounded p-2 mt-1 text-foreground/90 max-h-40 overflow-y-auto">
            {result.stderr}
          </pre>
        </details>
      ) : null}
    </div>
  );
}
