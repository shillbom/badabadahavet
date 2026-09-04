"use client";

import Redirect from "@/components/Redirect";

/**
 * The app has never had a 404 page: react-router's catch-all was
 * `<Navigate to="/" replace />`, so an unknown path just landed on the map.
 * Keep that. Next still answers with a 404 status (correct for crawlers) —
 * the browser is simply moved home once the shell has booted.
 */
export default function NotFound() {
  return <Redirect to="/" />;
}
