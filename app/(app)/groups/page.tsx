"use client";

import RequireAuth from "@/components/RequireAuth";
import GroupsPage from "@/views/GroupsPage";

export default function Page() {
  return (
    <RequireAuth>
      <GroupsPage />
    </RequireAuth>
  );
}
