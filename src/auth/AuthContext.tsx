/**
 * Thin compatibility shim so existing call sites (useAuth, AuthProvider)
 * keep working unchanged. All logic now lives in src/store/sessions.ts.
 */
import type { ReactNode } from "react";
import { useStore } from "@/store/sessions";

/** Drop-in replacement — renders children directly, no context needed. */
export function AuthProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

/** Same shape as before; reads from the Zustand store. */
export function useAuth() {
  const user = useStore((s) => s.user);
  const profile = useStore((s) => s.profile);
  const loading = useStore((s) => s.loading);
  const googleOnboarding = useStore((s) => s.googleOnboarding);
  const login = useStore((s) => s.login);
  const signup = useStore((s) => s.signup);
  const loginWithGoogle = useStore((s) => s.loginWithGoogle);
  const completeGoogleOnboarding = useStore((s) => s.completeGoogleOnboarding);
  const logout = useStore((s) => s.logout);
  const resetPassword = useStore((s) => s.resetPassword);
  const deleteAccount = useStore((s) => s.deleteAccount);
  return {
    user,
    profile,
    loading,
    googleOnboarding,
    login,
    signup,
    loginWithGoogle,
    completeGoogleOnboarding,
    logout,
    resetPassword,
    deleteAccount,
  };
}
