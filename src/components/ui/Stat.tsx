import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { cn } from "@/lib/utils";

/**
 * The standard glass stat card: tiny uppercase label (with optional icon),
 * a big display number/value, and an optional sub line. Interactive when
 * given `to` (link) or `onClick` (button); plain card otherwise.
 *
 * `size="lg"` + `animate` is the front-page look (rolling digits); the
 * default is the compact static card used in detail views.
 */
export default function Stat({
  label,
  value,
  icon,
  sub,
  to,
  onClick,
  size = "md",
  animate,
}: {
  label: string;
  value: number | string;
  icon?: ReactNode;
  sub?: string;
  to?: string;
  onClick?: () => void;
  size?: "md" | "lg";
  /** Roll the digits with AnimatedNumber — numeric values only. */
  animate?: boolean;
}) {
  const valueClass = cn(
    "font-display font-black text-wave-900",
    size === "lg" ? "text-2xl" : "text-xl",
  );
  const inner = (
    <>
      <div className="flex items-center gap-1 text-[10px] font-semibold tracking-wide text-wave-700 uppercase">
        {icon}
        {label}
      </div>
      {animate && typeof value === "number" ? (
        <AnimatedNumber value={value} className={valueClass} />
      ) : (
        <div className={valueClass}>{value}</div>
      )}
      {sub ? <div className="text-[10px] text-slate-500">{sub}</div> : null}
    </>
  );

  const interactive = to != null || onClick != null;
  const cardClass =
    "glass flex h-full flex-col items-start gap-0.5 px-3 py-2.5";
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 280, damping: 24 }}
      whileHover={interactive ? { y: -2 } : undefined}
      whileTap={interactive ? { scale: 0.98 } : undefined}
      className="h-full"
    >
      {to != null ? (
        <Link to={to} className={cardClass}>
          {inner}
        </Link>
      ) : onClick != null ? (
        <button
          type="button"
          onClick={onClick}
          className={cn(cardClass, "w-full text-left")}
        >
          {inner}
        </button>
      ) : (
        <div className={cardClass}>{inner}</div>
      )}
    </motion.div>
  );
}
