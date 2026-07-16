import { useEffect, useMemo, useRef, useState } from "react";
import { useAllSessionsFeed, useStore } from "@/store/sessions";
import { reactorUids, reactionAddedAt, fetchUsers } from "@/lib/data";
import type { SessionDoc } from "@/lib/types";
import { useT } from "@/lib/i18n";
import Photo from "@/components/Photo";
import Lightbox from "@/components/Lightbox";
import BottomSheet from "@/components/BottomSheet";
import SpotSheet from "@/components/SpotSheet";
import ReactionBar from "@/components/ReactionBar";
import SwimListItem from "@/components/SwimListItem";
import EmojiAvatar from "@/components/EmojiAvatar";
import { useRecapTrigger } from "@/components/recapTrigger";

// How long to wait for Firestore snapshots to settle before computing the
// recap. The timer resets on every data change, so this is "quiet time"
// after the last update, not a hard delay.
const SETTLE_MS = 800;

// Window for the manually-opened "past month" recap.
const MONTH_MS = 30 * 86_400_000;

// Caps so a long absence can't produce an unwieldy sheet.
const MAX_FRIEND_SWIMS = 25;
const MAX_REACTION_ITEMS = 15;

// A single entry in the merged recap feed: either a friend's new swim or a
// batch of new reactions on one of my swims. `ts` is when the thing happened
// (swim creation / latest new reaction) so the feed can sort by recency.
type FeedItem =
  | { kind: "swim"; ts: number; session: SessionDoc }
  | { kind: "reaction"; ts: number; session: SessionDoc; delta: number };

type Activity = {
  // "visit" auto-pops what's new since the last visit; "month" is the
  // manually-opened recap of roughly the last 30 days.
  mode: "visit" | "month";
  items: FeedItem[];
  newSwimCount: number;
  newReactionCount: number;
};

/** Reactions on `s` left by people other than the swimmer themselves, added
 *  after `since` (epoch ms): the count and the latest such timestamp. Reactions
 *  carry the timestamp they were added (see lib/data.toggleReaction), so "new
 *  since your last visit" is exact — legacy reactions with no timestamp
 *  (addedAt 0) are treated as already-seen. */
function newReactions(
  s: SessionDoc,
  myUid: string,
  since: number,
): { count: number; latest: number } {
  const reactions = s.reactions ?? {};
  let count = 0;
  let latest = 0;
  for (const emoji in reactions) {
    const entry = reactions[emoji];
    for (const uid of reactorUids(entry)) {
      if (uid === myUid) continue;
      const at = reactionAddedAt(entry, uid);
      if (at > since) {
        count++;
        if (at > latest) latest = at;
      }
    }
  }
  return { count, latest };
}

function computeActivity(
  myUid: string,
  mode: "visit" | "month",
  since: number,
): Activity {
  const { allSessions, mySessions, groups } = useStore.getState();

  // Everyone I share a group with (minus me).
  const friendUids = new Set<string>();
  for (const g of groups)
    for (const m of g.members) if (m !== myUid) friendUids.add(m);

  const friendSwims = allSessions
    .filter((s) => friendUids.has(s.uid) && (s.createdAt ?? s.date) > since)
    .toSorted((a, b) => (b.createdAt ?? b.date) - (a.createdAt ?? a.date));

  // New reactions on any of my swims — an old swim can pick up a fresh
  // reaction, so we look at all my swims and count reactions added after
  // `since` (rather than limiting by swim date).
  const reactionItems: { session: SessionDoc; delta: number; ts: number }[] =
    [];
  for (const s of mySessions) {
    const { count, latest } = newReactions(s, myUid, since);
    if (count > 0) reactionItems.push({ session: s, delta: count, ts: latest });
  }

  // Merge swims and reaction batches into one feed, newest first. Each side is
  // capped first so a long absence can't blow up either category.
  const items: FeedItem[] = [
    ...friendSwims.slice(0, MAX_FRIEND_SWIMS).map((s): FeedItem => ({
      kind: "swim",
      ts: s.createdAt ?? s.date,
      session: s,
    })),
    ...reactionItems
      .toSorted((a, b) => b.ts - a.ts)
      .slice(0, MAX_REACTION_ITEMS)
      .map((r): FeedItem => ({
        kind: "reaction",
        ts: r.ts,
        session: r.session,
        delta: r.delta,
      })),
  ].toSorted((a, b) => b.ts - a.ts);

  return {
    mode,
    items,
    newSwimCount: friendSwims.length,
    newReactionCount: reactionItems.reduce((n, r) => n + r.delta, 0),
  };
}

/**
 * Decide what the recap sheet should show for a given mode, reading the
 * current user + profile straight from the store so callers never capture a
 * stale value. Returns null when nothing should appear.
 *
 *  - "visit"  the auto-pop. Shows only when there's a real previous baseline
 *             (not a first-ever visit) AND something happened since then.
 *  - "month"  the manually-opened recap. Always returns an Activity (possibly
 *             empty), since the user explicitly asked to see it.
 */
function recapToShow(mode: "visit" | "month"): Activity | null {
  const { myUid, lastSeenBaseline } = useStore.getState();
  if (!myUid) return null;
  if (mode === "month") {
    return computeActivity(myUid, "month", Date.now() - MONTH_MS);
  }
  // First-ever visit: no baseline yet, so just establish one (show nothing).
  // Read the baseline captured at login (before it gets re-stamped to "now"),
  // not profile.lastSeenAt directly — that field is overwritten with "now" by
  // the in-flight touchLastSeen() write, often before this even runs, which
  // would silently erase the "since last visit" window.
  if (lastSeenBaseline === null) return null;
  const result = computeActivity(myUid, "visit", lastSeenBaseline);
  return result.items.length > 0 ? result : null;
}

/**
 * Bottom sheet that recaps what happened while the user was away: new swims
 * from their group friends (with inline reactions) and any new reactions left
 * on their own swims. Shown once per app open when there's something new, and
 * dismissable by swiping down — same pattern as the group/member sheets.
 *
 * The "last visit" timestamp (and a reaction-count snapshot taken at that
 * time) live on the user doc, so the recap is consistent across the user's
 * devices rather than reset per browser.
 */
export default function SinceLastVisit() {
  const myUid = useStore((s) => s.myUid);
  const loading = useStore((s) => s.loading);
  const lastSeenResolved = useStore((s) => s.lastSeenResolved);
  const lastSeenBaseline = useStore((s) => s.lastSeenBaseline);
  const allSessions = useStore((s) => s.allSessions);
  const allSessionsReady = useStore((s) => s.allSessionsReady);
  const mySessions = useStore((s) => s.mySessions);
  const groups = useStore((s) => s.groups);

  const recapToken = useRecapTrigger((s) => s.token);

  const [activity, setActivity] = useState<Activity | null>(null);
  // Which manual-recap token we've already acted on. State (not a ref) because
  // `monthPending` — derived from it — is a render input that gates the feed
  // acquisition and the effect below.
  const [handledRecapToken, setHandledRecapToken] = useState(0);
  const monthPending = recapToken !== 0 && recapToken !== handledRecapToken;
  const doneRef = useRef(false);
  // State mirror of doneRef, so the feed acquisition below can react to it.
  const [digestDone, setDigestDone] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mirror of `activity` so the auto-pop timeout can avoid stomping a sheet the
  // user opened manually in the meantime.
  const openRef = useRef(false);
  // Written after commit (not during render); only read later from the
  // auto-pop timeout, so effect timing is fine.
  useEffect(() => {
    openRef.current = activity !== null;
  }, [activity]);

  // Friend swims come from the community feed (reactions live on my own
  // sessions), so the feed is only needed when the user shares a group with
  // someone — and only until the digest has been decided, plus while the
  // sheet is open so reaction counts on friend swims stay live. First-ever
  // visits (no baseline) never show a digest, so they skip the feed too.
  const feedNeeded = groups.length > 0;
  useAllSessionsFeed(
    !!myUid &&
      feedNeeded &&
      ((!digestDone && lastSeenResolved && lastSeenBaseline !== null) ||
        monthPending ||
        activity !== null),
  );
  const feedReady = !feedNeeded || allSessionsReady;

  // Reset when the signed-in user changes (incl. logout).
  useEffect(() => {
    doneRef.current = false;
    setDigestDone(false);
    setActivity(null);
  }, [myUid]);

  // Once auth + data have settled, decide the since-last-visit recap exactly
  // once. The timer resets on each data change so we don't fire on a
  // half-loaded snapshot. `recapToShow` owns the "what to show" decision; here
  // we just trigger it after the data goes quiet.
  useEffect(() => {
    if (!myUid || loading || !lastSeenResolved || !feedReady || doneRef.current)
      return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (doneRef.current) return;
      doneRef.current = true;
      setDigestDone(true);
      const result = recapToShow("visit");
      if (!openRef.current && result) setActivity(result);
    }, SETTLE_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [
    myUid,
    loading,
    lastSeenResolved,
    feedReady,
    allSessions,
    mySessions,
    groups,
  ]);

  // Manual open (map button): run the same helper again for a "past month"
  // recap, which always shows (even when empty) since the user asked for it.
  // Computed only once the feed is live (the acquisition above starts it),
  // so the recap isn't built from an empty snapshot.
  useEffect(() => {
    if (!monthPending || !feedReady) return;
    // Two independent updates (neither reads the other's result); React batches
    // them into a single render, so this isn't a costly update chain.
    setHandledRecapToken(recapToken);
    // react-doctor-disable-next-line react-doctor/no-chain-state-updates
    setActivity(recapToShow("month"));
  }, [monthPending, feedReady, recapToken]);

  return (
    <Sheet
      activity={activity}
      myUid={myUid ?? ""}
      onClose={() => setActivity(null)}
    />
  );
}

function Sheet({
  activity,
  myUid,
  onClose,
}: {
  activity: Activity | null;
  myUid: string;
  onClose: () => void;
}) {
  const t = useT();

  // Keep the last activity around so the sheet still has content to render
  // while it animates closed (`open` flips to false before the sheet unmounts).
  // Held in state (not a ref) because it feeds render; updated during render via
  // React's "storing info from previous renders" pattern so the compiler can
  // track it without a ref being read mid-render.
  const [shown, setShown] = useState<Activity | null>(activity);
  if (activity && activity !== shown) setShown(activity);

  // The recap list is frozen when the sheet opens, but reaction state should
  // stay live: reacting writes to Firestore, which updates the store, and we
  // re-read each session by id so counts reflect immediately. Without this the
  // sheet would keep rendering the stale snapshot captured at open time.
  const allSessions = useStore((s) => s.allSessions);
  const mySessions = useStore((s) => s.mySessions);
  const liveById = useMemo(() => {
    const m = new Map<string, SessionDoc>();
    for (const s of allSessions) m.set(s.id, s);
    for (const s of mySessions) m.set(s.id, s);
    return m;
  }, [allSessions, mySessions]);

  // Resolve reactor UIDs to display names. Sessions carry their author's name,
  // so the union of sessions is a free directory — but a reactor may not have
  // logged a swim this year, so we also fetch the user docs of any reactor we
  // can't name from sessions alone.
  const sessionNames = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of allSessions) m.set(s.uid, s.displayName);
    for (const s of mySessions) m.set(s.uid, s.displayName);
    return m;
  }, [allSessions, mySessions]);

  // Every distinct reactor UID (other than me) referenced by the reaction
  // feed items — the people whose names we need to show.
  const reactorUidList = useMemo(() => {
    const set = new Set<string>();
    for (const item of shown?.items ?? []) {
      if (item.kind !== "reaction") continue;
      const reactions = item.session.reactions ?? {};
      for (const emoji in reactions)
        for (const uid of reactorUids(reactions[emoji]))
          if (uid !== myUid) set.add(uid);
    }
    return [...set];
  }, [shown?.items, myUid]);

  // Names fetched from user docs for reactors not covered by `sessionNames`.
  const [fetchedNames, setFetchedNames] = useState<Map<string, string>>(
    () => new Map(),
  );
  useEffect(() => {
    const missing = reactorUidList.filter((uid) => !sessionNames.has(uid));
    if (missing.length === 0) return;
    let cancelled = false;
    fetchUsers(missing)
      .then((users) => {
        if (cancelled) return;
        setFetchedNames((prev) => {
          const next = new Map(prev);
          for (const u of users) next.set(u.uid, u.displayName);
          return next;
        });
        return;
      })
      // Names are best-effort — unresolved reactors just fall back to
      // "someone", so a failed lookup shouldn't surface as an error.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [reactorUidList, sessionNames]);

  const nameByUid = useMemo(() => {
    const m = new Map(fetchedNames);
    for (const [uid, name] of sessionNames) m.set(uid, name);
    return m;
  }, [sessionNames, fetchedNames]);

  // Photo opened full-screen in the lightbox (tapping a card's image).
  const [lightboxFor, setLightboxFor] = useState<SessionDoc | null>(null);

  // Place opened in a bottom sheet (tapping a card's place name).
  const [spotFor, setSpotFor] = useState<string | null>(null);

  const subtitleParts: string[] = [];
  if (shown && shown.newSwimCount > 0)
    subtitleParts.push(
      shown.newSwimCount === 1
        ? t("sincevisit.sub.swims_one")
        : t("sincevisit.sub.swims_many", { n: shown.newSwimCount }),
    );
  if (shown && shown.newReactionCount > 0)
    subtitleParts.push(
      shown.newReactionCount === 1
        ? t("sincevisit.sub.reactions_one")
        : t("sincevisit.sub.reactions_many", { n: shown.newReactionCount }),
    );

  const header = shown ? (
    <div className="flex min-w-0 items-center gap-3">
      <EmojiAvatar
        emoji={shown.mode === "month" ? "🗓️" : "👋"}
        size="lg"
        ring
      />
      <div className="min-w-0">
        <h3 className="truncate font-display text-xl font-black text-wave-900">
          {shown.mode === "month"
            ? t("sincevisit.month.title")
            : t("sincevisit.title")}
        </h3>
        {subtitleParts.length > 0 ? (
          <p className="truncate text-[11px] text-slate-500">
            {subtitleParts.join(" · ")}
          </p>
        ) : null}
      </div>
    </div>
  ) : null;

  return (
    <>
      <BottomSheet
        open={!!activity}
        onClose={onClose}
        size="large"
        title={header}
      >
        <div className="px-4 pb-[calc(max(env(safe-area-inset-bottom),0.5rem)+1.5rem)]">
          {!shown || shown.items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
              <div className="text-4xl">🌊</div>
              <p className="text-sm text-slate-500">{t("sincevisit.empty")}</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {shown.items.map((item, i) => {
                const s = liveById.get(item.session.id) ?? item.session;
                if (item.kind === "swim") {
                  return (
                    <SwimListItem
                      key={`swim-${s.id}`}
                      index={i}
                      seed={s.id}
                      thumb={
                        s.photoUrl ? (
                          <button
                            type="button"
                            onClick={() => setLightboxFor(s)}
                            className="flex-none"
                            aria-label={t("common.open")}
                          >
                            <Photo
                              src={s.photoUrl}
                              thumb={s.photoThumb}
                              className="h-14 w-14 flex-none rounded-lg ring-1 ring-wave-200 ring-inset"
                            />
                          </button>
                        ) : undefined
                      }
                      title={
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-wave-900">
                            {s.displayName}
                          </div>
                          <button
                            type="button"
                            onClick={() => setSpotFor(s.placeId)}
                            className="block max-w-full truncate text-left text-[11px] text-slate-500 hover:text-wave-700 hover:underline"
                          >
                            {s.placeName}
                          </button>
                        </div>
                      }
                      points={s.points}
                      date={s.date}
                      winter={s.isWinter}
                      unique={s.isUniqueForUser}
                      note={s.note}
                    >
                      <ReactionBar session={s} myUid={myUid} />
                    </SwimListItem>
                  );
                }

                const reactions = s.reactions ?? {};
                const emojis = Object.keys(reactions).filter(
                  (e) =>
                    reactorUids(reactions[e]).filter((uid) => uid !== myUid)
                      .length > 0,
                );
                // Distinct people (other than me) who reacted on this swim,
                // resolved to display names where we know them.
                const reactorNames = [
                  ...new Set(
                    emojis.flatMap((e) =>
                      reactorUids(reactions[e]).filter((uid) => uid !== myUid),
                    ),
                  ),
                ].map((uid) => nameByUid.get(uid) ?? t("common.someone"));
                return (
                  <SwimListItem
                    key={`reaction-${s.id}`}
                    index={i}
                    thumb={
                      s.photoUrl ? (
                        <button
                          type="button"
                          onClick={() => setLightboxFor(s)}
                          className="flex h-14 w-14 flex-none items-center justify-center rounded-lg bg-amber-50 text-2xl ring-1 ring-amber-200"
                          aria-label={t("common.open")}
                        >
                          {emojis[0] ?? "💗"}
                        </button>
                      ) : (
                        <div className="flex h-14 w-14 flex-none items-center justify-center rounded-lg bg-amber-50 text-2xl ring-1 ring-amber-200">
                          {emojis[0] ?? "💗"}
                        </div>
                      )
                    }
                    title={
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-wave-900">
                          {t("sincevisit.reacted", {
                            name: reactorNames.join(", "),
                          })}
                        </div>
                        <button
                          type="button"
                          onClick={() => setSpotFor(s.placeId)}
                          className="block max-w-full truncate text-left text-[11px] text-slate-500 hover:text-wave-700 hover:underline"
                        >
                          {s.placeName}
                        </button>
                      </div>
                    }
                    aside={
                      <div className="flex-none rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700">
                        +{item.delta}
                      </div>
                    }
                    date={s.date}
                  >
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      {emojis.map((e) => (
                        <span
                          key={e}
                          className="inline-flex items-center gap-0.5 rounded-full bg-white/70 px-1.5 py-0.5 text-[11px] text-slate-500 ring-1 ring-slate-200"
                        >
                          {e}
                          <span className="tabular-nums">
                            {
                              reactorUids(reactions[e]).filter(
                                (u) => u !== myUid,
                              ).length
                            }
                          </span>
                        </span>
                      ))}
                    </div>
                  </SwimListItem>
                );
              })}
            </ul>
          )}
        </div>
      </BottomSheet>

      <Lightbox session={lightboxFor} onClose={() => setLightboxFor(null)} />

      <SpotSheet placeId={spotFor} onClose={() => setSpotFor(null)} />
    </>
  );
}
