import { useEffect } from "react";
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
  getAllPlacesOnce,
  recordAchievements,
  setupUserDoc,
  touchLastSeen,
  watchAllSessions,
  watchPlaceChangesSince,
  watchPlacesSummary,
  watchTempSummary,
  watchUserGroups,
  watchUserSessions,
} from "@/lib/data";
import {
  evaluateAchievements,
  type AchievementContext,
} from "@/lib/achievements";
import { computeMyStats, type MyStats } from "@/lib/stats";
import { computeStreak } from "@/lib/streak";
import { mergePlaceTemps } from "@/lib/temps";
import { mergeDelta } from "@/lib/places";
import type {
  GroupDoc,
  PlaceDoc,
  PlacePin,
  PlaceWithTemp,
  SessionDoc,
  TempReading,
  UserDoc,
  WaterSample,
} from "@/lib/types";
import { useLocale } from "@/lib/i18n";

// Resolves when the current signup write finishes, so the auth-state
// listener can wait rather than bail out and leave loading=true forever.
let signupDone: Promise<void> | null = null;

const EMPTY_STATS: MyStats = {
  totalSwims: 0,
  totalPoints: 0,
  uniquePlaces: 0,
  winterSwims: 0,
  streak: computeStreak([]),
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
  placesLastMonth: 0,
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
  /** Everyone's swims this year. Empty unless something on screen has
   *  acquired the community feed — see `useAllSessionsFeed`. */
  allSessions: SessionDoc[];
  /** True while the community-feed listener is live and has delivered at
   *  least one snapshot, i.e. `allSessions` can be trusted. */
  allSessionsReady: boolean;
  /** Every place's lightweight map fields, read from the daily-built
   *  `placesSummary/current` doc plus the bounded recent-changes delta —
   *  NOT the whole `places` collection. The full doc (info, provenance) is
   *  fetched on demand by SpotPage via getPlace. */
  places: PlacePin[];
  /** Latest water temperature per place id, from the single
   *  `tempSummary/current` doc (rebuilt by the daily sweep). Kept off the
   *  place docs so temp churn never re-streams the `places` collection. */
  tempsByPlace: Map<string, TempReading>;
  /** Latest water-quality sample per place id, from the same summary doc.
   *  Only Hav och Vatten baths with a recent lab sample have an entry. */
  qualityByPlace: Map<string, WaterSample>;
  groups: GroupDoc[];

  // ── Derived / pre-computed ────────────────────────────────────────────
  /** Stats computed from the current user's sessions. */
  myStats: MyStats;
  /** Current user's sessions indexed by place id. */
  sessionsByPlace: Map<string, SessionDoc[]>;
  /** `places` with each place's summary reading merged in — what the map
   *  and any temp-reading UI should consume instead of `places`. */
  placesWithTemps: PlaceWithTemp[];
  /** Places the current user has logged a swim at (temps merged in). */
  myPlaces: PlaceWithTemp[];
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
  /** Acquire the community feed (all sessions this year). The Firestore
   *  listener runs only while at least one acquisition is held — prefer the
   *  `useAllSessionsFeed` hook over calling this directly. Returns the
   *  matching release function. */
  _acquireAllSessions: () => () => void;
};

// ── Community-feed (all sessions) lazy lifecycle ─────────────────────────
// The year-scoped all-sessions listener is the most expensive subscription
// in the app (every user's swims), so it must NOT run for the app's whole
// lifetime. It only runs while something on screen actually needs it:
// consumers acquire it (useAllSessionsFeed) and release on unmount, and the
// listener is torn down after a grace period so hopping between two
// consumers (map → leaderboard) doesn't re-download the whole feed.
const FEED_KEEP_ALIVE_MS = 60_000;
let feedRefs = 0;
let feedUnsub: (() => void) | null = null;
let feedStopTimer: ReturnType<typeof setTimeout> | null = null;
// The sessions rules require a signed-in caller, so the feed can only start
// once the first auth state has resolved (see _startListening).
let feedAuthReady = false;

export const useStore = create<State>((set, get) => {
  // Start the community-feed listener if it should be running (something has
  // acquired it, auth has resolved, and there's a signed-in user — the
  // sessions rules reject unauthenticated reads).
  const startFeed = () => {
    if (feedUnsub || feedRefs === 0 || !feedAuthReady || !auth.currentUser)
      return;
    feedUnsub = watchAllSessions((allSessions) => {
      const { myUid, mySessions, places, tempsByPlace, profile } = get();
      set({
        allSessions,
        allSessionsReady: true,
        ...derive(
          myUid ?? "",
          mySessions,
          allSessions,
          places,
          tempsByPlace,
          profile?.achievements,
        ),
      });
      if (myUid) persistNewAchievements(get);
    });
  };

  const stopFeed = () => {
    if (feedStopTimer) {
      clearTimeout(feedStopTimer);
      feedStopTimer = null;
    }
    if (feedUnsub) {
      feedUnsub();
      feedUnsub = null;
    }
    set({ allSessionsReady: false });
  };

  return {
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
    allSessionsReady: false,
    places: [],
    tempsByPlace: new Map(),
    qualityByPlace: new Map(),
    groups: [],
    myStats: EMPTY_STATS,
    sessionsByPlace: new Map(),
    placesWithTemps: [],
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
      const host =
        typeof window !== "undefined" ? window.location.hostname : "";
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
      // The places subscription survives auth changes — but we hold off
      // starting it until Firebase Auth has resolved its first state, so the
      // query carries the user's credentials when they're signed in. The
      // community feed (all sessions) is NOT started here: it's expensive and
      // only runs while something has acquired it via _acquireAllSessions.
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

      // Places are read from the daily-built `placesSummary/current` doc (one
      // read, always-on for everyone — it powers the map's pins) plus a
      // bounded `updatedAt > builtAt` delta listener over the `places`
      // collection that surfaces spots created/edited since that build. The
      // delta is a live subscription, so we hold it ONLY while signed in —
      // guests make do with the daily summary and never subscribe to `places`
      // (one-off reads like getPlace on a spot page are unaffected). lastSwim*
      // rides in the summary, so a swim never re-streams a place doc. The
      // merged array is recomputed whenever the summary or the delta fires.
      let summaryPins: PlacePin[] = [];
      let deltaDocs: PlaceDoc[] = [];
      let stopDelta: (() => void) | null = null;
      let deltaCursor: number | null = null; // builtAt the delta is scoped to
      let latestBuiltAt = 0; // most recent summary build cursor
      let summaryLoaded = false; // summary listener has fired at least once
      let fallbackStarted = false; // one-time full read (missing summary) done

      const applyPlaces = () => {
        const places = mergeDelta(summaryPins, deltaDocs);
        const { myUid, mySessions, allSessions, tempsByPlace, profile } = get();
        set({
          places,
          ...derive(
            myUid ?? "",
            mySessions,
            allSessions,
            places,
            tempsByPlace,
            profile?.achievements,
          ),
        });
      };

      // Bring the delta subscription in line with auth + the latest build
      // cursor: run it only while signed in and after the summary has loaded,
      // scoped to the current builtAt; tear it down (and drop its docs)
      // otherwise. Idempotent — called on every auth change and summary
      // snapshot. On each nightly build the cursor advances and yesterday's
      // deltas fold into the summary, so the window resets to ~empty.
      const syncDelta = () => {
        const wantOn = summaryLoaded && !!auth.currentUser;
        if (!wantOn) {
          if (stopDelta) {
            stopDelta();
            stopDelta = null;
            deltaCursor = null;
            if (deltaDocs.length) {
              deltaDocs = [];
              applyPlaces();
            }
          }
          return;
        }
        if (stopDelta && deltaCursor === latestBuiltAt) return;
        stopDelta?.();
        deltaCursor = latestBuiltAt;
        deltaDocs = [];
        stopDelta = watchPlaceChangesSince(latestBuiltAt, (docs) => {
          deltaDocs = docs;
          applyPlaces();
        });
      };

      const startPublic = () => {
        if (publicStarted) return;
        publicStarted = true;

        publicUnsubs = [
          // placesSummary/current — one doc, always-on for everyone (guests
          // included). The live `places` delta is a separate subscription
          // gated on auth by syncDelta().
          watchPlacesSummary(({ pins, builtAt, exists }) => {
            summaryLoaded = true;
            if (exists) {
              summaryPins = pins;
              latestBuiltAt = builtAt;
            } else {
              // Pre-rollout / missing summary: a one-time full read (not a
              // subscription) so the map isn't blank; track new spots from now.
              latestBuiltAt = latestBuiltAt || Date.now();
              if (!fallbackStarted) {
                fallbackStarted = true;
                getAllPlacesOnce()
                  .then((docs) => {
                    summaryPins = docs;
                    applyPlaces();
                    return;
                  })
                  .catch(() => {
                    /* leave the pins we have; the delta still updates */
                  });
              }
            }
            applyPlaces();
            syncDelta();
          }),
          () => {
            stopDelta?.();
            stopDelta = null;
          },
          // One doc that only the daily sweep rewrites (~1 read/client/day),
          // so always-on is fine — no lazy refcounting like the community
          // feed. Needed by guests too (the map shows temps signed-out).
          watchTempSummary(({ temps, quality }) => {
            const { myUid, mySessions, allSessions, places, profile } = get();
            set({
              tempsByPlace: temps,
              qualityByPlace: quality,
              ...derive(
                myUid ?? "",
                mySessions,
                allSessions,
                places,
                temps,
                profile?.achievements,
              ),
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
            return;
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
        feedAuthReady = true;
        startPublic();
        // Tear down the previous user's subscriptions on every auth change.
        stopUser();
        // The `places` delta is a live subscription — hold it only while
        // signed in. Starts it on sign-in, stops (and drops its docs) on
        // sign-out; a no-op until the summary has loaded (it starts the delta
        // itself then).
        syncDelta();
        if (!u) {
          // Signed out: the sessions rules reject unauthenticated reads, so
          // stop the community feed and drop its data (it restarts on the next
          // sign-in if something still holds an acquisition).
          stopFeed();
          set({
            user: null,
            myUid: null,
            profile: null,
            loading: false,
            googleOnboarding: false,
            mySessions: [],
            allSessions: [],
            groups: [],
            lastSeenBaseline: null,
            lastSeenResolved: false,
            ...derive("", [], [], get().places, get().tempsByPlace),
          });
          return;
        }

        set({
          user: u,
          myUid: u.uid,
          lastSeenResolved: false,
          authError: null,
        });
        // Signed in — resume the community feed if something is waiting on it.
        startFeed();

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

          const profile = await ensureUserDoc(
            u.uid,
            u.displayName ?? "Swimmer",
          );

          // Capture the previous visit *before* re-stamping it, then stamp
          // "now" so the next login can diff against this visit. The digest in
          // SinceLastVisit reads lastSeenBaseline; the live user-doc snapshot
          // below will carry the freshly-written value, which is fine — the
          // baseline is held separately in memory.
          set({
            lastSeenBaseline:
              typeof profile.lastSeenAt === "number"
                ? profile.lastSeenAt
                : null,
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
                const { mySessions, allSessions, places, tempsByPlace } = get();
                set({
                  profile: data,
                  loading: false,
                  // Re-derive so achievements persisted on the profile (e.g.
                  // unlocked on another device) show up without waiting for
                  // the next sessions snapshot.
                  ...derive(
                    u.uid,
                    mySessions,
                    allSessions,
                    places,
                    tempsByPlace,
                    data.achievements,
                  ),
                });
                if (data.locale) useLocale.getState().setLocale(data.locale);
              } else {
                set({ profile: null });
              }
            },
            () => failAuth("profile_listen_failed"),
          ),

          watchUserSessions(u.uid, (mySessions) => {
            const { allSessions, places, tempsByPlace, profile } = get();
            set({
              mySessions,
              ...derive(
                u.uid,
                mySessions,
                allSessions,
                places,
                tempsByPlace,
                profile?.achievements,
              ),
            });
            persistNewAchievements(get);
          }),

          watchUserGroups(u.uid, (groups) => set({ groups })),
        ];
      });

      return () => {
        authUnsub();
        stopUser();
        stopFeed();
        feedAuthReady = false;
        publicUnsubs.forEach((u) => u());
        publicUnsubs = [];
        permissionStatus?.removeEventListener("change", onPermissionChange);
      };
    },

    _acquireAllSessions: () => {
      feedRefs++;
      if (feedStopTimer) {
        clearTimeout(feedStopTimer);
        feedStopTimer = null;
      }
      startFeed();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        feedRefs--;
        if (feedRefs > 0 || !feedUnsub) return;
        // Last consumer gone — keep the listener warm for a grace period so
        // quick navigation between feed-hungry pages doesn't re-download
        // the whole year of sessions.
        feedStopTimer = setTimeout(() => {
          feedStopTimer = null;
          if (feedRefs === 0) stopFeed();
        }, FEED_KEEP_ALIVE_MS);
      };
    },
  };
});

/**
 * Keep the community feed (everyone's swims this year) subscribed while the
 * calling component is mounted and `active` is true. The underlying Firestore
 * listener is shared and refcounted — it starts with the first active
 * consumer and stops shortly after the last one releases. Read the data via
 * `useStore((s) => s.allSessions)` (or the values derived from it) as usual;
 * `allSessionsReady` tells you whether the feed is live yet.
 */
export function useAllSessionsFeed(active: boolean = true): void {
  useEffect(() => {
    if (!active) return;
    return useStore.getState()._acquireAllSessions();
  }, [active]);
}

// ── Helpers ───────────────────────────────────────────────────────────────

/** Inputs and outputs of the previous derive() call, for input-identity
 *  memoization. Firestore snapshots always deliver fresh array references,
 *  so `memo.x === x` means that input genuinely didn't change — e.g. a
 *  temp-summary snapshot must only rebuild placesWithTemps/myPlaces, never
 *  re-scan the community feed or re-evaluate achievements. */
type DeriveMemo = {
  uid: string;
  mySessions: SessionDoc[];
  allSessions: SessionDoc[];
  places: PlacePin[];
  temps: Map<string, TempReading>;
  myStats: MyStats;
  sessionsByPlace: Map<string, SessionDoc[]>;
  placesWithTemps: PlaceWithTemp[];
  myPlaces: PlaceWithTemp[];
  myPlaceIds: Set<string>;
  achievementCtx: AchievementContext;
  unlockedAchievements: Set<string>;
};
let deriveMemo: DeriveMemo | null = null;

/**
 * Compute all derived state from raw data in one pass.
 * Called whenever sessions, places, or temps change so every component reads
 * pre-computed values instead of recomputing in useMemo. Each derived value
 * is reused (same reference) when the inputs it depends on are unchanged,
 * so store subscribers don't re-render on unrelated snapshots.
 */
function derive(
  uid: string,
  mySessions: SessionDoc[],
  allSessions: SessionDoc[],
  places: PlacePin[],
  temps: Map<string, TempReading>,
  persistedAchievements?: Record<string, number>,
) {
  const m = deriveMemo;
  const sameMine = m !== null && m.mySessions === mySessions;
  const sameAll = m !== null && m.allSessions === allSessions;
  const samePlaces = m !== null && m.places === places;
  const sameTemps = m !== null && m.temps === temps;
  const sameCtx = m !== null && m.uid === uid && sameMine && sameAll;

  const myStats = sameMine ? m.myStats : computeMyStats(mySessions);

  // Everyone's swims this season grouped by place — drives the map pin popups
  // (count + photos), so a spot shows all of the season's activity, not just
  // the current user's. Built from allSessions (the year-scoped feed).
  let sessionsByPlace: Map<string, SessionDoc[]>;
  if (sameAll) {
    sessionsByPlace = m.sessionsByPlace;
  } else {
    sessionsByPlace = new Map();
    for (const s of allSessions) {
      const arr = sessionsByPlace.get(s.placeId) ?? [];
      arr.push(s);
      sessionsByPlace.set(s.placeId, arr);
    }
  }

  // Places with their current summary reading merged in — what the map and
  // any temp-reading UI consume. The merge is by id, no query involved.
  const placesWithTemps =
    samePlaces && sameTemps
      ? m.placesWithTemps
      : mergePlaceTemps(places, temps);

  // "My places" stays scoped to the current user's own swims. Filters the
  // merged array (not raw `places`) because MapPage feeds it to SwimMap.
  const myPlaceIds = sameMine
    ? m.myPlaceIds
    : new Set(mySessions.map((s) => s.placeId));
  const myPlaces =
    sameMine && samePlaces && sameTemps
      ? m.myPlaces
      : placesWithTemps.filter((p) => myPlaceIds.has(p.id));

  const achievementCtx: AchievementContext = sameCtx
    ? m.achievementCtx
    : { uid, mySessions, allSessions };
  const unlockedAchievements = sameCtx
    ? new Set(m.unlockedAchievements)
    : evaluateAchievements(achievementCtx);
  // Achievements already persisted on the profile stay unlocked even when
  // the community feed isn't loaded — community-dependent ones would
  // otherwise flicker off while `allSessions` is empty.
  for (const id of Object.keys(persistedAchievements ?? {}))
    unlockedAchievements.add(id);

  // Keep the previous set's reference when the contents are identical, so a
  // profile snapshot that only re-stamped lastSeenAt doesn't re-render every
  // achievement consumer. (The set is small — ~20 ids — so this is cheap.)
  const finalUnlocked =
    m !== null &&
    m.unlockedAchievements.size === unlockedAchievements.size &&
    [...unlockedAchievements].every((id) => m.unlockedAchievements.has(id))
      ? m.unlockedAchievements
      : unlockedAchievements;

  deriveMemo = {
    uid,
    mySessions,
    allSessions,
    places,
    temps,
    myStats,
    sessionsByPlace,
    placesWithTemps,
    myPlaces,
    myPlaceIds,
    achievementCtx,
    unlockedAchievements: finalUnlocked,
  };

  return {
    myStats,
    sessionsByPlace,
    placesWithTemps,
    myPlaces,
    myPlaceIds,
    achievementCtx,
    unlockedAchievements: finalUnlocked,
  };
}

/** Persist any newly-unlocked achievements that aren't already in the profile. */
function persistNewAchievements(get: () => State) {
  const { user, profile, unlockedAchievements } = get();
  if (!user || !profile) return;
  // derive() already ran (callers set() its output first) and its result is
  // evaluated ∪ persisted, so filtering out the persisted ids leaves exactly
  // the newly-evaluated ones — no need to evaluate achievements again.
  const persisted = profile.achievements ?? {};
  const toPersist = [...unlockedAchievements].filter(
    (id) => !(id in persisted),
  );
  if (toPersist.length) void recordAchievements(user.uid, toPersist);
}
