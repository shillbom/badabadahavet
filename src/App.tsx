import { Navigate, Route, Routes } from "react-router-dom";
import { lazy, Suspense, useEffect, useRef } from "react";
import { useAuth } from "@/auth/AuthContext";
import { useStore } from "@/store/sessions";
import {
  recordAchievements,
  watchAllSessions,
  watchPlaces,
  watchUserGroups,
  watchUserSessions,
} from "@/lib/data";
import { ACHIEVEMENTS_BY_ID, evaluateAchievements } from "@/lib/achievements";
import LoginPage from "@/pages/LoginPage";
import Layout from "@/components/Layout";
import { Toaster } from "@/components/ui/Toast";
import { CelebrationOverlay, celebrate } from "@/components/Celebration";
import { FullSplash } from "@/components/Splash";

// Route-level code splitting: Leaflet, clustering, framer-motion-heavy
// pages and the recap stay out of the initial JS bundle until the user
// navigates to them.
const MapPage = lazy(() => import("@/pages/MapPage"));
const HistoryPage = lazy(() => import("@/pages/HistoryPage"));
const LeaderboardPage = lazy(() => import("@/pages/LeaderboardPage"));
const LogSessionPage = lazy(() => import("@/pages/LogSessionPage"));
const GroupsPage = lazy(() => import("@/pages/GroupsPage"));
const SpotPage = lazy(() => import("@/pages/SpotPage"));
const AchievementsPage = lazy(() => import("@/pages/AchievementsPage"));
const RecapPage = lazy(() => import("@/pages/RecapPage"));
const ProfilePage = lazy(() => import("@/pages/ProfilePage"));
const AboutPage = lazy(() => import("@/pages/AboutPage"));

export default function App() {
  const { user, profile, loading } = useAuth();
  const setMyUid = useStore((s) => s.setMyUid);
  const setMySessions = useStore((s) => s.setMySessions);
  const setAllSessions = useStore((s) => s.setAllSessions);
  const setPlaces = useStore((s) => s.setPlaces);
  const setGroups = useStore((s) => s.setGroups);
  const mySessions = useStore((s) => s.mySessions);
  const allSessions = useStore((s) => s.allSessions);

  // Track achievements we've already shown a celebration for (across reloads
  // we don't celebrate ones already persisted before this session loaded).
  const seenAchievements = useRef<Set<string> | null>(null);

  useEffect(() => {
    setMyUid(user?.uid ?? null);
    if (!user) {
      seenAchievements.current = null;
      return;
    }
    const unsubs = [
      watchUserSessions(user.uid, setMySessions),
      watchAllSessions(setAllSessions),
      watchPlaces(setPlaces),
      watchUserGroups(user.uid, setGroups),
    ];
    return () => unsubs.forEach((u) => u());
  }, [user, setMyUid, setMySessions, setAllSessions, setPlaces, setGroups]);

  // Persist newly-unlocked achievements when sessions change.
  useEffect(() => {
    if (!user || !profile) return;
    const ctx = { uid: user.uid, mySessions, allSessions };
    const unlocked = evaluateAchievements(ctx);
    const persisted = new Set(Object.keys(profile.achievements ?? {}));
    const toPersist: string[] = [];
    for (const id of unlocked) if (!persisted.has(id)) toPersist.push(id);
    if (toPersist.length) {
      void recordAchievements(user.uid, toPersist);
    }
  }, [user, profile, mySessions, allSessions]);

  // Celebrate when persisted achievements gain new entries (vs the snapshot we
  // already had locally — so we don't replay everything on a fresh login).
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
      // Sort by the order they were added (their stored timestamp).
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
  // render Layout with an empty profile (fallback emoji + "Badare" name,
  // empty groups list etc.). Wait until both Firebase Auth and the
  // Firestore user doc are ready before showing the authed UI.
  if (loading || (user && !profile)) {
    return <FullSplash />;
  }

  return (
    <>
      <Toaster />
      <CelebrationOverlay />
      <Suspense fallback={<FullSplash />}>
        {!user ? (
          <Routes>
            <Route path="about" element={<AboutPage />} />
            <Route path="*" element={<LoginPage />} />
          </Routes>
        ) : (
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<MapPage />} />
              <Route path="history" element={<HistoryPage />} />
              <Route path="leaderboard" element={<LeaderboardPage />} />
              <Route path="groups" element={<GroupsPage />} />
              <Route path="log" element={<LogSessionPage />} />
              <Route path="spot/:placeId" element={<SpotPage />} />
              <Route path="achievements" element={<AchievementsPage />} />
              <Route path="recap" element={<RecapPage />} />
              <Route path="profile" element={<ProfilePage />} />
              <Route path="about" element={<AboutPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        )}
      </Suspense>
    </>
  );
}
