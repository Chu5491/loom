import type { AdapterManifest } from "@loom/core";

/**
 * Renders an adapter's branded SVG when present, falling back to its short
 * `icon` letter on a tinted tile.
 */
export function AdapterIcon({
  manifest,
  size = 32,
  className,
}: {
  manifest: Pick<AdapterManifest, "icon" | "iconSvg" | "displayName">;
  size?: number;
  className?: string;
}) {
  const dim = `${size}px`;
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
        "inline-flex shrink-0 items-center justify-center rounded-md font-mono font-semibold bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 " +
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
  return svg.replace(
    /<svg(\s+[^>]*?)?>/i,
    (match) => {
      // Strip any existing width/height attributes; force ours.
      const stripped = match
        .replace(/\s+width="[^"]*"/i, "")
        .replace(/\s+height="[^"]*"/i, "");
      return stripped.replace(
        /<svg/i,
        `<svg width="${size}" height="${size}" style="display:block"`,
      );
    },
  );
}
