"use client";

import RequireAuth from "@/components/RequireAuth";
import ToswimPage from "@/views/ToswimPage";

export default function Page() {
  return (
    <RequireAuth>
      <ToswimPage />
    </RequireAuth>
  );
}
