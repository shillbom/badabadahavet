import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { Suspense, useEffect, useRef, useState } from "react";
import { useStore } from "@/store/sessions";
import { useT } from "@/lib/i18n";
import { toast } from "@/components/ui/Toast";
import { ACHIEVEMENTS_BY_ID } from "@/lib/achievements";
import { Pages, preloadAllPages } from "@/lib/pages";
import { useRegisterSW } from "virtual:pwa-register/react";
import LoginPage from "@/pages/LoginPage";
import GoogleAuthPage from "@/pages/GoogleAuthPage";
import Layout from "@/components/Layout";
import { Toaster } from "@/components/ui/Toast";
import UpdatePrompt from "@/components/UpdatePrompt";
import SinceLastVisit from "@/components/SinceLastVisit";
import { CelebrationOverlay, celebrate } from "@/components/Celebration";
import { FullSplash } from "@/components/Splash";
import { rememberReturnPath } from "@/lib/utils";

// A new version found this soon after the app opens is treated as "first
// load" and applied automatically. Anything later is an in-session update
// and only prompts, so we never reload out from under an active user.
const STARTUP_GRACE_MS = 10_000;
// How often a long-lived (kept-open) session re-checks for a new deploy.
const UPDATE_CHECK_MS = 60 * 60 * 1000; // hourly

/** Navigate to /login while saving the current path so post-login can return. */
function LoginRedirect() {
  rememberReturnPath();
  return <Navigate to="/login" replace />;
}

// Route-level code splitting + post-login preload config lives in
// `lib/pages.ts` so the route table here stays focused on layout.

export default function App() {
  const user = useStore((s) => s.user);
  const profile = useStore((s) => s.profile);
  const loading = useStore((s) => s.loading);
  const googleOnboarding = useStore((s) => s.googleOnboarding);
  const authError = useStore((s) => s.authError);
  const navigate = useNavigate();
  const t = useT();

  // Boot auth listener + data subscriptions once for the lifetime of the app.
  useEffect(() => useStore.getState()._startListening(), []);

  // A failed sign-in (e.g. the profile doc wouldn't load) signs the user back
  // out and sets authError. Surface it as a toast and send them to /login
  // rather than leaving them stuck on the splash.
  useEffect(() => {
    if (!authError) return;
    toast.error(t("auth.error.session"));
    useStore.setState({ authError: null });
    navigate("/login", { replace: true });
  }, [authError, navigate, t]);

  // Service worker update handling. On first load we apply a waiting update
  // automatically so the user always lands on the latest version; if a new
  // version is published while they're using the app, we show a reload
  // prompt instead of yanking the page out from under them.
  const appOpenedAt = useRef(Date.now());
  const autoApplied = useRef(false);
  const [updateReady, setUpdateReady] = useState(false);
  const { updateServiceWorker } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      // Keep checking for new deploys while a session stays open (e.g. an
      // installed PWA the user never fully closes).
      if (registration)
        setInterval(
          () => registration.update().catch(() => {}),
          UPDATE_CHECK_MS,
        );
    },
    onNeedRefresh() {
      const atStartup = Date.now() - appOpenedAt.current < STARTUP_GRACE_MS;
      if (atStartup && !autoApplied.current) {
        autoApplied.current = true;
        void updateServiceWorker(true); // reloads to the fresh version
      } else {
        setUpdateReady(true);
      }
    },
  });

  // Preload remaining page chunks once the user is logged in.
  useEffect(() => {
    if (!user) return;
    return preloadAllPages();
  }, [user]);

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

  // While the user doc is still hydrating after login we'd otherwise
  // render Layout with an empty profile. Wait until both Firebase Auth
  // and the Firestore user doc are ready before showing the authed UI.
  if ((loading || (user && !profile)) && !googleOnboarding) {
    return <FullSplash />;
  }

  // Routes that require login render a redirect to /login for guests.
  const protectedRoute = (el: React.ReactNode) =>
    user ? el : <LoginRedirect />;

  return (
    <>
      <Toaster />
      <UpdatePrompt
        show={updateReady}
        onReload={() => updateServiceWorker(true)}
        onDismiss={() => setUpdateReady(false)}
      />
      <CelebrationOverlay />
      {!googleOnboarding ? <SinceLastVisit /> : null}
      {googleOnboarding ? (
        <Suspense fallback={<FullSplash />}>
          <Routes>
            <Route path="auth/google" element={<GoogleAuthPage />} />
            <Route path="*" element={<LoginPage />} />
          </Routes>
        </Suspense>
      ) : (
        <Suspense fallback={<FullSplash />}>
          <Routes>
            <Route path="auth/google" element={<GoogleAuthPage />} />
            <Route
              path="login"
              element={user ? <Navigate to="/" replace /> : <LoginPage />}
            />
            <Route element={<Layout />}>
              <Route index element={<Pages.Map />} />
              <Route path="spot/:placeId" element={<Pages.Spot />} />
              <Route path="leaderboard" element={<Pages.Leaderboard />} />
              <Route path="about" element={<Pages.About />} />
              <Route
                path="history"
                element={protectedRoute(<Pages.History />)}
              />
              <Route path="groups" element={protectedRoute(<Pages.Groups />)} />
              <Route path="log" element={protectedRoute(<Pages.Log />)} />
              <Route
                path="achievements"
                element={protectedRoute(<Pages.Achievements />)}
              />
              <Route path="recap" element={protectedRoute(<Pages.Recap />)} />
              <Route
                path="profile"
                element={protectedRoute(<Pages.Profile />)}
              />
              <Route path="toswim" element={protectedRoute(<Pages.Toswim />)} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </Suspense>
      )}
    </>
  );
}
