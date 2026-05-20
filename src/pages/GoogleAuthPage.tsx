import { useEffect, useState } from "react";
import { Navigate } from "react-router";
import { getRedirectResult } from "firebase/auth";
import { auth } from "@/firebase";
import { FullSplash } from "@/components/Splash";

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
  const [done, setDone] = useState(false);
  useEffect(() => {
    redirectResultPromise.then((result) => {
      if (result != null) {
        console.debug("Google login result", result);
        setDone(true);
      }
      // If result is null: redirect was cancelled, blocked, or already consumed.
      // onAuthStateChanged will handle routing if the user is actually signed in.
    });
  }, []);

  if (done) {
    return <Navigate replace to="/" />;
  }

  return <FullSplash />;
}
