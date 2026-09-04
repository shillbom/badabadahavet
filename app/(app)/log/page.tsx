"use client";

import RequireAuth from "@/components/RequireAuth";
import LogSessionPage from "@/views/LogSessionPage";

export default function Page() {
  return (
    <RequireAuth>
      <LogSessionPage />
    </RequireAuth>
  );
}
