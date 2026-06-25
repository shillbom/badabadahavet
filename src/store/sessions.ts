import { create } from "zustand";
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
import { auth, db } from "@/firebase";
import {
  deleteAccountData,
  ensureUserDoc,
  finalizeGoogleProfile,
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

// Resolves when the current signup write finishes, so the auth-state
// listener can wait rather than bail out and leave loading=true forever.
let signupDone: Promise<void> | null = null;

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
  countriesAbroad: 0,
};

type State = {
  // ── Auth ─────────────────────────────────────────────────────────────
  user: User | null;
  profile: UserDoc | null;
  loading: boolean;

  // ── Location ──────────────────────────────────────────────────────────
  currentLocation: { lat: number; lng: number } | null;
  locationPermission: PermissionState | "unsupported" | "checking";

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
  /** Place ids the current user has logged a swim at (for ringing "their" pins). */
  myPlaceIds: Set<string>;

  // ── Auth state ────────────────────────────────────────────────────────
  googleOnboarding: boolean;

  // ── Auth actions ──────────────────────────────────────────────────────
  login: (email: string, password: string) => Promise<void>;
  signup: (
    email: string,
    password: string,
    displayName: string,
    homeCountry: string,
  ) => Promise<void>;
  loginWithGoogle: () => void;
  completeGoogleOnboarding: (
    displayName: string,
    homeCountry: string,
  ) => Promise<void>;
  logout: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  deleteAccount: () => Promise<void>;

  // ── Bootstrap ─────────────────────────────────────────────────────────
  /** Call once at app boot. Returns the cleanup function. */
  _startListening: () => () => void;
  /** Refresh GPS position (e.g. after user grants permission). */
  _refreshLocation: () => void;
};

export const useStore = create<State>((set, get) => ({
  // ── Initial state ─────────────────────────────────────────────────────
  user: null,
  profile: null,
  loading: true,
  currentLocation: null,
  locationPermission: "checking",
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
  myPlaceIds: new Set(),
  googleOnboarding: false,

  // ── Auth actions ──────────────────────────────────────────────────────
  login: async (email, password) => {
    await signInWithEmailAndPassword(
      auth,
      email.trim().toLowerCase(),
      password,
    );
  },

  signup: async (email, password, displayName, homeCountry) => {
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
        locale: useLocale.getState().locale,
        homeCountry,
      });
    } finally {
      resolve();
      signupDone = null;
    }
  },

  loginWithGoogle: () => {
    // Preserve any deep link (e.g. /spot/abc?session=xyz) across the
    // Google redirect so the user lands back where they started. If the
    // caller already stashed a path (the "Sign in" button does this), keep
    // that — otherwise fall back to the current URL.
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
    // Silently rewrite the URL before redirecting. Firebase stores
    // window.location.href as the return URL, so this makes it land on
    // /auth/google after auth — without bouncing there first.
    window.history.replaceState(null, "", "/auth/google");
    signInWithRedirect(auth, new GoogleAuthProvider());
  },

  completeGoogleOnboarding: async (displayName, homeCountry) => {
    const { user } = get();
    if (!user) return;
    const trimmed = displayName.trim() || user.displayName || "Swimmer";
    await updateProfile(user, { displayName: trimmed });
    // Use updateDoc (via finalizeGoogleProfile) so we don't touch createdAt,
    // which the Firestore security rules forbid changing after creation.
    await finalizeGoogleProfile(user.uid, trimmed, {
      locale: useLocale.getState().locale,
      homeCountry,
    });
    set({ googleOnboarding: false });
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

  // ── Location ──────────────────────────────────────────────────────────
  _refreshLocation: () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        set({
          currentLocation: {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
          },
        }),
      () => {},
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 5 * 60 * 1000 },
    );
  },

  // ── Bootstrap ─────────────────────────────────────────────────────────
  _startListening: () => {
    // Public subscriptions (places + community sessions) survive auth
    // changes — but we hold off starting them until Firebase Auth has
    // resolved its first state. Subscribing before that race-condition
    // fires the query with `auth.currentUser == null`, which the current
    // production rules reject (sessions require signedIn) — and the
    // listener stays empty even after the user signs in.
    let publicUnsubs: (() => void)[] = [];
    let userUnsubs: (() => void)[] = [];
    let publicStarted = false;
    let permissionStatus: PermissionStatus | null = null;

    const fetchLocation = () => get()._refreshLocation();

    const stopUser = () => {
      userUnsubs.forEach((u) => u());
      userUnsubs = [];
    };

    const startPublic = () => {
      if (publicStarted) return;
      publicStarted = true;
      publicUnsubs = [
        watchAllSessions((allSessions) => {
          const { myUid, mySessions, places } = get();
          set({
            allSessions,
            ...derive(myUid ?? "", mySessions, allSessions, places),
          });
          if (myUid) persistNewAchievements(get);
        }),
        watchPlaces((places) => {
          const { myUid, mySessions, allSessions } = get();
          set({
            places,
            ...derive(myUid ?? "", mySessions, allSessions, places),
          });
        }),
      ];
    };

    // Kick off permission check immediately — independent of auth state.
    if (typeof navigator !== "undefined" && navigator.permissions) {
      navigator.permissions
        .query({ name: "geolocation" })
        .then((s) => {
          permissionStatus = s;
          set({ locationPermission: s.state });
          if (s.state !== "denied") fetchLocation();
          s.addEventListener("change", () => {
            set({ locationPermission: s.state as PermissionState });
            if (s.state !== "denied") fetchLocation();
          });
        })
        .catch(() => {
          set({ locationPermission: "unsupported" });
          fetchLocation();
        });
    } else {
      set({ locationPermission: "unsupported" });
      fetchLocation();
    }

    const authUnsub = onAuthStateChanged(auth, async (u) => {
      // First auth state resolved — safe to start public listeners now
      // (with the user's credentials attached if they're signed in).
      startPublic();
      // Tear down the previous user's subscriptions on every auth change.
      stopUser();
      if (!u) {
        set({
          user: null,
          myUid: null,
          profile: null,
          loading: false,
          googleOnboarding: false,
          mySessions: [],
          groups: [],
          ...derive("", [], get().allSessions, get().places),
        });
        return;
      }

      set({ user: u, myUid: u.uid });

      try {
        // If signup is still writing the user doc, wait for it to finish
        // before proceeding — ensureUserDoc is safe to call on an existing doc.
        if (signupDone) await signupDone;

        const profile = await ensureUserDoc(u.uid, u.displayName ?? "Swimmer");

        // A Google user with no homeCountry needs to complete onboarding.
        const isGoogleUser = u.providerData.some(
          (p) => p.providerId === "google.com",
        );
        if (isGoogleUser && !profile.homeCountry) {
          set({ googleOnboarding: true });
        }

        set({ profile, loading: false });
        if (profile.locale) useLocale.getState().setLocale(profile.locale);
      } catch {
        // Network error or Firestore failure — user is authed but profile
        // couldn't be loaded. Unblock the UI so the spinner doesn't hang.
        set({ loading: false });
      }

      userUnsubs = [
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
          set({
            mySessions,
            ...derive(u.uid, mySessions, allSessions, places),
          });
          persistNewAchievements(get);
        }),

        watchUserGroups(u.uid, (groups) => set({ groups })),
      ];
    });

    return () => {
      authUnsub();
      stopUser();
      publicUnsubs.forEach((u) => u());
      publicUnsubs = [];
      permissionStatus?.removeEventListener("change", () => {});
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
  const myPlaceIds = new Set(sessionsByPlace.keys());
  const achievementCtx: AchievementContext = { uid, mySessions, allSessions };
  const unlockedAchievements = evaluateAchievements(achievementCtx);
  const achievementBonusPoints = bonusPointsFor(achievementCtx);

  return {
    myStats,
    sessionsByPlace,
    myPlaces,
    myPlaceIds,
    achievementCtx,
    unlockedAchievements,
    achievementBonusPoints,
  };
}

/** Persist any newly-unlocked achievements that aren't already in the profile. */
function persistNewAchievements(get: () => State) {
  const { user, profile, mySessions, allSessions } = get();
  if (!user || !profile) return;
  const unlocked = evaluateAchievements({
    uid: user.uid,
    mySessions,
    allSessions,
  });
  const persisted = new Set(Object.keys(profile.achievements ?? {}));
  const toPersist = [...unlocked].filter((id) => !persisted.has(id));
  if (toPersist.length) void recordAchievements(user.uid, toPersist);
}
