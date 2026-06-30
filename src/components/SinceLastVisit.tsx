import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { motion, AnimatePresence, useDragControls } from "framer-motion";
import { X, Calendar } from "lucide-react";
import { useStore } from "@/store/sessions";
import { reactorUids, reactionAddedAt, touchLastSeen } from "@/lib/data";
import type { SessionDoc } from "@/lib/types";
import { useT } from "@/lib/i18n";
import { formatDateTime } from "@/lib/utils";
import Photo from "@/components/Photo";
import ReactionBar from "@/components/ReactionBar";

// How long to wait for Firestore snapshots to settle before computing the
// recap. The timer resets on every data change, so this is "quiet time"
// after the last update, not a hard delay.
const SETTLE_MS = 800;

// Window for the manually-opened "past month" recap.
const MONTH_MS = 30 * 86_400_000;

// Caps so a long absence can't produce an unwieldy sheet.
const MAX_FRIEND_SWIMS = 25;
const MAX_REACTION_ITEMS = 15;

// Imperative "open the recap now" trigger, mirroring the celebrate() pattern.
// Bumping the token makes the (always-mounted) sheet open a fresh month recap.
const useRecapTrigger = create<{ token: number; open: () => void }>((set) => ({
  token: 0,
  open: () => set((s) => ({ token: s.token + 1 })),
}));

/** Force the "past month" recap sheet open (e.g. from the map button). */
export function openRecap() {
  useRecapTrigger.getState().open();
}

type ReactionItem = { session: SessionDoc; delta: number };

type Activity = {
  // "visit" auto-pops what's new since the last visit; "month" is the
  // manually-opened recap of roughly the last 30 days.
  mode: "visit" | "month";
  friendSwims: SessionDoc[];
  reactionItems: ReactionItem[];
  newSwimCount: number;
  newReactionCount: number;
};

/** Reactions on `s` left by people other than the swimmer themselves, added
 *  after `since` (epoch ms). Reactions carry the timestamp they were added
 *  (see lib/data.toggleReaction), so "new since your last visit" is exact —
 *  legacy reactions with no timestamp (addedAt 0) are treated as already-seen. */
function newReactionCount(s: SessionDoc, myUid: string, since: number): number {
  const reactions = s.reactions ?? {};
  let n = 0;
  for (const emoji in reactions) {
    const entry = reactions[emoji];
    for (const uid of reactorUids(entry)) {
      if (uid === myUid) continue;
      if (reactionAddedAt(entry, uid) > since) n++;
    }
  }
  return n;
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
    .sort((a, b) => (b.createdAt ?? b.date) - (a.createdAt ?? a.date));

  // New reactions on any of my swims — an old swim can pick up a fresh
  // reaction, so we look at all my swims and count reactions added after
  // `since` (rather than limiting by swim date).
  const reactionItems: ReactionItem[] = [];
  for (const s of mySessions) {
    const delta = newReactionCount(s, myUid, since);
    if (delta > 0) reactionItems.push({ session: s, delta });
  }
  reactionItems.sort((a, b) => b.session.date - a.session.date);

  return {
    mode,
    newSwimCount: friendSwims.length,
    newReactionCount: reactionItems.reduce((n, r) => n + r.delta, 0),
    friendSwims: friendSwims.slice(0, MAX_FRIEND_SWIMS),
    reactionItems: reactionItems.slice(0, MAX_REACTION_ITEMS),
  };
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
  const profile = useStore((s) => s.profile);
  const allSessions = useStore((s) => s.allSessions);
  const mySessions = useStore((s) => s.mySessions);
  const groups = useStore((s) => s.groups);

  const recapToken = useRecapTrigger((s) => s.token);

  const [activity, setActivity] = useState<Activity | null>(null);
  const doneRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mirror of `activity` so the auto-pop timeout can avoid stomping a sheet the
  // user opened manually in the meantime.
  const openRef = useRef(false);
  openRef.current = activity !== null;

  // Reset when the signed-in user changes (incl. logout).
  useEffect(() => {
    doneRef.current = false;
    setActivity(null);
  }, [myUid]);

  // Once auth + data have settled, compute the since-last-visit recap exactly
  // once. The timer resets on each data change so we don't fire on a
  // half-loaded snapshot.
  useEffect(() => {
    if (!myUid || loading || !profile || doneRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (doneRef.current) return;
      doneRef.current = true;
      // Read the baseline straight from the user doc — this is still the
      // previous session's value because we haven't written the new one yet.
      const { profile: p } = useStore.getState();
      const since = p?.lastSeenAt ?? null;
      const result = computeActivity(myUid, "visit", since ?? 0);
      // Persist "seen up to now" regardless of whether we show anything — so a
      // first visit just establishes the baseline instead of dumping history.
      touchLastSeen(myUid, Date.now());
      if (
        !openRef.current &&
        since !== null &&
        (result.friendSwims.length > 0 || result.reactionItems.length > 0)
      )
        setActivity(result);
    }, SETTLE_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [myUid, loading, profile, allSessions, mySessions, groups]);

  // Manual open (map button): always show a "past month" recap, even if empty.
  useEffect(() => {
    if (recapToken === 0 || !myUid) return;
    const since = Date.now() - MONTH_MS;
    setActivity(computeActivity(myUid, "month", since));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recapToken]);

  return (
    <AnimatePresence>
      {activity ? (
        <Sheet
          activity={activity}
          myUid={myUid ?? ""}
          onClose={() => setActivity(null)}
        />
      ) : null}
    </AnimatePresence>
  );
}

function Sheet({
  activity,
  myUid,
  onClose,
}: {
  activity: Activity;
  myUid: string;
  onClose: () => void;
}) {
  const t = useT();
  const dragControls = useDragControls();

  const subtitleParts: string[] = [];
  if (activity.newSwimCount > 0)
    subtitleParts.push(
      activity.newSwimCount === 1
        ? t("sincevisit.sub.swims_one")
        : t("sincevisit.sub.swims_many", { n: activity.newSwimCount }),
    );
  if (activity.newReactionCount > 0)
    subtitleParts.push(
      activity.newReactionCount === 1
        ? t("sincevisit.sub.reactions_one")
        : t("sincevisit.sub.reactions_many", { n: activity.newReactionCount }),
    );

  return (
    <>
      <motion.div
        key="lv-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-[1100] bg-black/40 backdrop-blur-sm"
      />
      <motion.div
        key="lv-sheet"
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", stiffness: 320, damping: 32 }}
        drag="y"
        dragControls={dragControls}
        dragListener={false}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.4 }}
        onDragEnd={(_e, info) => {
          if (info.offset.y > 120 || info.velocity.y > 500) onClose();
        }}
        className="fixed inset-x-0 bottom-0 z-[1200] mx-auto flex max-w-md flex-col overflow-hidden rounded-t-3xl bg-white/95 shadow-2xl backdrop-blur-sm"
        style={{ maxHeight: "92dvh" }}
      >
        {/* Drag handle — grab here to dismiss; the list stays scrollable. */}
        <div
          onPointerDown={(e) => dragControls.start(e)}
          className="flex flex-none cursor-grab touch-none justify-center pt-4 pb-3 active:cursor-grabbing"
        >
          <div className="h-1 w-10 rounded-full bg-slate-300" />
        </div>

        {/* Header */}
        <div className="flex flex-none items-center justify-between gap-3 px-5 pt-1 pb-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-wave-100 text-2xl ring-1 ring-wave-200">
              {activity.mode === "month" ? "🗓️" : "👋"}
            </div>
            <div className="min-w-0">
              <h3 className="truncate font-display text-xl font-black text-wave-900">
                {activity.mode === "month"
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
          <button
            onClick={onClose}
            aria-label={t("common.close")}
            className="flex-none rounded-full bg-slate-100 p-2 text-slate-500 hover:bg-slate-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-[calc(max(env(safe-area-inset-bottom),0.5rem)+1.5rem)]">
          {activity.friendSwims.length === 0 &&
          activity.reactionItems.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
              <div className="text-4xl">🌊</div>
              <p className="text-sm text-slate-500">{t("sincevisit.empty")}</p>
            </div>
          ) : null}
          {activity.friendSwims.length > 0 ? (
            <section className="mb-4">
              <h4 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
                {t("sincevisit.friends_title")}
              </h4>
              <ul className="space-y-2">
                {activity.friendSwims.map((s, i) => (
                  <motion.li
                    key={s.id}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(i, 8) * 0.03 }}
                    className="glass flex items-start gap-3 p-3"
                  >
                    {s.photoUrl ? (
                      <Photo
                        src={s.photoUrl}
                        thumb={s.photoThumb}
                        className="h-14 w-14 flex-none rounded-lg"
                      />
                    ) : (
                      <div className="flex h-14 w-14 flex-none items-center justify-center rounded-lg bg-wave-100 text-2xl">
                        🌊
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-wave-900">
                            {s.displayName}
                          </div>
                          <div className="truncate text-[11px] text-slate-500">
                            {s.placeName}
                          </div>
                        </div>
                        <div className="flex-none font-display text-base font-black text-wave-700">
                          +{s.points}
                        </div>
                      </div>
                      <div className="mt-0.5 flex items-center gap-1 text-[11px] text-slate-500">
                        <Calendar className="h-3 w-3" />
                        {formatDateTime(s.date)}
                        {s.isWinter ? <span className="ml-1">❄️</span> : null}
                        {s.isUniqueForUser ? (
                          <span className="ml-0.5">✨</span>
                        ) : null}
                      </div>
                      {s.note ? (
                        <p className="mt-0.5 line-clamp-2 text-xs text-slate-600">
                          {s.note}
                        </p>
                      ) : null}
                      <ReactionBar session={s} myUid={myUid} />
                    </div>
                  </motion.li>
                ))}
              </ul>
            </section>
          ) : null}

          {activity.reactionItems.length > 0 ? (
            <section>
              <h4 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
                {t("sincevisit.reactions_title")}
              </h4>
              <ul className="space-y-2">
                {activity.reactionItems.map(({ session: s, delta }, i) => {
                  const reactions = s.reactions ?? {};
                  const emojis = Object.keys(reactions).filter(
                    (e) =>
                      reactorUids(reactions[e]).filter((uid) => uid !== myUid)
                        .length > 0,
                  );
                  return (
                    <motion.li
                      key={s.id}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: Math.min(i, 8) * 0.03 }}
                      className="glass flex items-center gap-3 p-3"
                    >
                      <div className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-amber-50 text-lg ring-1 ring-amber-200">
                        {emojis[0] ?? "💗"}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-wave-900">
                          {s.placeName}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-slate-500">
                          {emojis.map((e) => (
                            <span
                              key={e}
                              className="inline-flex items-center gap-0.5 rounded-full bg-white/70 px-1.5 py-0.5 ring-1 ring-slate-200"
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
                          <span className="text-slate-400">
                            · {formatDateTime(s.date)}
                          </span>
                        </div>
                      </div>
                      <div className="flex-none rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700">
                        +{delta}
                      </div>
                    </motion.li>
                  );
                })}
              </ul>
            </section>
          ) : null}
        </div>
      </motion.div>
    </>
  );
}
