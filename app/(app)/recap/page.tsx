"use client";

import RequireAuth from "@/components/RequireAuth";
import RecapPage from "@/views/RecapPage";

export default function Page() {
  return (
    <RequireAuth>
      <RecapPage />
    </RequireAuth>
  );
}
