"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "@/store/sessions";
import { rememberReturnPath } from "@/lib/utils";

/**
 * Login gate for the routes that need a signed-in user.
 *
 * The check is deliberately client-side: auth state lives only in the Zustand
 * store (Firebase Auth in the browser), there is no session cookie, and SSR of
 * authenticated pages is explicitly out of scope — so middleware or a server
 * component could not tell a guest from a member anyway.
 *
 * Reading `user` alone is enough: `AppBoot` renders nothing until boot
 * finishes (`loading` false, profile hydrated) and takes over the whole tree
 * during Google onboarding, so by the time this mounts a missing `user` really
 * does mean "guest". `rememberReturnPath()` runs before the redirect so
 * `consumeReturnPath()` on LoginPage can send them back where they were.
 */
export default function RequireAuth({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = useStore((s) => s.user);
  const router = useRouter();

  useEffect(() => {
    if (user) return;
    rememberReturnPath();
    router.replace("/login");
  }, [user, router]);

  if (!user) return null;
  return children;
}
