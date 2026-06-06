import { browser } from "$app/environment";
import {
  recordAchievements,
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
import { computeMyStats } from "@/lib/stats";
import type { GroupDoc, PlaceDoc, SessionDoc } from "@/lib/types";
import { authStore } from "@/lib/stores/auth.svelte";

/**
 * Phase 2 — the former Zustand `useStore` data slice, rewritten as a single
 * Svelte 5 reactive class. Raw Firestore data lives in `$state` fields; every
 * value the old store hand-rolled in `derive()` is now a `$derived` getter, so
 * there are no manual recompute calls or object spreads to track.
 */
class AppStore {
  // ── Location ──────────────────────────────────────────────────────────
  currentLocation = $state<{ lat: number; lng: number } | null>(null);
  locationPermission = $state<PermissionState | "unsupported" | "checking">(
    "checking",
  );

  // ── Raw data ──────────────────────────────────────────────────────────
  places = $state<PlaceDoc[]>([]);
  allSessions = $state<SessionDoc[]>([]);
  mySessions = $state<SessionDoc[]>([]);
  groups = $state<GroupDoc[]>([]);

  // ── Derived (was the imperative `derive()` helper) ──────────────────────
  myUid = $derived(authStore.user?.uid ?? null);
  myStats = $derived(computeMyStats(this.mySessions));

  sessionsByPlace = $derived.by(() => {
    const map = new Map<string, SessionDoc[]>();
    for (const s of this.mySessions) {
      const arr = map.get(s.placeId) ?? [];
      arr.push(s);
      map.set(s.placeId, arr);
    }
    return map;
  });

  myPlaces = $derived.by(() =>
    this.places.filter((p) => this.sessionsByPlace.has(p.id)),
  );

  achievementCtx = $derived<AchievementContext>({
    uid: this.myUid ?? "",
    mySessions: this.mySessions,
    allSessions: this.allSessions,
  });

  unlockedAchievements = $derived(evaluateAchievements(this.achievementCtx));
  achievementBonusPoints = $derived(bonusPointsFor(this.achievementCtx));

  // ── Subscription bookkeeping ────────────────────────────────────────────
  #publicUnsubs: Array<() => void> = [];
  #userUnsubs: Array<() => void> = [];
  #publicStarted = false;
  #permissionStatus: PermissionStatus | null = null;
  #rootCleanup: (() => void) | null = null;

  /** Call once at app boot. Returns a cleanup function. */
  start(): () => void {
    if (!browser) return () => {};

    this.#initLocation();

    // Manually-rooted effects (we live outside any component lifecycle).
    this.#rootCleanup = $effect.root(() => {
      // Public subscriptions wait for the first auth state — querying sessions
      // before `auth.currentUser` is set is rejected by the security rules.
      $effect(() => {
        if (authStore.resolved && !this.#publicStarted) this.#startPublic();
      });

      // User subscriptions follow the signed-in user across auth changes.
      $effect(() => {
        const uid = authStore.user?.uid ?? null;
        this.#stopUser();
        if (uid) this.#startUser(uid);
      });

      // Persist any newly-unlocked achievements not already in the profile.
      $effect(() => {
        const unlocked = this.unlockedAchievements;
        const profile = authStore.profile;
        const uid = authStore.user?.uid;
        if (!uid || !profile) return;
        const persisted = new Set(Object.keys(profile.achievements ?? {}));
        const toPersist = [...unlocked].filter((id) => !persisted.has(id));
        if (toPersist.length) void recordAchievements(uid, toPersist);
      });
    });

    return () => this.#stop();
  }

  /** Refresh GPS position (e.g. after the user grants permission). */
  refreshLocation() {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        (this.currentLocation = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        }),
      () => {},
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 5 * 60 * 1000 },
    );
  }

  #initLocation() {
    if (typeof navigator !== "undefined" && navigator.permissions) {
      navigator.permissions
        .query({ name: "geolocation" })
        .then((s) => {
          this.#permissionStatus = s;
          this.locationPermission = s.state;
          if (s.state !== "denied") this.refreshLocation();
          s.addEventListener("change", () => {
            this.locationPermission = s.state as PermissionState;
            if (s.state !== "denied") this.refreshLocation();
          });
        })
        .catch(() => {
          this.locationPermission = "unsupported";
          this.refreshLocation();
        });
    } else {
      this.locationPermission = "unsupported";
      this.refreshLocation();
    }
  }

  #startPublic() {
    if (this.#publicStarted) return;
    this.#publicStarted = true;
    this.#publicUnsubs = [
      watchAllSessions((allSessions) => (this.allSessions = allSessions)),
      watchPlaces((places) => (this.places = places)),
    ];
  }

  #startUser(uid: string) {
    this.#userUnsubs = [
      watchUserSessions(uid, (mySessions) => (this.mySessions = mySessions)),
      watchUserGroups(uid, (groups) => (this.groups = groups)),
    ];
  }

  #stopUser() {
    this.#userUnsubs.forEach((u) => u());
    this.#userUnsubs = [];
    this.mySessions = [];
    this.groups = [];
  }

  #stop() {
    this.#rootCleanup?.();
    this.#rootCleanup = null;
    this.#stopUser();
    this.#publicUnsubs.forEach((u) => u());
    this.#publicUnsubs = [];
    this.#publicStarted = false;
  }
}

export const appStore = new AppStore();
