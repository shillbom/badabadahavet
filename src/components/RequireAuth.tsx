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
 * It has to wait for `loading`, not just look at `user`. AppBoot keeps the
 * routes mounted from the very first render now (so the public pages are real
 * server-rendered HTML), and on that first render nobody is signed in yet —
 * without the `loading` guard a member refreshing /profile would be bounced
 * to /login before Firebase Auth had a chance to restore their session. Once
 * `loading` clears, a missing `user` really does mean "guest".
 *
 * This is also what keeps the authed pages out of the server-rendered HTML:
 * `loading` is true on the server, so their content never renders there —
 * which is the intent (see the plan: SSR of authed pages buys nothing and
 * costs reads and cold starts).
 *
 * `rememberReturnPath()` runs before the redirect so `consumeReturnPath()` on
 * LoginPage can send them back where they were.
 */
export default function RequireAuth({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = useStore((s) => s.user);
  const loading = useStore((s) => s.loading);
  const router = useRouter();

  useEffect(() => {
    if (loading || user) return;
    rememberReturnPath();
    router.replace("/login");
  }, [loading, user, router]);

  if (!user) return null;
  return children;
}
