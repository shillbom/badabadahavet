"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Client-side replace-navigation, the App Router stand-in for react-router's
 * `<Navigate replace />`.
 *
 * next/navigation's `redirect()` only works while the server renders, and
 * every redirect left in this app is decided from client-only state (the auth
 * store — there is no auth cookie, see the migration plan's Phase 0). So it
 * has to be an effect. Renders nothing; callers that want something on screen
 * for the frame in between render their own placeholder alongside it.
 */
export default function Redirect({ to }: { to: string }) {
  const router = useRouter();
  useEffect(() => {
    router.replace(to);
  }, [router, to]);
  return null;
}
