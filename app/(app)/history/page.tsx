"use client";

import RequireAuth from "@/components/RequireAuth";
import HistoryPage from "@/views/HistoryPage";

export default function Page() {
  return (
    <RequireAuth>
      <HistoryPage />
    </RequireAuth>
  );
}
