"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { domMax, LazyMotion } from "framer-motion";
import { useStore } from "@/store/sessions";
import { hydrateLocale, useT } from "@/lib/i18n";
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

// useLayoutEffect warns (and does nothing) when React renders on the server,
// so pick the hook once, at module scope — picking it inside the component
// would break the rules of hooks.
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

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

  // Switch to the saved / browser-preferred language. The server can only
  // render the Swedish default (no localStorage, no navigator), so the swap
  // happens here instead of at module scope — see the note on `useLocale` in
  // src/lib/i18n.ts. A LAYOUT effect so it commits before the browser paints:
  // an English user never sees a frame of Swedish. `useEffect` on the server,
  // where useLayoutEffect warns and does nothing anyway.
  useIsomorphicLayoutEffect(() => {
    hydrateLocale();
  }, []);

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

  // Boot is "in progress" until both Firebase Auth and the Firestore user doc
  // have resolved — while the user doc is still hydrating after login, the
  // chrome would otherwise show an empty profile.
  //
  // What `booting` gates is the boot overlay and the after-boot popovers, NOT
  // `children`. It used to gate the routes too (`booting ? null : children`),
  // and that made server rendering pointless: `loading` is true on the very
  // first render, so the server always emitted an empty shell and a crawler
  // got a page with no content in it. The route now stays mounted throughout
  // and the splash — position:fixed, opaque, z-3000 (see .app-splash in
  // src/index.css) — covers it until it lifts away, so nothing about the
  // boot experience changes while the HTML becomes complete.
  //
  // The two things that gate on a hydrated profile do it themselves:
  // `RequireAuth` renders nothing (and doesn't redirect) until auth has
  // resolved, and the public routes never needed a profile — they are
  // viewable by guests as they are.
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
      {onboardingTakeover ? <LoginPage /> : children}
      {/* BootSplash is pure CSS + a tiny signal, so it stays off the
          critical path, and it animates itself out once boot is ready. */}
      <BootSplash />
    </LazyMotion>
  );
}
