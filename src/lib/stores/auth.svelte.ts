import {
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  updateProfile,
  deleteUser,
  GoogleAuthProvider,
  signInWithRedirect,
  type User,
} from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import {
  deleteAccountData,
  ensureUserDoc,
  finalizeGoogleProfile,
  setupUserDoc,
} from "@/lib/data";
import { localeStore } from "@/lib/stores/locale.svelte";
import type { UserDoc } from "@/lib/types";

// Resolves when the current signup write finishes, so the auth-state
// listener can wait rather than bail out and leave loading=true forever.
let signupDone: Promise<void> | null = null;

/**
 * Phase 1 — global auth state. Converted from the Zustand store's auth slice
 * into a native Svelte 5 reactive class. Owns the Firebase `onAuthStateChanged`
 * listener so `currentUser` / `profile` / `loading` stay reactive everywhere.
 */
class AuthStore {
  /** The Firebase Auth user (renamed from `user` per the migration spec). */
  user = $state<User | null>(null);
  /** The Firestore user document. */
  profile = $state<UserDoc | null>(null);
  loading = $state(true);
  googleOnboarding = $state(false);
  authErrors = $state<string[]>([]);
  /** Flips true once Firebase Auth resolves its first state. */
  resolved = $state(false);

  /** Convenience alias matching the spec's `currentUser`. */
  get currentUser() {
    return this.user;
  }

  private userDocUnsub: (() => void) | null = null;

  /** Call once at app boot. Returns a cleanup function. */
  init(): () => void {
    const authUnsub = onAuthStateChanged(auth, async (u) => {
      this.resolved = true;
      this.userDocUnsub?.();
      this.userDocUnsub = null;

      if (!u) {
        this.user = null;
        this.profile = null;
        this.loading = false;
        this.googleOnboarding = false;
        return;
      }

      this.user = u;

      try {
        // If signup is still writing the user doc, wait for it to finish
        // before proceeding — ensureUserDoc is safe on an existing doc.
        if (signupDone) await signupDone;

        const profile = await ensureUserDoc(u.uid, u.displayName ?? "Swimmer");

        // A Google user with no homeCountry needs to complete onboarding.
        const isGoogleUser = u.providerData.some(
          (p) => p.providerId === "google.com",
        );
        if (isGoogleUser && !profile.homeCountry) this.googleOnboarding = true;

        this.profile = profile;
        this.loading = false;
        if (profile.locale) localeStore.set(profile.locale);
      } catch {
        // Network/Firestore failure — unblock the UI so the spinner clears.
        this.loading = false;
      }

      // Live user doc — so locale/display-name changes propagate.
      this.userDocUnsub = onSnapshot(doc(db, "users", u.uid), (snap) => {
        if (snap.exists()) {
          const data = snap.data() as UserDoc;
          this.profile = data;
          this.loading = false;
          if (data.locale) localeStore.set(data.locale);
        } else {
          this.profile = null;
        }
      });
    });

    return () => {
      authUnsub();
      this.userDocUnsub?.();
      this.userDocUnsub = null;
    };
  }

  // ── Actions ─────────────────────────────────────────────────────────────
  async login(email: string, password: string) {
    await signInWithEmailAndPassword(
      auth,
      email.trim().toLowerCase(),
      password,
    );
  }

  async signup(
    email: string,
    password: string,
    displayName: string,
    homeCountry: string,
  ) {
    let resolve!: () => void;
    signupDone = new Promise<void>((r) => {
      resolve = r;
    });
    try {
      const cred = await createUserWithEmailAndPassword(
        auth,
        email.trim().toLowerCase(),
        password,
      );
      await updateProfile(cred.user, { displayName: displayName.trim() });
      await setupUserDoc(cred.user.uid, displayName.trim(), {
        locale: localeStore.current,
        homeCountry,
      });
    } finally {
      resolve();
      signupDone = null;
    }
  }

  loginWithGoogle() {
    // Preserve any deep link across the Google redirect so the user lands
    // back where they started.
    try {
      const existing = sessionStorage.getItem("login.returnTo");
      if (!existing) {
        const here =
          window.location.pathname +
          window.location.search +
          window.location.hash;
        if (
          here &&
          here !== "/" &&
          !here.startsWith("/auth/google") &&
          !here.startsWith("/login")
        ) {
          sessionStorage.setItem("login.returnTo", here);
        }
      }
    } catch {
      /* sessionStorage may be unavailable (private mode) — fall through */
    }
    // Firebase stores window.location.href as the return URL, so rewrite it
    // first to land on /auth/google after auth — without bouncing there.
    window.history.replaceState(null, "", "/auth/google");
    signInWithRedirect(auth, new GoogleAuthProvider());
  }

  async completeGoogleOnboarding(displayName: string, homeCountry: string) {
    const user = this.user;
    if (!user) return;
    const trimmed = displayName.trim() || user.displayName || "Swimmer";
    await updateProfile(user, { displayName: trimmed });
    // updateDoc (via finalizeGoogleProfile) so we don't touch createdAt,
    // which the Firestore security rules forbid changing after creation.
    await finalizeGoogleProfile(user.uid, trimmed, {
      locale: localeStore.current,
      homeCountry,
    });
    this.googleOnboarding = false;
  }

  async logout() {
    await signOut(auth);
  }

  async resetPassword(email: string) {
    await sendPasswordResetEmail(auth, email.trim().toLowerCase());
  }

  async deleteAccount() {
    const current = auth.currentUser;
    if (!current) throw new Error("not signed in");
    // Delete owned data first — once the auth user is gone the client can no
    // longer satisfy Firestore's owner-only security rules.
    await deleteAccountData(current.uid);
    await deleteUser(current);
  }
}

export const authStore = new AuthStore();
