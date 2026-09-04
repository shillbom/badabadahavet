"use client";

import { useStore } from "@/store/sessions";
import Redirect from "@/components/Redirect";
import LoginPage from "@/views/LoginPage";

/**
 * A signed-in user has nothing to do here, so bounce them to the map — the
 * old route table did the same with `user ? <Navigate to="/" replace />`.
 * Note this deliberately does NOT fire during Google onboarding: AppBoot
 * takes the whole tree over with the onboarding form before this renders.
 */
export default function Page() {
  const user = useStore((s) => s.user);
  if (user) return <Redirect to="/" />;
  return <LoginPage />;
}
