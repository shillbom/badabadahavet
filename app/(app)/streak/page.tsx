"use client";

import RequireAuth from "@/components/RequireAuth";
import StreakPage from "@/views/StreakPage";

export default function Page() {
  return (
    <RequireAuth>
      <StreakPage />
    </RequireAuth>
  );
}
