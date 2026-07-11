/**
 * Tiny boot-readiness signal.
 *
 * Deliberately free of any heavy imports (no store, no Firebase) so the boot
 * splash — mounted eagerly in main.tsx, outside the lazy <App> boundary — can
 * subscribe to it without dragging the ~618 KB Firebase chunk onto the
 * first-paint critical path. App (lazy) flips it once auth has resolved and the
 * first route chunk is loaded; BootSplash then plays its exit and unmounts.
 */
let ready = false;
const listeners = new Set<() => void>();

/** Called by App once the app is booted and ready to be revealed. Idempotent. */
export function setBootReady() {
  if (ready) return;
  ready = true;
  for (const listener of listeners) listener();
}

/** useSyncExternalStore subscribe. */
export function subscribeBootReady(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** useSyncExternalStore getSnapshot. */
export function getBootReady() {
  return ready;
}
