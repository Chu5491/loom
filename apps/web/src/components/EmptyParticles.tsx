// 빈 상태 배경의 떠다니는 점들. slim 번들이라 mouse trail 등 무거운 옵션은 빠짐.

import { useEffect, useState } from "react";
import Particles, { initParticlesEngine } from "@tsparticles/react";
import { loadSlim } from "@tsparticles/slim";
import type { ISourceOptions } from "@tsparticles/engine";
import { useTheme } from "../context/ThemeContext.js";

let initPromise: Promise<void> | null = null;

function options(color: string): ISourceOptions {
  return {
    background: { color: { value: "transparent" } },
    fpsLimit: 30,
    fullScreen: { enable: false },
    detectRetina: true,
    particles: {
      color: { value: color },
      links: { color, distance: 110, enable: true, opacity: 0.12, width: 1 },
      move: { enable: true, direction: "none", speed: 0.4, outModes: { default: "out" } },
      number: { value: 28, density: { enable: true, width: 800, height: 800 } },
      opacity: { value: { min: 0.15, max: 0.35 } },
      shape: { type: "circle" },
      size: { value: { min: 0.8, max: 2.0 } },
    },
  };
}

export function EmptyParticles({ className }: { className?: string }) {
  const { effective } = useTheme();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    initPromise ??= initParticlesEngine((engine) => loadSlim(engine));
    initPromise.then(() => setReady(true));
  }, []);

  if (!ready) return null;
  const color = effective === "dark" ? "#a1a1aa" : "#71717a";
  return (
    <Particles
      id="loom-empty-particles"
      className={className}
      options={options(color)}
    />
  );
}
