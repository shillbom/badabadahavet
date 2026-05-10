import { motion, useMotionValue, useTransform, animate } from "framer-motion";
import { useEffect, useState } from "react";

type Props = {
  value: number;
  duration?: number;
  /** "1.5 km" — render the formatted output around the animated number. */
  format?: (n: number) => string;
  className?: string;
};

/**
 * Smoothly tweens to `value` whenever it changes. For integer stats we
 * round to whole numbers; pass a custom `format` for fractional values.
 */
export function AnimatedNumber({
  value,
  duration = 0.8,
  format,
  className,
}: Props) {
  const mv = useMotionValue(0);
  const rounded = useTransform(mv, (v) =>
    format ? format(v) : Math.round(v).toString(),
  );
  const [text, setText] = useState(() =>
    format ? format(value) : Math.round(value).toString(),
  );

  useEffect(() => {
    const controls = animate(mv, value, {
      duration,
      ease: [0.16, 1, 0.3, 1],
    });
    const unsub = rounded.on("change", setText);
    return () => {
      controls.stop();
      unsub();
    };
  }, [value, duration, mv, rounded]);

  return <motion.span className={className}>{text}</motion.span>;
}
