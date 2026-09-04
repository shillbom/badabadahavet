"use client";

import dynamic from "next/dynamic";

/**
 * `ssr: false` is load-bearing: GoogleAuthPage calls `getRedirectResult(auth)`
 * at MODULE level (Firebase requires it to run while the page is still
 * loading), so the module must never be evaluated on the server. Nothing here
 * belongs in the HTML anyway — the page is a splash while the redirect result
 * resolves.
 */
const GoogleAuthPage = dynamic(() => import("@/views/GoogleAuthPage"), {
  ssr: false,
});

export default function Page() {
  return <GoogleAuthPage />;
}
