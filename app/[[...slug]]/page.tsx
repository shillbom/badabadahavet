import ClientShell from "./ClientShell";

/**
 * Phase 1 of the Next migration: a single catch-all route that mounts the
 * existing react-router SPA unchanged, so the app is served by Next without
 * any behaviour change. Phase 2 replaces this with real App Router routes —
 * as those land, this catch-all stops matching them (a static or dynamic
 * segment always wins over an optional catch-all).
 */
export default function CatchAllPage() {
  return <ClientShell />;
}
