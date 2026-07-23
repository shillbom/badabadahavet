import type { ReactNode, Ref } from "react";
import { m } from "framer-motion";
import { Calendar, Thermometer } from "lucide-react";
import { cn, formatDateTime } from "@/lib/utils";
import { waterEmojiFor } from "@/lib/waterEmoji";

/**
 * The standard compact swim row used in feeds and sheets: a 56px photo/emoji
 * thumbnail, a header line with a "+points" badge, the calendar meta line
 * (with ❄️/✨ markers), an optional note, and a free-form footer (usually a
 * ReactionBar). Callers own the title node since every list names swims a
 * little differently (swimmer, place, or both).
 */
export default function SwimListItem({
  ref,
  index = 0,
  className,
  thumb,
  fallbackEmoji,
  seed,
  title,
  points,
  aside,
  date,
  winter,
  unique,
  waterTemp,
  note,
  children,
}: {
  ref?: Ref<HTMLLIElement>;
  /** Position in the list — drives the small stagger on mount. */
  index?: number;
  className?: string;
  /** Custom thumbnail node (photo, lightbox button…); emoji block otherwise. */
  thumb?: ReactNode;
  /** Force a specific placeholder emoji; otherwise derived from `seed`. */
  fallbackEmoji?: string;
  /** Stable seed (usually the session id) for picking the placeholder emoji. */
  seed?: string;
  title: ReactNode;
  /** Standard "+n" badge. Use `aside` for anything fancier. */
  points?: number;
  /** Extra header-right content (action buttons, custom badges). */
  aside?: ReactNode;
  date: number;
  winter?: boolean;
  unique?: boolean;
  waterTemp?: number;
  note?: string | null;
  /** Footer row, e.g. a ReactionBar or chip list. */
  children?: ReactNode;
}) {
  return (
    <m.li
      ref={ref}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 8) * 0.03 }}
      className={cn("glass flex items-start gap-3 p-3", className)}
    >
      {thumb ?? (
        <div className="flex h-14 w-14 flex-none items-center justify-center rounded-lg bg-gradient-to-br from-wave-50 to-wave-200 text-2xl ring-1 ring-wave-200 ring-inset">
          <span className="drop-shadow-sm">
            {fallbackEmoji ?? waterEmojiFor(seed ?? "")}
          </span>
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">{title}</div>
          {points != null || aside != null ? (
            <div className="flex flex-none items-center gap-1.5">
              {points != null ? (
                <div className="font-display text-base font-black text-wave-700">
                  +{points}
                </div>
              ) : null}
              {aside}
            </div>
          ) : null}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-slate-500">
          <Calendar className="h-3 w-3" />
          {formatDateTime(date)}
          {winter ? <span className="ml-0.5">❄️</span> : null}
          {unique ? <span className="ml-0.5">✨</span> : null}
          {waterTemp != null ? (
            <span className="ml-1 inline-flex items-center gap-0.5 rounded-md bg-teal-50 px-1.5 py-0.5 text-[10px] font-semibold text-teal-700 ring-1 ring-teal-200">
              <Thermometer className="h-3 w-3 text-teal-500" />
              {waterTemp}°C
            </span>
          ) : null}
        </div>
        {note ? <p className="mt-0.5 text-xs text-slate-600">{note}</p> : null}
        {children}
      </div>
    </m.li>
  );
}
