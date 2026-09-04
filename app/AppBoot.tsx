"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { domMax, LazyMotion } from "framer-motion";
import { useStore } from "@/store/sessions";
import { useT } from "@/lib/i18n";
import { toast } from "@/components/ui/toastStore";
import { ACHIEVEMENTS_BY_ID } from "@/lib/achievements";
import LoginPage from "@/views/LoginPage";
import { Toaster } from "@/components/ui/Toast";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import SinceLastVisit from "@/components/SinceLastVisit";
import ConsentBanner from "@/components/ConsentBanner";
import InstallHint from "@/components/InstallHint";
import { CelebrationOverlay } from "@/components/fx/Celebration";
import { celebrate } from "@/components/celebrationStore";
import { BootSplash } from "@/components/Splash";
import { setBootReady } from "@/lib/bootSignal";
import { installAppHeight } from "@/lib/appHeight";
import { prefetchAllPages } from "@/lib/pages";

/**
 * The app-wide client shell — everything that used to live in src/App.tsx
 * around the react-router route table: the store boot, the boot/splash gate,
 * the global overlays and the auth-error toast.
 *
 * It is mounted once by the root layout, so it wraps EVERY route including
 * /login and /auth/google (which sit outside the (app) route group and so
 * don't get the TopBar/NavBar chrome — same shape as the old route table,
 * where those two routes were outside <Layout /> but inside <App />).
 */
export default function AppBoot({ children }: { children: React.ReactNode }) {
  const user = useStore((s) => s.user);
  const profile = useStore((s) => s.profile);
  const loading = useStore((s) => s.loading);
  const googleOnboarding = useStore((s) => s.googleOnboarding);
  const authError = useStore((s) => s.authError);
  const router = useRouter();
  const pathname = usePathname();
  const t = useT();

  // Boot auth listener + data subscriptions once for the lifetime of the app.
  useEffect(() => useStore.getState()._startListening(), []);

  // Keep --app-height honest for the rest of the session. The first value is
  // written by an inline script in app/layout.tsx (before first paint); this
  // installs the resize/orientation/pageshow listeners and the scroll nudge
  // that unsticks iOS's launch viewport. See src/lib/appHeight.ts.
  useEffect(() => {
    installAppHeight();
  }, []);

  // A failed sign-in (e.g. the profile doc wouldn't load) signs the user back
  // out and sets authError. Surface it as a toast and send them to /login
  // rather than leaving them stuck on the splash.
  useEffect(() => {
    if (!authError) return;
    toast.error(t("auth.error.session"));
    useStore.setState({ authError: null });
    router.replace("/login");
  }, [authError, router, t]);

  // Warm the remaining route bundles once the user is logged in. Under Vite
  // this imported the lazy page chunks by hand; Next splits per route, so the
  // equivalent is router.prefetch — same ordering intent (Map first since
  // it's already on screen, Recap last because it's the heaviest).
  useEffect(() => {
    if (!user) return;
    return prefetchAllPages(router);
  }, [user, router]);

  // Celebrate when persisted achievements gain new entries (vs the snapshot
  // we already had when this session loaded — so we don't replay old ones).
  const seenAchievements = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!user) {
      seenAchievements.current = null;
      return;
    }
  }, [user]);

  useEffect(() => {
    if (!profile) return;
    const persisted = new Set(Object.keys(profile.achievements ?? {}));
    if (seenAchievements.current === null) {
      seenAchievements.current = persisted;
      return;
    }
    const newly: string[] = [];
    for (const id of persisted)
      if (!seenAchievements.current.has(id)) newly.push(id);
    if (newly.length) {
      const records = profile.achievements ?? {};
      newly.sort((a, b) => (records[a] ?? 0) - (records[b] ?? 0));
      for (const id of newly) {
        const ach = ACHIEVEMENTS_BY_ID[id];
        if (ach) celebrate.achievement(ach);
      }
    }
    seenAchievements.current = persisted;
  }, [profile]);

  // While the user doc is still hydrating after login we'd otherwise render
  // the chrome with an empty profile. Wait until both Firebase Auth and the
  // Firestore user doc are ready before mounting the authed UI. Rather than
  // early-returning the splash (which would unmount instantly, with no way to
  // animate out), keep the app content gated on `booting` and lay the boot
  // overlay on top — it lifts away on its own once `booting` clears.
  const booting = Boolean((loading || (user && !profile)) && !googleOnboarding);

  // Tell the boot splash it can leave as soon as boot finishes.
  //
  // Under Vite this ALSO waited on a hand-rolled `contentReady` flag (an
  // eager `import("@/views/MapPage")`) so the splash never lifted onto the
  // route-level Suspense fallback — an identical FullSplash whose still-
  // resting wordmark doubled against the exiting one. That flag is gone
  // because the double-splash it guarded can no longer happen: Next loads the
  // matched route's client bundle as part of hydration, so this component
  // cannot even run before the page module is in memory, and there is no
  // FullSplash Suspense fallback wrapping the routes any more (the in-app
  // fallback is the small spinner in Layout). If a route-level splash
  // fallback is ever reintroduced, re-introduce a wait for it here too.
  useEffect(() => {
    if (!booting) setBootReady();
  }, [booting]);

  // Google users without a homeCountry are mid-onboarding: every path shows
  // the onboarding form (LoginPage renders it when googleOnboarding is set)
  // except the redirect-landing page itself, which must stay mounted to
  // consume getRedirectResult. Same behaviour as the old `googleOnboarding`
  // branch of the route table.
  const onboardingTakeover = googleOnboarding && pathname !== "/auth/google";

  return (
    <LazyMotion features={domMax}>
      <Toaster />
      <ConfirmDialog />
      <CelebrationOverlay />
      {!booting && !googleOnboarding ? <SinceLastVisit /> : null}
      {!booting && !googleOnboarding ? <ConsentBanner /> : null}
      {!booting && !googleOnboarding ? <InstallHint /> : null}
      {booting ? null : onboardingTakeover ? <LoginPage /> : children}
      {/* BootSplash is pure CSS + a tiny signal, so it stays off the
          critical path, and it animates itself out once boot is ready. */}
      <BootSplash />
    </LazyMotion>
  );
}
