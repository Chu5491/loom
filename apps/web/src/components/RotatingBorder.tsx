// conic-gradient 회전 보더 빔. 부모에 `relative overflow-hidden rounded-*` 필요.
// 안쪽 매트(`bg-card`)가 inset만큼 깔려 컬러는 가장자리에만 비침.

import { motion } from "motion/react";

const DEFAULT_GRADIENT =
  "conic-gradient(from 0deg, rgb(14 165 233 / 0.95), rgb(217 70 239 / 0.95), rgb(16 185 129 / 0.95), rgb(14 165 233 / 0.95))";

export function RotatingBorder({
  active,
  duration = 6,
  inset = 1,
  gradient = DEFAULT_GRADIENT,
}: {
  active: boolean;
  duration?: number;
  inset?: number;
  gradient?: string;
}) {
  if (!active) return null;
  return (
    <>
      <motion.span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[inherit]"
        style={{ background: gradient }}
        animate={{ rotate: 360 }}
        transition={{ duration, repeat: Infinity, ease: "linear" }}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute rounded-[inherit] bg-card"
        style={{ inset }}
      />
    </>
  );
}
