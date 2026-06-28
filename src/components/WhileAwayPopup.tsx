import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { AnimatePresence, motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { MapPin, X } from "lucide-react";
import SwimPhoto from "@/components/SwimPhoto";
import { useStore } from "@/store/sessions";
import { useT } from "@/lib/i18n";
import {
  computeWhileAwayDigest,
  loadReactionBaseline,
  saveReactionBaseline,
  type AwayItem,
  type WhileAwayDigest,
} from "@/lib/digest";
import type { SessionDoc } from "@/lib/types";

// Give the session/group snapshots a beat to stream in after login before we
// look back. The digest only computes once per login regardless.
const DIGEST_DELAY_MS = 1500;

/**
 * Lets anywhere (e.g. the header "while you were away" button) re-open the
 * digest on demand. Each call bumps a counter the popup watches; manual
 * opens look back a full month rather than to the last visit.
 */
export const useWhileAwayLauncher = create<{
  requests: number;
  open: () => void;
}>((set) => ({
  requests: 0,
  open: () => set((s) => ({ requests: s.requests + 1 })),
}));

/**
 * "While you were away" — a welcome-back digest of new swims and reactions
 * since the user's previous visit. Shown once per login as a dismissible
 * card. Every row links straight to the swim on the map, and swims with a
 * photo open full-screen on tap, so it's a fast jump-off into the action.
 */
type View = { digest: WhileAwayDigest; manual: boolean };

export default function WhileAwayPopup() {
  const myUid = useStore((s) => s.myUid);
  const lastSeenResolved = useStore((s) => s.lastSeenResolved);
  const launchRequests = useWhileAwayLauncher((s) => s.requests);
  const [view, setView] = useState<View | null>(null);
  const processed = useRef<Set<string>>(new Set());
  const navigate = useNavigate();
  const t = useT();

  // Drop the popup (and let it recompute on next login) whenever the user
  // signs out or switches account.
  useEffect(() => {
    if (!myUid) setView(null);
  }, [myUid]);

  // Auto digest: once per login, a short beat after the data settles.
  useEffect(() => {
    if (!myUid || !lastSeenResolved) return;
    if (processed.current.has(myUid)) return;
    const uid = myUid;
    const timer = setTimeout(() => {
      if (processed.current.has(uid)) return;
      const st = useStore.getState();
      if (st.myUid !== uid) return; // switched user mid-wait
      processed.current.add(uid);
      const d = computeWhileAwayDigest({
        myUid: uid,
        since: st.lastSeenBaseline,
        mySessions: st.mySessions,
        allSessions: st.allSessions,
        groups: st.groups,
        reactionBaseline: loadReactionBaseline(uid),
        now: Date.now(),
      });
      // Mark the current reaction state as seen so the next visit diffs
      // from here, whether or not we showed anything this time.
      saveReactionBaseline(uid, st.mySessions);
      if (d) setView({ digest: d, manual: false });
    }, DIGEST_DELAY_MS);
    return () => clearTimeout(timer);
  }, [myUid, lastSeenResolved]);

  // Manual launch from the header — look back a full month, on demand. Skip
  // the very first render (requests === 0) so it doesn't auto-open.
  useEffect(() => {
    if (launchRequests === 0) return;
    const st = useStore.getState();
    if (!st.myUid) return;
    const d = computeWhileAwayDigest({
      myUid: st.myUid,
      since: st.lastSeenBaseline,
      mySessions: st.mySessions,
      allSessions: st.allSessions,
      groups: st.groups,
      reactionBaseline: loadReactionBaseline(st.myUid),
      now: Date.now(),
      manual: true,
    });
    if (d) setView({ digest: d, manual: true });
  }, [launchRequests]);

  function dismiss() {
    setView(null);
  }

  const digest = view?.digest ?? null;
  const manual = view?.manual ?? false;

  function openSwim(session: SessionDoc) {
    dismiss();
    navigate(`/spot/${session.placeId}?session=${session.id}`);
  }

  return (
    <AnimatePresence>
      {digest ? (
        <motion.div
          key="while-away"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={dismiss}
          className="fixed inset-0 z-[2500] flex items-end justify-center bg-black/30 backdrop-blur-[2px] sm:items-center"
        >
          <motion.div
            initial={{ y: 40, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 40, opacity: 0, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 300, damping: 26 }}
            onClick={(e) => e.stopPropagation()}
            className="mx-3 mb-3 flex max-h-[80dvh] w-full max-w-md flex-col overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-black/5 sm:mb-0"
          >
            <Header digest={digest} manual={manual} onClose={dismiss} />
            {digest.items.length === 0 ? (
              <div className="flex-1 px-6 py-10 text-center">
                <div className="text-4xl">🌊</div>
                <p className="mt-3 text-sm text-slate-500">
                  {t("whileaway.empty.body")}
                </p>
              </div>
            ) : (
              <ul className="flex-1 divide-y divide-slate-100 overflow-y-auto">
                {digest.items.map((item) => (
                  <DigestRow key={rowKey(item)} item={item} onOpen={openSwim} />
                ))}
              </ul>
            )}
            <div className="border-t border-slate-100 p-3">
              <button
                onClick={dismiss}
                className="w-full rounded-full bg-wave-600 py-2.5 text-sm font-semibold text-white shadow hover:bg-wave-700"
              >
                {t("whileaway.dismiss")}
              </button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function rowKey(item: AwayItem): string {
  return item.kind === "swims" ? `s-${item.uid}` : `r-${item.session.id}`;
}

function Header({
  digest,
  manual,
  onClose,
}: {
  digest: WhileAwayDigest;
  manual: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const parts: string[] = [];
  if (digest.totalSwims > 0)
    parts.push(
      digest.totalSwims === 1
        ? t("whileaway.summary.swims_one")
        : t("whileaway.summary.swims_many", { n: digest.totalSwims }),
    );
  if (digest.reactionCount > 0)
    parts.push(
      digest.reactionCount === 1
        ? t("whileaway.summary.reactions_one")
        : t("whileaway.summary.reactions_many", { n: digest.reactionCount }),
    );
  const fallback = manual
    ? t("whileaway.month.subtitle")
    : t("whileaway.subtitle");
  const subtitle = parts.length ? parts.join(" · ") : fallback;

  return (
    <div className="relative bg-gradient-to-br from-wave-500 to-wave-700 px-5 pt-5 pb-4 text-white">
      <button
        onClick={onClose}
        aria-label={t("common.close")}
        className="absolute top-3 right-3 flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25"
      >
        <X className="h-4 w-4" />
      </button>
      <div className="font-display text-xl font-black">
        {manual ? t("whileaway.month.title") : t("whileaway.title")}
      </div>
      <div className="mt-0.5 text-sm text-white/85">{subtitle}</div>
    </div>
  );
}

function DigestRow({
  item,
  onOpen,
}: {
  item: AwayItem;
  onOpen: (session: SessionDoc) => void;
}) {
  const t = useT();
  const session = item.kind === "swims" ? item.latest : item.session;

  let title: string;
  let detail: string;
  if (item.kind === "swims") {
    title =
      item.count === 1
        ? t("whileaway.swims_one", { name: item.name })
        : t("whileaway.swims_many", { name: item.name, n: item.count });
    detail = t("whileaway.at", { place: session.placeName });
  } else {
    title =
      item.newCount === 1
        ? t("whileaway.reactions_one")
        : t("whileaway.reactions_many", { n: item.newCount });
    detail = t("whileaway.at", { place: session.placeName });
  }

  return (
    <li className="flex items-center gap-3 px-4 py-3">
      {/* Thumbnail: photo (taps open full-screen) or an emoji medallion. */}
      <div className="h-14 w-14 shrink-0">
        {session.photoUrl ? (
          <SwimPhoto
            session={session}
            className="h-14 w-14 rounded-xl ring-1 ring-black/5"
          />
        ) : (
          <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-wave-100 text-2xl ring-1 ring-wave-200">
            {item.kind === "reactions" ? (item.emojis[0] ?? "💧") : "🌊"}
          </div>
        )}
      </div>

      {/* Text + the "view on map" jump-off (the whole block is tappable). */}
      <button
        onClick={() => onOpen(session)}
        className="flex min-w-0 flex-1 flex-col items-start text-left"
      >
        <span className="w-full truncate text-sm font-semibold text-wave-900">
          {title}
        </span>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
          <span className="truncate">{detail}</span>
          {item.kind === "swims" ? (
            <span className="shrink-0">
              · {timeAgo(item.latest.createdAt, Date.now(), t)}
            </span>
          ) : item.emojis.length ? (
            <span className="shrink-0">
              {item.emojis.slice(0, 3).join(" ")}
            </span>
          ) : null}
        </div>
        <span className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-wave-600">
          <MapPin className="h-3 w-3" />
          {t("whileaway.view_map")}
        </span>
      </button>
    </li>
  );
}

function timeAgo(
  ts: number,
  nowMs: number,
  t: (k: string, v?: Record<string, string | number>) => string,
): string {
  const diff = Math.max(0, nowMs - ts);
  const mins = Math.round(diff / 60000);
  if (mins < 60) return t("map.popup.age.mins", { n: Math.max(1, mins) });
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return t("map.popup.age.hrs", { n: hrs });
  const days = Math.round(hrs / 24);
  return t("map.popup.age.days", { n: Math.max(1, days) });
}
