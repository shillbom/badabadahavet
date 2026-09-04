"use client";

import RequireAuth from "@/components/RequireAuth";
import AchievementsPage from "@/views/AchievementsPage";

export default function Page() {
  return (
    <RequireAuth>
      <AchievementsPage />
    </RequireAuth>
  );
}
