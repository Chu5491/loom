import { cn } from "../lib/utils.js";

/**
 * loom brand mark — rendered from a static PNG so the logo art lives
 * outside of code (designers can iterate on it without touching React).
 *
 * The asset itself is at `apps/web/public/loom-logo.png`. Vite serves
 * `public/*` at the site root, so the `/loom-logo.png` path below
 * resolves both in dev (`pnpm dev`) and in built bundles.
 *
 * Sizing comes from the parent — pass any `size-N` (or `w-N h-N`)
 * Tailwind class on `className` and the image fills it via
 * `object-contain`, which keeps the chain-link aspect intact even on
 * non-square containers.
 */
export function LoomLogo({
  className,
  tilt = 0,
}: {
  className?: string;
  /** Optional additional clockwise rotation applied via CSS. The PNG
   *  already carries its own tilt, so the default is 0. Useful if you
   *  want to push the logo a few extra degrees in a specific spot. */
  tilt?: number;
}) {
  return (
    <img
      src="/loom-logo.png"
      alt="loom"
      draggable={false}
      className={cn(
        "size-full object-contain select-none pointer-events-none",
        className,
      )}
      style={tilt !== 0 ? { transform: `rotate(${tilt}deg)` } : undefined}
    />
  );
}
