import { AnimatePresence, m } from "framer-motion";
import { useEffect, useRef, useState } from "react";

type Props = {
  value: number;
  duration?: number;
  /** "1.5 km" — render the formatted output around the animated number. */
  format?: (n: number) => string;
  className?: string;
};

/** A single digit slot that steps from its current value to `char` at a
 *  rate that always takes exactly `duration` seconds in total. */
function DigitSlot({
  char,
  dir,
  duration,
}: {
  char: string;
  dir: 1 | -1;
  duration: number;
}) {
  const isDigit = /\d/.test(char);
  const target = isDigit ? parseInt(char, 10) : 0;
  const currentRef = useRef(0);
  const stepDurationRef = useRef(
    isDigit && target > 0 ? duration / target : duration,
  );
  const [displayed, setDisplayed] = useState(isDigit ? "0" : char);

  useEffect(() => {
    const timeouts: ReturnType<typeof setTimeout>[] = [];

    if (!isDigit) {
      setDisplayed(char);
    } else {
      const from = currentRef.current;
      const steps = Math.abs(target - from);

      if (steps > 0) {
        const stepDuration = duration / steps;
        stepDurationRef.current = stepDuration;
        const step = target > from ? 1 : -1;

        for (let i = 1; i <= steps; i++) {
          const val = from + i * step;
          timeouts.push(
            window.setTimeout(
              () => {
                currentRef.current = val;
                setDisplayed(String(val));
              },
              i * stepDuration * 1000,
            ),
          );
        }
      }
    }

    return () => timeouts.forEach(window.clearTimeout);
  }, [char]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <span className="relative inline-block overflow-hidden">
      <AnimatePresence mode="popLayout" initial={false}>
        <m.span
          key={displayed}
          initial={{ y: dir > 0 ? 8 : -8, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: dir > 0 ? -8 : 8, opacity: 0 }}
          transition={{
            duration: stepDurationRef.current * 0.85,
            ease: "circInOut",
          }}
          className="inline-block"
        >
          {displayed}
        </m.span>
      </AnimatePresence>
    </span>
  );
}

/**
 * Animates each digit individually to its target value, giving an
 * odometer-style rolling effect.
 */
export function AnimatedNumber({
  value,
  duration = 0.7,
  format,
  className,
}: Props) {
  const text = format ? format(value) : Math.round(value).toString();
  // Track the previous value in an effect (after commit) to pick the slide
  // direction, keeping render pure — no ref writes or set-state during render.
  // setDir re-renders synchronously, well before the digit-step timeouts fire,
  // so the direction is settled before anything animates.
  const prevValueRef = useRef(value);
  const [dir, setDir] = useState<1 | -1>(1);
  useEffect(() => {
    if (value !== prevValueRef.current) {
      setDir(value >= prevValueRef.current ? 1 : -1);
      prevValueRef.current = value;
    }
  }, [value]);

  const chars = text.split("");

  return (
    <span className={`inline-flex ${className ?? ""}`}>
      {chars.map((char, i) => (
        <DigitSlot
          // oxlint-disable-next-line react/no-array-index-key
          key={chars.length - 1 - i}
          char={char}
          dir={dir}
          duration={duration}
        />
      ))}
    </span>
  );
}
