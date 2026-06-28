import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import type { SessionDoc } from "@/lib/types";
import { formatDate } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import Photo from "@/components/Photo";

/**
 * Full-screen photo viewer for a swim. Tapping a swim photo (on the Spot page
 * or in a friend's swim list) opens this over everything; tap anywhere or the
 * close button to dismiss. `index` selects which of `sessions` to show.
 *
 * Rendered through a portal to <body> so it's never confined by a transformed
 * or overflow-hidden ancestor (e.g. the bottom-sheet or a scroll strip) — a
 * `position: fixed` element is clipped to such an ancestor, which would stop it
 * from actually covering the screen.
 */
export default function Lightbox({
  sessions,
  index,
  onClose,
}: {
  sessions: SessionDoc[];
  index: number | null;
  onClose: () => void;
}) {
  const t = useT();
  const s = index != null ? sessions[index] : null;
  return createPortal(
    <AnimatePresence>
      {s ? (
        <motion.div
          key={s.id}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 z-[2100] flex items-center justify-center bg-black/85 p-4"
        >
          <button
            onClick={onClose}
            className="absolute top-[max(env(safe-area-inset-top),1rem)] right-4 rounded-full bg-white/10 p-2 text-white"
            aria-label={t("common.close")}
          >
            <X className="h-4 w-4" />
          </button>
          <motion.div
            initial={{ scale: 0.92, y: 8 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.92, y: 8 }}
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[85dvh] max-w-full flex-col items-center"
          >
            <Photo
              src={s.photoUrl!}
              thumb={s.photoThumb}
              fit="contain"
              className="rounded-xl"
            />
            <div className="mt-2 text-center text-xs text-white/80">
              {s.displayName} · {formatDate(s.date)}
              {s.note ? ` · ${s.note}` : ""}
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
