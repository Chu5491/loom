import {
  ClaudeCode,
  Codex,
  Gemini,
  OpenCode,
} from "@lobehub/icons";
import type { AdapterManifest } from "@loom/core";

/**
 * Renders a brand mark for a CLI adapter.
 *
 * Built-in CLIs (claude-code / gemini / codex / opencode) get the
 * official-looking lobehub icons. Anything else falls back to the
 * adapter's own `iconSvg` (server-controlled), and finally to the
 * one-letter `icon` glyph if no SVG was supplied.
 */

// Each lobehub icon is a compound component (Mono base + Color/Avatar/etc.
// subcomponents). We only use the multi-color `.Color` variant.
const KIND_TO_LOBE = {
  "claude-code": ClaudeCode,
  gemini: Gemini,
  codex: Codex,
  opencode: OpenCode,
} as const;

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
  const lobe = KIND_TO_LOBE[manifest.kind as keyof typeof KIND_TO_LOBE] as
    | { Color: React.ComponentType<{ size?: number | string }> }
    | undefined;
  if (lobe) {
    const ColorIcon = lobe.Color;
    return (
      <span
        role="img"
        aria-label={manifest.displayName}
        className={"inline-flex shrink-0 items-center justify-center " + (className ?? "")}
        style={{ width: dim, height: dim }}
      >
        <ColorIcon size={size} />
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
