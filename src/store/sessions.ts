import { create } from "zustand";
import {
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  updateProfile,
  deleteUser,
  type User,
} from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { auth, db } from "@/firebase";
import {
  deleteAccountData,
  ensureUserDoc,
  recordAchievements,
  setupUserDoc,
  watchAllSessions,
  watchPlaces,
  watchUserGroups,
  watchUserSessions,
} from "@/lib/data";
import { evaluateAchievements } from "@/lib/achievements";
import type { GroupDoc, PlaceDoc, SessionDoc, UserDoc } from "@/lib/types";
import { useLocale } from "@/lib/i18n";

// Tracks whether a signup write is in-flight so the auth-state listener
// doesn't race to create a half-baked user doc in parallel.
let signupInFlight = false;

type State = {
  // ── Auth ─────────────────────────────────────────────────────────────
  user: User | null;
  profile: UserDoc | null;
  loading: boolean;

  // ── Data ─────────────────────────────────────────────────────────────
  myUid: string | null;
  mySessions: SessionDoc[];
  allSessions: SessionDoc[];
  places: PlaceDoc[];
  groups: GroupDoc[];

  // ── Auth actions ──────────────────────────────────────────────────────
  login: (email: string, password: string) => Promise<void>;
  signup: (
    email: string,
    password: string,
    displayName: string,
    homeCountry: string,
  ) => Promise<void>;
  logout: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  deleteAccount: () => Promise<void>;

  // ── Bootstrap ─────────────────────────────────────────────────────────
  /** Call once at app boot. Returns the cleanup function. */
  _startListening: () => () => void;
};

export const useStore = create<State>((set, get) => ({
  // ── Initial state ─────────────────────────────────────────────────────
  user: null,
  profile: null,
  loading: true,
  myUid: null,
  mySessions: [],
  allSessions: [],
  places: [],
  groups: [],

  // ── Auth actions ──────────────────────────────────────────────────────
  login: (email, password) =>
    signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password).then(
      () => {},
    ),

  signup: async (email, password, displayName, homeCountry) => {
    signupInFlight = true;
    try {
      const cred = await createUserWithEmailAndPassword(
        auth,
        email.trim().toLowerCase(),
        password,
      );
      await updateProfile(cred.user, { displayName: displayName.trim() });
      await setupUserDoc(cred.user.uid, displayName.trim(), {
        locale: useLocale.getState().locale,
        homeCountry,
      });
    } finally {
      signupInFlight = false;
    }
  },

  logout: () => signOut(auth),

  resetPassword: (email) =>
    sendPasswordResetEmail(auth, email.trim().toLowerCase()),

  deleteAccount: async () => {
    const current = auth.currentUser;
    if (!current) throw new Error("not signed in");
    // Delete owned data first — once the auth user is gone the client can
    // no longer satisfy Firestore's owner-only security rules.
    await deleteAccountData(current.uid);
    await deleteUser(current);
  },

  // ── Bootstrap ─────────────────────────────────────────────────────────
  _startListening: () => {
    let dataUnsubs: (() => void)[] = [];

    const stopData = () => {
      dataUnsubs.forEach((u) => u());
      dataUnsubs = [];
    };

    const authUnsub = onAuthStateChanged(auth, async (u) => {
      // Tear down the previous user's subscriptions on every auth change.
      stopData();
      set({ user: u, myUid: u?.uid ?? null });

      if (!u) {
        set({
          profile: null,
          loading: false,
          mySessions: [],
          allSessions: [],
          places: [],
          groups: [],
        });
        return;
      }

      if (signupInFlight) {
        // signup() is writing the doc; the onSnapshot below will pick it up.
        return;
      }

      const profile = await ensureUserDoc(u.uid, u.displayName ?? "Swimmer");
      set({ profile, loading: false });
      if (profile.locale) useLocale.getState().setLocale(profile.locale);

      dataUnsubs = [
        // User profile — kept here so locale/display name changes propagate.
        onSnapshot(doc(db, "users", u.uid), (snap) => {
          if (snap.exists()) {
            const data = snap.data() as UserDoc;
            set({ profile: data, loading: false });
            if (data.locale) useLocale.getState().setLocale(data.locale);
          } else {
            set({ profile: null });
          }
        }),

        watchUserSessions(u.uid, (mySessions) => {
          set({ mySessions });
          persistNewAchievements(get);
        }),

        watchAllSessions((allSessions) => {
          set({ allSessions });
          persistNewAchievements(get);
        }),

        watchPlaces((places) => set({ places })),

        watchUserGroups(u.uid, (groups) => set({ groups })),
      ];
    });

    return () => {
      authUnsub();
      stopData();
    };
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────

/** Persist any newly-unlocked achievements that aren't already in the profile. */
function persistNewAchievements(get: () => State) {
  const { user, profile, mySessions, allSessions } = get();
  if (!user || !profile) return;
  const unlocked = evaluateAchievements({ uid: user.uid, mySessions, allSessions });
  const persisted = new Set(Object.keys(profile.achievements ?? {}));
  const toPersist = [...unlocked].filter((id) => !persisted.has(id));
  if (toPersist.length) void recordAchievements(user.uid, toPersist);
}
