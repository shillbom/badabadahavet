import { AnimatePresence, m } from "framer-motion";
import { Share, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";

const DISMISSED_KEY = "badligan.installHint.dismissed";

/**
 * iOS install nudge.
 *
 * Android and desktop Chrome can install from the browser menu unprompted,
 * but iOS only offers Add to Home Screen behind the share sheet, with no API
 * to surface it — `beforeinstallprompt` doesn't exist on Safari. So we detect
 * "iOS, in Safari, not already installed" and explain the flow once.
 */
function shouldShow(): boolean {
  if (typeof window === "undefined") return false;
  if (localStorage.getItem(DISMISSED_KEY)) return false;
  // Already launched from the home screen — nothing to install.
  if (window.matchMedia("(display-mode: standalone)").matches) return false;
  if ("standalone" in window.navigator && window.navigator.standalone)
    return false;
  const ua = navigator.userAgent;
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS 13+ reports as Mac; the touch-point count gives it away.
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (!isIOS) return false;
  // Chrome/Firefox/Edge on iOS have no Add to Home Screen at all.
  return !/CriOS|FxiOS|EdgiOS/.test(ua);
}

export default function InstallHint() {
  const t = useT();
  const [show, setShow] = useState(false);

  // Runs after mount on purpose: every signal above is client-only, and
  // deciding during render would mismatch the server-rendered HTML.
  useEffect(() => {
    setShow(shouldShow());
  }, []);

  const dismiss = () => {
    localStorage.setItem(DISMISSED_KEY, "1");
    setShow(false);
  };

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[max(env(safe-area-inset-bottom),0.5rem)] z-[1900] flex flex-col items-center px-3">
      <AnimatePresence>
        {show ? (
          <m.div
            initial={{ opacity: 0, y: 16, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.95 }}
            transition={{ type: "spring", stiffness: 400, damping: 28 }}
            className="pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-2xl bg-white/95 px-4 py-3 text-sm shadow-lg ring-1 ring-black/5 backdrop-blur"
            role="status"
          >
            <Share className="mt-0.5 h-4 w-4 flex-none text-wave-600" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-slate-800">
                {t("install.ios.title")}
              </p>
              <p className="mt-0.5 text-slate-600">{t("install.ios.body")}</p>
            </div>
            <button
              type="button"
              onClick={dismiss}
              aria-label={t("install.ios.dismiss")}
              className="flex-none rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            >
              <X className="h-4 w-4" />
            </button>
          </m.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
