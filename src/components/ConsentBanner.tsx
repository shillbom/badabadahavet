import { AnimatePresence, m } from "framer-motion";
import { Link } from "react-router";
import { Cookie } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useT } from "@/lib/i18n";
import { consentRelevant, useConsent } from "@/lib/consent";

/**
 * One-time analytics consent prompt. Shown only where analytics could run and
 * only until the user makes a choice. Both actions are explicit — there's no
 * dismiss-without-choosing, so we never treat inaction as consent. It floats
 * above the bottom nav so it doesn't cover the tabs.
 */
export default function ConsentBanner() {
  const t = useT();
  const choice = useConsent((s) => s.analytics);
  const setAnalytics = useConsent((s) => s.setAnalytics);
  const show = consentRelevant && choice === null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(6rem+env(safe-area-inset-bottom))] z-[1900] flex flex-col items-center px-3">
      <AnimatePresence>
        {show ? (
          <m.div
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
            className="pointer-events-auto w-full max-w-md rounded-2xl bg-white/95 p-4 shadow-lg ring-1 ring-black/5 backdrop-blur"
            role="dialog"
            aria-live="polite"
            aria-label={t("consent.title")}
          >
            <div className="flex items-start gap-3">
              <Cookie className="mt-0.5 h-5 w-5 flex-none text-wave-600" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-wave-900">
                  {t("consent.title")}
                </p>
                <p className="mt-1 text-[13px] leading-relaxed text-slate-600">
                  {t("consent.body")}{" "}
                  <Link
                    to="/privacy"
                    className="font-semibold text-wave-700 underline hover:text-wave-800"
                  >
                    {t("consent.learn")}
                  </Link>
                </p>
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                className="flex-1"
                onClick={() => setAnalytics(false)}
              >
                {t("consent.decline")}
              </Button>
              <Button
                size="sm"
                className="flex-1"
                onClick={() => setAnalytics(true)}
              >
                {t("consent.accept")}
              </Button>
            </div>
          </m.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
