"use client";

import RequireAuth from "@/components/RequireAuth";
import ProfilePage from "@/views/ProfilePage";

export default function Page() {
  return (
    <RequireAuth>
      <ProfilePage />
    </RequireAuth>
  );
}
