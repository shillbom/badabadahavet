import { useEffect, useEffectEvent, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, m } from "framer-motion";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { SessionDoc } from "@/lib/types";
import { formatDate } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import Photo from "@/components/Photo";

/**
 * Full-screen photo viewer for a set of swims. Pass every `session` that shares
 * the same context (a spot's swims, a friend's list…) plus the
 * `currentSessionId` to open on; the viewer lets you swipe / arrow between the
 * ones that actually have a photo. Pass `currentSessionId={null}` when closed.
 *
 * Rendered through a portal to <body> so it's never confined by a transformed
 * or overflow-hidden ancestor (e.g. the bottom-sheet or a scroll strip) — a
 * `position: fixed` element is clipped to such an ancestor, which would stop it
 * from actually covering the screen.
 */
export default function Lightbox({
  sessions,
  currentSessionId,
  onClose,
}: {
  sessions: SessionDoc[];
  currentSessionId: string | null;
  onClose: () => void;
}) {
  const t = useT();
  // Only swims with a photo are viewable / navigable.
  const photos = sessions.filter((s) => s.photoUrl);
  const open = currentSessionId != null;

  const [index, setIndex] = useState(0);
  // Swipe/slide direction (+1 next, -1 previous) so the exit/enter animation
  // moves the right way.
  const [dir, setDir] = useState(0);

  // Snap to the requested swim whenever the caller (re)opens the viewer.
  // Adjusting state during render (rather than in an effect) keeps the React
  // Compiler happy and avoids an extra commit — the id sentinel makes it run
  // once per open, and re-snaps when reopened on the same swim because the
  // sentinel is cleared to null on close.
  const [snappedId, setSnappedId] = useState<string | null>(null);
  if (currentSessionId !== snappedId) {
    setSnappedId(currentSessionId);
    if (currentSessionId) {
      const i = photos.findIndex((s) => s.id === currentSessionId);
      if (i >= 0) setIndex(i);
      setDir(0);
    }
  }

  // Plain function — the React Compiler memoizes it automatically. A manual
  // useCallback here trips `preserve-manual-memoization`: the compiler's
  // inferred deps (the setters) don't match hand-written ones, so it bails on
  // optimizing the whole component.
  const go = (delta: number) => {
    const next = index + delta;
    if (next < 0 || next >= photos.length) return;
    setDir(delta);
    setIndex(next);
  };

  // Keyboard navigation while open. The handler reads fresh `go`/`onClose`
  // via an Effect Event so the listener subscribes once per open instead of
  // re-binding on every index change.
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.key === "ArrowLeft") go(-1);
    else if (e.key === "ArrowRight") go(1);
    else if (e.key === "Escape") onClose();
  });
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  const s = photos[index];
  const hasPrev = index > 0;
  const hasNext = index < photos.length - 1;

  return createPortal(
    <AnimatePresence>
      {open && s ? (
        <m.div
          key="lightbox"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 z-[3500] flex items-center justify-center bg-black/85 p-4"
        >
          <button
            type="button"
            onClick={onClose}
            className="absolute top-[max(env(safe-area-inset-top),1rem)] right-4 z-10 rounded-full bg-white/10 p-2 text-white"
            aria-label={t("common.close")}
          >
            <X className="h-4 w-4" />
          </button>

          {photos.length > 1 && hasPrev ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                go(-1);
              }}
              className="absolute top-1/2 left-2 z-10 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white"
              aria-label={t("common.previous")}
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
          ) : null}
          {photos.length > 1 && hasNext ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                go(1);
              }}
              className="absolute top-1/2 right-2 z-10 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white"
              aria-label={t("common.next")}
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          ) : null}

          <AnimatePresence mode="popLayout" custom={dir} initial={false}>
            <m.div
              key={s.id}
              custom={dir}
              variants={{
                enter: (d: number) => ({ x: d >= 0 ? 320 : -320, opacity: 0 }),
                center: { x: 0, opacity: 1 },
                exit: (d: number) => ({ x: d >= 0 ? -320 : 320, opacity: 0 }),
              }}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.2 }}
              drag="x"
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={0.2}
              onDragEnd={(_, info) => {
                if (info.offset.x < -80) go(1);
                else if (info.offset.x > 80) go(-1);
              }}
              onClick={(e) => e.stopPropagation()}
              className="flex max-h-[85dvh] max-w-full cursor-grab flex-col items-center active:cursor-grabbing"
            >
              <Photo
                src={s.photoUrl!}
                thumb={s.photoThumb}
                fit="contain"
                className="pointer-events-none rounded-xl"
              />
              <div className="mt-2 text-center text-xs text-white/80">
                {s.displayName} · {formatDate(s.date)}
                {s.note ? ` · ${s.note}` : ""}
              </div>
            </m.div>
          </AnimatePresence>
        </m.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
