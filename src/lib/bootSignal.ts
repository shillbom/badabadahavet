/**
 * Tiny boot-readiness signal.
 *
 * Deliberately free of any heavy imports (no store, no Firebase) so the boot
 * splash can subscribe to it from anywhere without dragging the ~618 KB
 * Firebase chunk onto the first-paint critical path — including from the
 * server, where it always reads false (it is BootSplash's server snapshot).
 * app/AppBoot.tsx flips it once auth has resolved; BootSplash then plays its
 * exit and unmounts.
 */
let ready = false;
const listeners = new Set<() => void>();

/** Called by AppBoot once the app is booted and ready to be revealed.
 *  Idempotent. */
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
