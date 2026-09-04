"use client";

import { useEffect, useState } from "react";
import Redirect from "@/components/Redirect";
import { getRedirectResult } from "firebase/auth";
import { auth } from "@/firebase";
import { FullSplash } from "@/components/Splash";
import { toast } from "@/components/ui/toastStore";
import { useT } from "@/lib/i18n";
import { consumeReturnPath } from "@/lib/utils";

/**
 * Return-landing page for the Google sign-in redirect flow.
 *
 * The redirect here is initiated by loginWithGoogle() in the store, which
 * calls window.history.replaceState('/auth/google') before signInWithRedirect
 * so Firebase returns to this URL after authentication.
 *
 * getRedirectResult is called at MODULE LEVEL — Firebase requires it to run
 * while the page is still loading. If the result is null (browser blocked
 * cross-origin storage, user cancelled, etc.) we bail to the login page
 * rather than looping. onAuthStateChanged handles routing on success.
 *
 * The BAIL_AFTER_MS timeout is not belt-and-braces: this page's only UI is a
 * static, exit-less <FullSplash>, so anything that stops the promise settling
 * leaves the user staring at a splash with no error and no way out. That is
 * exactly what happened when badligan.club moved to App Hosting and
 * `/__/auth/handler` started 404ing (it is a Firebase Hosting reserved path —
 * see the rewrite in next.config.ts). Never let this page wait forever.
 */
const BAIL_AFTER_MS = 15_000;
const redirectResultPromise = getRedirectResult(auth).catch((e) =>
  console.error(e),
);

export default function GoogleAuthPage() {
  const [target, setTarget] = useState<string | null>(null);
  const t = useT();
  useEffect(() => {
    let settled = false;
    const finish = (path: string) => {
      if (settled) return;
      settled = true;
      setTarget(path);
    };

    redirectResultPromise.then((result) => {
      console.debug("Google redirect result:", result);
      if (result === null && !settled) {
        toast.error(t("auth.error.google_cancelled"));
      }
      // Navigate to the preserved deep link (or "/") regardless —
      // onAuthStateChanged handles routing if the user isn't authed yet.
      finish(consumeReturnPath());
      return;
    });

    // If the promise never settles the splash would stay up indefinitely.
    // Send the user back to /login with an explanation instead — a visible
    // failure they can retry beats an unexplained hang.
    const bail = window.setTimeout(() => {
      if (settled) return;
      console.error(
        "Google redirect result never settled — check that /__/auth/handler is reachable on this origin.",
      );
      toast.error(t("auth.error.google_stuck"));
      finish("/login");
    }, BAIL_AFTER_MS);

    return () => window.clearTimeout(bail);
  }, [t]);

  if (target) {
    // Keep the splash up while the (effect-driven) replace lands, so the
    // hand-off from the Google redirect to the app never flashes blank.
    return (
      <>
        <Redirect to={target} />
        <FullSplash />
      </>
    );
  }

  return <FullSplash />;
}
