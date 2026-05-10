import { Navigate, Route, Routes } from "react-router-dom";
import { useEffect } from "react";
import { useAuth } from "@/auth/AuthContext";
import { useStore } from "@/store/sessions";
import {
  watchAllSessions,
  watchPlaces,
  watchUserGroups,
  watchUserSessions,
} from "@/lib/data";
import LoginPage from "@/pages/LoginPage";
import Layout from "@/components/Layout";
import MapPage from "@/pages/MapPage";
import HistoryPage from "@/pages/HistoryPage";
import LeaderboardPage from "@/pages/LeaderboardPage";
import LogSessionPage from "@/pages/LogSessionPage";
import GroupsPage from "@/pages/GroupsPage";
import SpotPage from "@/pages/SpotPage";
import { Toaster } from "@/components/ui/Toast";

export default function App() {
  const { user, loading } = useAuth();
  const setMyUid = useStore((s) => s.setMyUid);
  const setMySessions = useStore((s) => s.setMySessions);
  const setAllSessions = useStore((s) => s.setAllSessions);
  const setPlaces = useStore((s) => s.setPlaces);
  const setGroups = useStore((s) => s.setGroups);

  useEffect(() => {
    setMyUid(user?.uid ?? null);
    if (!user) return;
    const unsubs = [
      watchUserSessions(user.uid, setMySessions),
      watchAllSessions(setAllSessions),
      watchPlaces(setPlaces),
      watchUserGroups(user.uid, setGroups),
    ];
    return () => unsubs.forEach((u) => u());
  }, [user, setMyUid, setMySessions, setAllSessions, setPlaces, setGroups]);

  if (loading) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-wave-600 border-r-transparent" />
      </div>
    );
  }

  return (
    <>
      <Toaster />
      {!user ? (
        <Routes>
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
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      )}
    </>
  );
}
