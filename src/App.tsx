import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router";
import { Suspense, useEffect, useRef, useState } from "react";
import { domMax, LazyMotion } from "framer-motion";
import { useStore } from "@/store/sessions";
import { useT } from "@/lib/i18n";
import { toast } from "@/components/ui/toastStore";
import { ACHIEVEMENTS_BY_ID } from "@/lib/achievements";
import { Pages, preloadAllPages } from "@/lib/pages";
import { useRegisterSW } from "virtual:pwa-register/react";
import LoginPage from "@/pages/LoginPage";
import GoogleAuthPage from "@/pages/GoogleAuthPage";
import Layout from "@/components/Layout";
import { Toaster } from "@/components/ui/Toast";
import UpdatePrompt from "@/components/UpdatePrompt";
import SinceLastVisit from "@/components/SinceLastVisit";
import { CelebrationOverlay } from "@/components/Celebration";
import { celebrate } from "@/components/celebrationStore";
import { FullSplash } from "@/components/Splash";
import { setBootReady } from "@/lib/bootSignal";
import { rememberReturnPath } from "@/lib/utils";

// How often a long-lived (kept-open) session re-checks for a new deploy.
const UPDATE_CHECK_MS = 60 * 60 * 1000; // hourly
const preloadMapPage = () => import("@/pages/MapPage");

/** Navigate to /login while saving the current path so post-login can return. */
function LoginRedirect() {
  rememberReturnPath();
  return <Navigate to="/login" replace />;
}

/**
 * `/s/:placeId` is the share entrypoint. In production the spotPreview Cloud
 * Function (see functions/index.js) intercepts it — serving OG tags to link
 * scrapers and 302'ing browsers to `/spot/...`. This client-side fallback
 * handles the same redirect for environments where that function isn't in the
 * path (local dev, or if the browser ever renders the route directly), so a
 * shared `/s/...` link always resolves to the real spot page.
 */
function ShareRedirect() {
  const { placeId } = useParams();
  const { search } = useLocation();
  return <Navigate to={`/spot/${placeId ?? ""}${search}`} replace />;
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

  // Warm the initial route chunk during boot and flag when it's ready. The
  // splash exit waits on this (see below) so it lifts away onto the rendered
  // Map — never onto the route-level Suspense fallback, which is an identical
  // splash whose still-resting wordmark would "double" against the exiting
  // one and read as a jump. Small chunk, loads in parallel with auth.
  const [contentReady, setContentReady] = useState(false);
  useEffect(() => {
    let alive = true;
    const ready = () => alive && setContentReady(true);
    preloadMapPage().then(ready, ready);
    return () => {
      alive = false;
    };
  }, []);

  // A failed sign-in (e.g. the profile doc wouldn't load) signs the user back
  // out and sets authError. Surface it as a toast and send them to /login
  // rather than leaving them stuck on the splash.
  useEffect(() => {
    if (!authError) return;
    toast.error(t("auth.error.session"));
    useStore.setState({ authError: null });
    navigate("/login", { replace: true });
  }, [authError, navigate, t]);

  // Service worker updates always wait for explicit user confirmation so a
  // reload can never interrupt an in-progress swim log.
  const [updateReady, setUpdateReady] = useState(false);
  const [swRegistration, setSwRegistration] =
    useState<ServiceWorkerRegistration | null>(null);
  const { updateServiceWorker } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      setSwRegistration(registration ?? null);
    },
    onNeedRefresh() {
      setUpdateReady(true);
    },
  });
  useEffect(() => {
    if (!swRegistration) return;
    // Keep checking for new deploys while a session stays open (e.g. an
    // installed PWA the user never fully closes).
    const timer = window.setInterval(() => {
      void swRegistration.update().catch((error: unknown) => {
        console.warn("Service worker update check failed", error);
      });
    }, UPDATE_CHECK_MS);
    return () => window.clearInterval(timer);
  }, [swRegistration]);

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

  // While the user doc is still hydrating after login we'd otherwise render
  // Layout with an empty profile. Wait until both Firebase Auth and the
  // Firestore user doc are ready before mounting the authed UI. Rather than
  // early-returning the splash (which would unmount instantly, with no way to
  // animate out), keep the app content gated on `booting` and lay the boot
  // overlay on top — it lifts away on its own once `booting` clears.
  const booting = Boolean((loading || (user && !profile)) && !googleOnboarding);

  // Tell the boot splash it can leave, once boot finishes AND the Map chunk is
  // loaded — so it lifts away onto real content rather than the identical route
  // Suspense fallback (whose still-resting wordmark would double against the
  // exiting one). BootSplash then plays its exit and unmounts itself.
  useEffect(() => {
    if (!booting && contentReady) setBootReady();
  }, [booting, contentReady]);

  // Routes that require login render a redirect to /login for guests.
  const protectedRoute = (el: React.ReactNode) =>
    user ? el : <LoginRedirect />;

  return (
    <LazyMotion features={domMax}>
      <Toaster />
      <UpdatePrompt
        show={updateReady}
        onReload={() => updateServiceWorker(true)}
        onDismiss={() => setUpdateReady(false)}
      />
      <CelebrationOverlay />
      {!booting && !googleOnboarding ? <SinceLastVisit /> : null}
      {booting ? null : googleOnboarding ? (
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
            <Route path="s/:placeId" element={<ShareRedirect />} />
            <Route element={<Layout />}>
              <Route index element={<Pages.Map />} />
              <Route path="spot/:placeId" element={<Pages.Spot />} />
              <Route path="leaderboard" element={<Pages.Leaderboard />} />
              <Route path="about" element={<Pages.About />} />
              <Route path="privacy" element={<Pages.Privacy />} />
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
              <Route path="streak" element={protectedRoute(<Pages.Streak />)} />
              <Route path="recap" element={protectedRoute(<Pages.Recap />)} />
              <Route
                path="profile"
                element={protectedRoute(<Pages.Profile />)}
              />
              <Route path="toswim" element={protectedRoute(<Pages.Toswim />)} />
              <Route
                path="admin/users"
                element={protectedRoute(<Pages.AdminUsers />)}
              />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </Suspense>
      )}
    </LazyMotion>
  );
}
