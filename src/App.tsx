import { Navigate, Route, Routes } from "react-router-dom";
import { Suspense, useEffect, useRef } from "react";
import { useStore } from "@/store/sessions";
import { ACHIEVEMENTS_BY_ID } from "@/lib/achievements";
import { Pages, preloadAllPages } from "@/lib/pages";
import { useRegisterSW } from "virtual:pwa-register/react";
import LoginPage from "@/pages/LoginPage";
import GoogleAuthPage from "@/pages/GoogleAuthPage";
import Layout from "@/components/Layout";
import { Toaster } from "@/components/ui/Toast";
import { toast } from "@/components/ui/Toast";
import { t } from "@/lib/i18n";
import { CelebrationOverlay, celebrate } from "@/components/Celebration";
import { FullSplash } from "@/components/Splash";

// Route-level code splitting + post-login preload config lives in
// `lib/pages.ts` so the route table here stays focused on layout.

export default function App() {
  const user = useStore((s) => s.user);
  const profile = useStore((s) => s.profile);
  const loading = useStore((s) => s.loading);
  const googleOnboarding = useStore((s) => s.googleOnboarding);

  // Boot auth listener + data subscriptions once for the lifetime of the app.
  useEffect(() => useStore.getState()._startListening(), []);

  // When the service worker has activated a new version, show a brief
  // toast then reload so the fresh assets are used.
  const { updateServiceWorker } = useRegisterSW({
    onNeedRefresh() {
      toast.info(t("update.ready"));
      setTimeout(() => updateServiceWorker(true), 1200);
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

  return (
    <>
      <Toaster />
      <CelebrationOverlay />
      {!user || googleOnboarding ? (
        <Suspense fallback={<FullSplash />}>
          <Routes>
            <Route path="about" element={<Pages.About />} />
            <Route path="auth/google" element={<GoogleAuthPage />} />
            <Route path="*" element={<LoginPage />} />
          </Routes>
        </Suspense>
      ) : (
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Pages.Map />} />
            <Route path="history" element={<Pages.History />} />
            <Route path="leaderboard" element={<Pages.Leaderboard />} />
            <Route path="groups" element={<Pages.Groups />} />
            <Route path="log" element={<Pages.Log />} />
            <Route path="spot/:placeId" element={<Pages.Spot />} />
            <Route path="achievements" element={<Pages.Achievements />} />
            <Route path="recap" element={<Pages.Recap />} />
            <Route path="profile" element={<Pages.Profile />} />
            <Route path="about" element={<Pages.About />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      )}
    </>
  );
}
