"use client";

import SpotPage from "@/views/SpotPage";

// TODO(phase-3): this becomes a server component with `generateMetadata` —
// per-place <title>/OG tags read via firebase-admin, replacing the
// spotPreview UA-sniffing Cloud Function, with the live parts (reactions,
// temp refresh, session listener) hydrated underneath as SpotViewContent.
export default function Page() {
  return <SpotPage />;
}
