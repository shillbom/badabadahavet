"use client";

import RequireAuth from "@/components/RequireAuth";
import AdminUsersPage from "@/views/AdminUsersPage";

export default function Page() {
  return (
    <RequireAuth>
      <AdminUsersPage />
    </RequireAuth>
  );
}
