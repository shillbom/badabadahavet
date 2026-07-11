import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The standard two-to-few-way switcher: a slate track with a white active
 * pill. `size="md"` is the full-width page variant (equal-width tabs);
 * `size="sm"` is the compact inline variant used inside sheets.
 */
export default function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  size = "md",
  grow,
  className,
}: {
  value: T;
  onChange: (next: T) => void;
  options: { value: T; label: ReactNode }[];
  size?: "md" | "sm";
  /** Stretch small-variant tabs to equal widths (md tabs always stretch). */
  grow?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        size === "md"
          ? "flex rounded-full bg-slate-100 p-1"
          : "inline-flex rounded-full bg-slate-100 p-0.5 text-xs font-semibold",
        className,
      )}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          data-active={value === o.value}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={
            size === "md"
              ? "pill-tab"
              : cn(
                  "flex items-center gap-1.5 rounded-full px-3 py-1.5 transition-colors",
                  grow && "flex-1 justify-center",
                  value === o.value
                    ? "bg-white text-wave-800 shadow-sm"
                    : "text-slate-500 hover:text-slate-700",
                )
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
