import ClaudeCodeColor from "@lobehub/icons/es/ClaudeCode/components/Color";
import CodexColor from "@lobehub/icons/es/Codex/components/Color";
import GeminiColor from "@lobehub/icons/es/Gemini/components/Color";
// OpenCode ships only a Mono (single-color) variant in lobehub.
import OpenCodeMono from "@lobehub/icons/es/OpenCode/components/Mono";
import type { AdapterManifest } from "@loom/core";

/**
 * Renders a brand mark for a CLI adapter.
 *
 * Built-in CLIs (claude-code / gemini / codex / opencode) get the
 * official-looking lobehub icons. Anything else falls back to the
 * adapter's own `iconSvg` (server-controlled), and finally to the
 * one-letter `icon` glyph if no SVG was supplied.
 *
 * We deep-import each lobehub `.Color` component instead of doing
 * `ClaudeCode.Color` from the top-level export — the compound-component
 * attribute pattern lobehub uses (`Icons.Color = Color`) doesn't survive
 * Vite's dependency pre-bundling cleanly.
 */

type LobeIcon = React.ComponentType<{ size?: number | string }>;

const KIND_TO_LOBE: Record<string, LobeIcon> = {
  "claude-code": ClaudeCodeColor as LobeIcon,
  gemini: GeminiColor as LobeIcon,
  codex: CodexColor as LobeIcon,
  opencode: OpenCodeMono as LobeIcon,
};

export function AdapterIcon({
  manifest,
  size = 32,
  className,
}: {
  manifest: Pick<AdapterManifest, "kind" | "icon" | "iconSvg" | "displayName">;
  size?: number;
  className?: string;
}) {
  const dim = `${size}px`;
  const Icon = KIND_TO_LOBE[manifest.kind];
  if (Icon) {
    return (
      <span
        role="img"
        aria-label={manifest.displayName}
        className={"inline-flex shrink-0 items-center justify-center " + (className ?? "")}
        style={{ width: dim, height: dim }}
      >
        <Icon size={size} />
      </span>
    );
  }

  if (manifest.iconSvg) {
    return (
      <span
        role="img"
        aria-label={manifest.displayName}
        className={"inline-flex shrink-0 items-center justify-center " + (className ?? "")}
        style={{ width: dim, height: dim }}
        // The SVG comes from the trusted server-controlled manifest, not user input.
        dangerouslySetInnerHTML={{ __html: scaleSvg(manifest.iconSvg, size) }}
      />
    );
  }

  return (
    <span
      aria-label={manifest.displayName}
      className={
        "inline-flex shrink-0 items-center justify-center rounded-md font-mono font-semibold bg-muted text-muted-foreground " +
        (className ?? "")
      }
      style={{ width: dim, height: dim, fontSize: size * 0.5 }}
    >
      {manifest.icon ?? "?"}
    </span>
  );
}

/** Inject explicit width/height into the SVG so it sizes regardless of viewBox. */
function scaleSvg(svg: string, size: number): string {
  return svg.replace(/<svg(\s+[^>]*?)?>/i, (match) => {
    const stripped = match
      .replace(/\s+width="[^"]*"/i, "")
      .replace(/\s+height="[^"]*"/i, "");
    return stripped.replace(
      /<svg/i,
      `<svg width="${size}" height="${size}" style="display:block"`,
    );
  });
}
