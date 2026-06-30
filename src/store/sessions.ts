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
  signInWithPopup,
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
  touchLastSeen,
  watchAllSessions,
  watchPlaces,
  watchUserGroups,
  watchUserSessions,
} from "@/lib/data";
import {
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
  swimsLastWeek: 0,
  swimsLastMonth: 0,
};

type State = {
  // ── Auth ─────────────────────────────────────────────────────────────
  user: User | null;
  profile: UserDoc | null;
  loading: boolean;
  /** Set when a signed-in session can't be established (e.g. the profile doc
   *  fails to load). The app reacts by signing out and bouncing the user back
   *  to /login with an error toast, rather than hanging on the splash. */
  authError: string | null;

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
  /** Place ids the current user has logged a swim at (for ringing "their" pins). */
  myPlaceIds: Set<string>;

  // ── Auth state ────────────────────────────────────────────────────────
  googleOnboarding: boolean;

  // ── "While you were away" ─────────────────────────────────────────────
  /** The user's *previous* visit timestamp, captured at login before we
   *  re-stamp lastSeenAt. null = first ever visit (nothing to look back on).
   *  Drives the welcome-back digest in components/SinceLastVisit — read this
   *  instead of profile.lastSeenAt, which gets overwritten with "now" by the
   *  in-flight touchLastSeen() write below, often before the digest runs. */
  lastSeenBaseline: number | null;
  /** True once lastSeenBaseline has been resolved for the current login, so
   *  the digest doesn't compute against the stale initial null. */
  lastSeenResolved: boolean;

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
  authError: null,
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
  myPlaceIds: new Set(),
  googleOnboarding: false,
  lastSeenBaseline: null,
  lastSeenResolved: false,

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
    const provider = new GoogleAuthProvider();
    // On localhost, signInWithRedirect round-trips through the Firebase
    // authDomain (*.firebaseapp.com) and relies on cross-site storage that
    // modern browsers block, so getRedirectResult comes back null and
    // sign-in silently fails. Use a popup in local dev; keep the redirect
    // flow in production (it's the right one for the installed mobile PWA).
    const host = typeof window !== "undefined" ? window.location.hostname : "";
    if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") {
      signInWithPopup(auth, provider).catch((e) => {
        const code = (e as { code?: string })?.code ?? "";
        // Ignore the user dismissing the popup; log the rest.
        if (
          code !== "auth/popup-closed-by-user" &&
          code !== "auth/cancelled-popup-request"
        ) {
          console.error("Google popup sign-in failed:", e);
        }
      });
      return;
    }
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
    signInWithRedirect(auth, provider);
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
    // Delete owned data first (server-side) — once the auth user is gone the
    // Cloud Function can no longer authenticate the caller.
    await deleteAccountData();
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

    // Named so the same reference can be removed on cleanup (an inline arrow
    // can never be unregistered, so the listener would leak).
    const onPermissionChange = () => {
      if (!permissionStatus) return;
      set({ locationPermission: permissionStatus.state as PermissionState });
      if (permissionStatus.state !== "denied") fetchLocation();
    };

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
          s.addEventListener("change", onPermissionChange);
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
          lastSeenBaseline: null,
          lastSeenResolved: false,
          ...derive("", [], get().allSessions, get().places),
        });
        return;
      }

      set({ user: u, myUid: u.uid, lastSeenResolved: false, authError: null });

      // A signed-in session we can't fully establish (profile won't load)
      // shouldn't strand the user on the splash. Sign back out and flag the
      // error so the app bounces them to /login with a toast.
      const failAuth = (reason: string) => {
        set({ authError: reason, loading: false });
        void signOut(auth).catch(() => {});
      };

      try {
        // If signup is still writing the user doc, wait for it to finish
        // before proceeding — ensureUserDoc is safe to call on an existing doc.
        if (signupDone) await signupDone;

        const profile = await ensureUserDoc(u.uid, u.displayName ?? "Swimmer");

        // Capture the previous visit *before* re-stamping it, then stamp
        // "now" so the next login can diff against this visit. The digest in
        // SinceLastVisit reads lastSeenBaseline; the live user-doc snapshot
        // below will carry the freshly-written value, which is fine — the
        // baseline is held separately in memory.
        set({
          lastSeenBaseline:
            typeof profile.lastSeenAt === "number" ? profile.lastSeenAt : null,
          lastSeenResolved: true,
        });
        void touchLastSeen(u.uid, Date.now());

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
        // Couldn't load the profile doc (network / Firestore failure). Treat
        // it as a failed login rather than leaving the user authed-but-
        // profileless, which would hang the splash forever.
        failAuth("profile_load_failed");
        return;
      }

      userUnsubs = [
        // User profile — so locale/display-name changes propagate live. A
        // terminal listen failure (e.g. permission revoked) bounces to login
        // instead of silently freezing on the last-known state.
        onSnapshot(
          doc(db, "users", u.uid),
          (snap) => {
            if (snap.exists()) {
              const data = snap.data() as UserDoc;
              set({ profile: data, loading: false });
              if (data.locale) useLocale.getState().setLocale(data.locale);
            } else {
              set({ profile: null });
            }
          },
          () => failAuth("profile_listen_failed"),
        ),

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
      permissionStatus?.removeEventListener("change", onPermissionChange);
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

  // Everyone's swims this season grouped by place — drives the map pin popups
  // (count + photos), so a spot shows all of the season's activity, not just
  // the current user's. Built from allSessions (the year-scoped feed).
  const sessionsByPlace = new Map<string, SessionDoc[]>();
  for (const s of allSessions) {
    const arr = sessionsByPlace.get(s.placeId) ?? [];
    arr.push(s);
    sessionsByPlace.set(s.placeId, arr);
  }

  // "My places" stays scoped to the current user's own swims.
  const myPlaceIds = new Set(mySessions.map((s) => s.placeId));
  const myPlaces = places.filter((p) => myPlaceIds.has(p.id));
  const achievementCtx: AchievementContext = { uid, mySessions, allSessions };
  const unlockedAchievements = evaluateAchievements(achievementCtx);

  return {
    myStats,
    sessionsByPlace,
    myPlaces,
    myPlaceIds,
    achievementCtx,
    unlockedAchievements,
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
