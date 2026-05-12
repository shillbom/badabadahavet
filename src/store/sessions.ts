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
import {
  bonusPointsFor,
  evaluateAchievements,
  type AchievementContext,
} from "@/lib/achievements";
import { computeMyStats, type MyStats } from "@/lib/stats";
import type { GroupDoc, PlaceDoc, SessionDoc, UserDoc } from "@/lib/types";
import { useLocale } from "@/lib/i18n";

// Tracks whether a signup write is in-flight so the auth-state listener
// doesn't race to create a half-baked user doc in parallel.
let signupInFlight = false;

const EMPTY_STATS: MyStats = {
  totalSwims: 0,
  totalPoints: 0,
  uniquePlaces: 0,
  winterSwims: 0,
  currentDayStreak: 0,
  daysSinceLast: null,
  currentWeekStreak: 0,
  longestWeekStreak: 0,
  favouriteSpot: null,
  bestMonth: null,
  range: null,
  onThisDay: null,
};

type State = {
  // ── Auth ─────────────────────────────────────────────────────────────
  user: User | null;
  profile: UserDoc | null;
  loading: boolean;

  // ── Raw data ──────────────────────────────────────────────────────────
  myUid: string | null;
  mySessions: SessionDoc[];
  allSessions: SessionDoc[];
  places: PlaceDoc[];
  groups: GroupDoc[];

  // ── Derived / pre-computed ────────────────────────────────────────────
  /** Stats computed from the current user's sessions. */
  myStats: MyStats;
  /** Current user's sessions indexed by place id. */
  sessionsByPlace: Map<string, SessionDoc[]>;
  /** Places the current user has logged a swim at. */
  myPlaces: PlaceDoc[];
  /** Context object for achievement evaluation (uid + both session arrays). */
  achievementCtx: AchievementContext;
  /** Set of achievement ids the current user has unlocked. */
  unlockedAchievements: Set<string>;
  /** Total bonus points from unlocked achievements. */
  achievementBonusPoints: number;

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
  myStats: EMPTY_STATS,
  sessionsByPlace: new Map(),
  myPlaces: [],
  achievementCtx: { uid: "", mySessions: [], allSessions: [] },
  unlockedAchievements: new Set(),
  achievementBonusPoints: 0,

  // ── Auth actions ──────────────────────────────────────────────────────
  login: async (email, password) => {
    await signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
  },

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

  logout: async () => await signOut(auth),

  resetPassword: async (email) =>
    await sendPasswordResetEmail(auth, email.trim().toLowerCase()),

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
          myStats: EMPTY_STATS,
          sessionsByPlace: new Map(),
          myPlaces: [],
          achievementCtx: { uid: "", mySessions: [], allSessions: [] },
          unlockedAchievements: new Set(),
          achievementBonusPoints: 0,
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
        // User profile — so locale/display-name changes propagate live.
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
          const { allSessions, places } = get();
          set({ mySessions, ...derive(u.uid, mySessions, allSessions, places) });
          persistNewAchievements(get);
        }),

        watchAllSessions((allSessions) => {
          const { myUid, mySessions, places } = get();
          set({ allSessions, ...derive(myUid ?? "", mySessions, allSessions, places) });
          persistNewAchievements(get);
        }),

        watchPlaces((places) => {
          const { myUid, mySessions, allSessions } = get();
          set({ places, ...derive(myUid ?? "", mySessions, allSessions, places) });
        }),

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

/**
 * Compute all derived state from raw data in one pass.
 * Called whenever sessions or places change so every component reads
 * pre-computed values instead of recomputing in useMemo.
 */
function derive(
  uid: string,
  mySessions: SessionDoc[],
  allSessions: SessionDoc[],
  places: PlaceDoc[],
) {
  const myStats = computeMyStats(mySessions);

  const sessionsByPlace = new Map<string, SessionDoc[]>();
  for (const s of mySessions) {
    const arr = sessionsByPlace.get(s.placeId) ?? [];
    arr.push(s);
    sessionsByPlace.set(s.placeId, arr);
  }

  const myPlaces = places.filter((p) => sessionsByPlace.has(p.id));
  const achievementCtx: AchievementContext = { uid, mySessions, allSessions };
  const unlockedAchievements = evaluateAchievements(achievementCtx);
  const achievementBonusPoints = bonusPointsFor(achievementCtx);

  return {
    myStats,
    sessionsByPlace,
    myPlaces,
    achievementCtx,
    unlockedAchievements,
    achievementBonusPoints,
  };
}

/** Persist any newly-unlocked achievements that aren't already in the profile. */
function persistNewAchievements(get: () => State) {
  const { user, profile, mySessions, allSessions } = get();
  if (!user || !profile) return;
  const unlocked = evaluateAchievements({ uid: user.uid, mySessions, allSessions });
  const persisted = new Set(Object.keys(profile.achievements ?? {}));
  const toPersist = [...unlocked].filter((id) => !persisted.has(id));
  if (toPersist.length) void recordAchievements(user.uid, toPersist);
}
