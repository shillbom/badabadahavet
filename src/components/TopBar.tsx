import { Link } from "react-router";
import { m } from "framer-motion";
import { History, Info, LogIn, WavesLadder } from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { useStore } from "@/store/sessions";
import { useIsAdmin } from "@/lib/adminMode";
import { openRecap } from "@/components/recapTrigger";
import { rememberReturnPath } from "@/lib/utils";
import { buttonClasses } from "@/components/ui/buttonStyles";
import { useT } from "@/lib/i18n";

/**
 * The app-wide top bar: identity (or guest sign-in) on the left, quick
 * actions on the right. Rendered once by Layout and spans the full viewport
 * on every route — page content narrows below it, the bar never does.
 */
export default function TopBar({ onNudge }: { onNudge: () => void }) {
  const { user, profile } = useAuth();
  const t = useT();
  const isAdmin = useIsAdmin();

  const groupCount = useStore((s) => s.groups.length);
  const groupSubtitle =
    groupCount === 0
      ? t("layout.solo_swimmer")
      : groupCount === 1
        ? t("layout.groups_one")
        : t("layout.groups_many", { n: groupCount });

  const isGuest = !user;

  return (
    <header className="sticky top-0 z-[1000] flex-none px-4 pt-[max(env(safe-area-inset-top),0.75rem)] pb-3">
      {/* Backdrop fade — a blurred white gradient that extends past the
          header and is masked to dissolve into the content, so there's no
          hard blur/colour seam. Content above stays fully crisp. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[calc(100%+1.75rem)] bg-gradient-to-b from-white/90 via-white/55 to-transparent [mask-image:linear-gradient(to_bottom,black,black_45%,transparent)] backdrop-blur-sm [-webkit-mask-image:linear-gradient(to_bottom,black,black_45%,transparent)]"
      />
      <div className="flex items-center justify-between">
        {isGuest ? (
          <Link
            to="/login"
            onClick={rememberReturnPath}
            className="flex items-center gap-2"
          >
            <m.div
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ type: "spring", stiffness: 220, damping: 22 }}
              className="flex items-center gap-2"
            >
              <span className="text-2xl">🌊</span>
              <div>
                <div className="font-display text-base leading-none font-bold text-wave-900">
                  {t("layout.guest")}
                </div>
                <div className="text-[11px] text-wave-700/70">
                  {t("layout.guest.subtitle")}
                </div>
              </div>
            </m.div>
          </Link>
        ) : (
          <Link to="/profile" className="flex items-center gap-2">
            <m.div
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ type: "spring", stiffness: 220, damping: 22 }}
              className="flex items-center gap-2"
            >
              <span className="text-2xl">{profile?.emoji ?? "🌊"}</span>
              <div>
                <div className="flex items-center gap-1.5">
                  <div className="font-display text-base leading-none font-bold text-wave-900">
                    {profile?.displayName ?? t("layout.swimmer")}
                  </div>
                  {isAdmin ? (
                    <span
                      className="rounded-full bg-amber-500 px-1.5 py-0.5 text-[9px] font-bold tracking-widest text-white uppercase shadow"
                      title={t("admin.label")}
                    >
                      {t("admin.label")}
                    </span>
                  ) : null}
                </div>
                <div className="text-[11px] text-wave-700/70">
                  {groupSubtitle}
                </div>
              </div>
            </m.div>
          </Link>
        )}
        {isGuest ? (
          <Link
            to="/login"
            onClick={rememberReturnPath}
            className={buttonClasses("primary", "xs")}
          >
            <LogIn className="h-3.5 w-3.5" />
            {t("layout.sign_in")}
          </Link>
        ) : (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onNudge}
              aria-label={t("map.nudge.button")}
              title={t("map.nudge.button")}
              className="rounded-full bg-white/70 p-2 text-wave-700 ring-1 ring-slate-200 transition hover:bg-white active:scale-95"
            >
              <WavesLadder className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={openRecap}
              aria-label={t("sincevisit.open")}
              title={t("sincevisit.open")}
              className="rounded-full bg-white/70 p-2 text-wave-700 ring-1 ring-slate-200 transition hover:bg-white active:scale-95"
            >
              <History className="h-4 w-4" />
            </button>
            <Link
              to="/about"
              aria-label={t("about.title")}
              title={t("about.title")}
              className="rounded-full bg-white/70 p-2 text-wave-700 ring-1 ring-slate-200 transition hover:bg-white active:scale-95"
            >
              <Info className="h-4 w-4" />
            </Link>
          </div>
        )}
      </div>
    </header>
  );
}
