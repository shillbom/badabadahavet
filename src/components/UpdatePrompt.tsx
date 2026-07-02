import { AnimatePresence, motion } from "framer-motion";
import { RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useT } from "@/lib/i18n";

/**
 * A persistent banner shown when a new app version becomes available while
 * the user is actively using the app. Unlike the auto-update on first load,
 * this never reloads on its own — the user decides when, so an in-progress
 * swim log is never interrupted.
 */
export default function UpdatePrompt({
  show,
  onReload,
  onDismiss,
}: {
  show: boolean;
  onReload: () => void;
  onDismiss: () => void;
}) {
  const t = useT();
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[max(env(safe-area-inset-top),0.5rem)] z-[1950] flex flex-col items-center px-3">
      <AnimatePresence>
        {show ? (
          <motion.div
            initial={{ opacity: 0, y: -16, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -16, scale: 0.95 }}
            transition={{ type: "spring", stiffness: 400, damping: 28 }}
            className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-2xl bg-white/95 px-4 py-2.5 text-sm shadow-lg ring-1 ring-black/5 backdrop-blur"
            role="status"
          >
            <RefreshCw className="h-4 w-4 flex-none text-wave-600" />
            <span className="min-w-0 flex-1 text-slate-700">
              {t("update.prompt")}
            </span>
            <Button size="xs" className="flex-none" onClick={onReload}>
              {t("update.reload")}
            </Button>
            <button
              type="button"
              onClick={onDismiss}
              aria-label={t("common.close")}
              className="flex-none rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            >
              <X className="h-4 w-4" />
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
