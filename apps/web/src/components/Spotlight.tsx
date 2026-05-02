// 커서 따라가는 컬러 그라디언트. 부모는 `relative overflow-hidden group`을 가져야 함.
// useMotionValue로 60fps에 React 렌더 없이 갱신.

import { useRef } from "react";
import {
  motion,
  useMotionTemplate,
  useMotionValue,
  type MotionStyle,
} from "motion/react";

export function Spotlight({
  className,
  size = 240,
  color = "rgb(14 165 233 / 0.18)",
}: {
  className?: string;
  size?: number;
  color?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const x = useMotionValue(-1000);
  const y = useMotionValue(-1000);

  const onMouseMove = (e: React.MouseEvent) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    x.set(e.clientX - rect.left);
    y.set(e.clientY - rect.top);
  };

  const onLeave = () => {
    x.set(-1000);
    y.set(-1000);
  };

  const background = useMotionTemplate`radial-gradient(${size}px circle at ${x}px ${y}px, ${color}, transparent 70%)`;

  return (
    <div
      ref={ref}
      onMouseMove={onMouseMove}
      onMouseLeave={onLeave}
      className={
        "pointer-events-auto absolute inset-0 -z-10 rounded-[inherit] " +
        (className ?? "")
      }
    >
      <motion.div
        aria-hidden
        className="absolute inset-0 rounded-[inherit] opacity-0 transition-opacity duration-200 group-hover:opacity-100"
        style={{ background } as MotionStyle}
      />
    </div>
  );
}
