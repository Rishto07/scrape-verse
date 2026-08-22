import { useRef } from 'react';
import { motion, useMotionValue, useSpring, useReducedMotion } from 'framer-motion';

/**
 * Interactive cursor spotlight — follows the pointer with a soft radial glow.
 * Fixed, pointer-events-none, behind content (z-0). Respects reduced motion.
 */
export function CursorGlow() {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();

  const x = useMotionValue(-500);
  const y = useMotionValue(-500);

  const springX = useSpring(x, { stiffness: 80, damping: 20, mass: 0.5 });
  const springY = useSpring(y, { stiffness: 80, damping: 20, mass: 0.5 });

  function handleMove(e: React.MouseEvent) {
    if (reduce) return;
    x.set(e.clientX);
    y.set(e.clientY);
  }

  return (
    <div
      ref={ref}
      onMouseMove={handleMove}
      className="fixed inset-0 z-0 pointer-events-none"
      style={{ position: 'fixed' }}
    >
      <motion.div
        className="absolute w-[600px] h-[600px] rounded-full"
        style={{
          x: springX,
          y: springY,
          left: -300,
          top: -300,
          background: 'radial-gradient(circle, rgba(59,130,246,0.10) 0%, rgba(59,130,246,0.04) 40%, transparent 70%)',
          filter: 'blur(40px)',
        }}
      />
    </div>
  );
}
