import type { ReactNode } from "react";
import { m, AnimatePresence, useDragControls } from "framer-motion";
import { X } from "lucide-react";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Reusable swipe-to-dismiss bottom sheet: a dimmed backdrop plus a rounded
 * panel that springs up from the bottom and can be flicked back down. Owns its
 * own enter/exit animation via `AnimatePresence`, so callers just toggle
 * `open`.
 *
 * Because the exit animation needs the content to stay rendered while the sheet
 * slides away, callers that derive `title`/`children` from state that becomes
 * null on close should keep the last value around (e.g. via a ref) so the
 * closing frame still has something to show.
 *
 * Two sizes:
 *  - "large": a tall, flex-column panel (caps at 92dvh) whose body scrolls.
 *    Drag is started from the grab handle so the inner list stays scrollable.
 *  - "small": a compact, content-height panel. The whole panel is draggable
 *    since there's no scroll region to conflict with.
 */
export default function BottomSheet({
  open,
  onClose,
  size = "large",
  title,
  children,
  zBase = 1100,
}: {
  open: boolean;
  onClose: () => void;
  size?: "large" | "small";
  title?: ReactNode;
  children?: ReactNode;
  /** Backdrop z-index; the sheet sits at zBase + 100. Raise it for sheets
   *  that stack on top of another sheet. */
  zBase?: number;
}) {
  const t = useT();
  const dragControls = useDragControls();
  const isLarge = size === "large";

  return (
    <AnimatePresence>
      {open ? (
        <>
          <m.div
            key="bs-backdrop"
            // Decorative click-away layer; keyboard users close via the X
            // button, so hide it from assistive tech rather than making a
            // full-screen div focusable.
            aria-hidden="true"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            style={{ zIndex: zBase }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm"
          />
          <m.div
            key="bs-sheet"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
            drag="y"
            dragControls={isLarge ? dragControls : undefined}
            dragListener={!isLarge}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.4 }}
            onDragEnd={(_e, info) => {
              if (info.offset.y > 80 || info.velocity.y > 350) onClose();
            }}
            style={{
              zIndex: zBase + 100,
              ...(isLarge ? { maxHeight: "92dvh" } : undefined),
            }}
            className={
              isLarge
                ? "fixed inset-x-0 bottom-0 mx-auto flex max-w-md flex-col overflow-hidden rounded-t-3xl bg-white/95 shadow-2xl backdrop-blur-sm"
                : "fixed inset-x-0 bottom-0 mx-auto max-w-md touch-none rounded-t-3xl bg-white/95 px-6 pt-4 pb-[calc(max(env(safe-area-inset-bottom),0.5rem)+1.5rem)] shadow-2xl backdrop-blur-sm"
            }
          >
            {isLarge ? (
              <>
                {/* Drag handle — grab here to dismiss; the body stays scrollable.
                    The generous padding (and overlap into the title row) makes
                    the touch target comfortably taller than the visual bar. */}
                <div
                  onPointerDown={(e) => dragControls.start(e)}
                  className={cn(
                    "relative z-10 flex flex-none cursor-grab touch-none justify-center pt-4 pb-7 active:cursor-grabbing",
                    // Overlap into the title row for an even taller target —
                    // but never over the scrollable body when there's no title.
                    title != null && "-mb-4",
                  )}
                >
                  <div className="h-1.5 w-12 rounded-full bg-slate-300" />
                </div>

                {title != null ? (
                  <div
                    onPointerDown={(e) => dragControls.start(e)}
                    className="flex flex-none touch-none items-center justify-between gap-3 px-5 pt-5 pb-3"
                  >
                    <div className="min-w-0 flex-1">{title}</div>
                    <button
                      type="button"
                      onClick={onClose}
                      aria-label={t("common.close")}
                      className="flex-none rounded-full bg-slate-100 p-2 text-slate-500 hover:bg-slate-200"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : null}

                <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
              </>
            ) : (
              <>
                {/* Decorative handle — the whole panel is draggable. */}
                <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-slate-300" />
                {title != null ? <div className="mb-3">{title}</div> : null}
                {children}
              </>
            )}
          </m.div>
        </>
      ) : null}
    </AnimatePresence>
  );
}
