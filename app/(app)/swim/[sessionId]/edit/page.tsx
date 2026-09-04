"use client";

import RequireAuth from "@/components/RequireAuth";
import EditSwimPage from "@/views/EditSwimPage";

export default function Page() {
  return (
    <RequireAuth>
      <EditSwimPage />
    </RequireAuth>
  );
}
