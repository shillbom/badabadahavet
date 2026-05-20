// Stub shim used in `VITE_TARGET=capacitor` builds where the
// vite-plugin-pwa virtual module isn't generated. Mirrors the slice
// of the `virtual:pwa-register/react` API the app actually uses.

export function useRegisterSW(_opts?: {
  onNeedRefresh?: () => void;
  onOfflineReady?: () => void;
  onRegistered?: () => void;
  onRegisterError?: (err: unknown) => void;
}) {
  return {
    needRefresh: [false, () => {}] as const,
    offlineReady: [false, () => {}] as const,
    updateServiceWorker: async (_reloadPage?: boolean) => {},
  };
}
