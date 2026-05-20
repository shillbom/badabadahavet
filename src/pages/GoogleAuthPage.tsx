import { useEffect, useState } from "react";
import { Navigate } from "react-router";
import { getRedirectResult } from "firebase/auth";
import { auth } from "@/firebase";
import { FullSplash } from "@/components/Splash";
import { toast } from "@/components/ui/Toast";
import { useT } from "@/lib/i18n";

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
 */
const redirectResultPromise = getRedirectResult(auth).catch((e) =>
  console.error(e),
);

export default function GoogleAuthPage() {
  const [redirect, setRedirect] = useState(false);
  const t = useT();
  useEffect(() => {
    redirectResultPromise.then((result) => {
      console.debug("Google redirect result:", result);
      if (result === null) {
        toast.error(t("auth.error.google_cancelled"));
      }
      // Navigate to "/" regardless — onAuthStateChanged handles routing.
      setRedirect(true);
    });
  }, []);

  if (redirect) {
    return <Navigate replace to="/" />;
  }

  return <FullSplash />;
}
