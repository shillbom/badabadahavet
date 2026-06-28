import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { AnimatePresence, motion } from "framer-motion";
import { Waves, X } from "lucide-react";
import SwimPhoto from "@/components/SwimPhoto";
import MemberSwimsSheet from "@/components/MemberSwimsSheet";
import { useStore } from "@/store/sessions";
import { fetchUsers, watchMemberSessions } from "@/lib/data";
import { useT } from "@/lib/i18n";
import {
  computeWhileAwayDigest,
  loadReactionBaseline,
  saveReactionBaseline,
  type AwayItem,
  type WhileAwayDigest,
} from "@/lib/digest";
import type { SessionDoc, UserDoc } from "@/lib/types";

// The friend's-swims sheet must stack above the popup (z-2500); its backdrop
// sits here and the sheet at +100. The Lightbox (z-3500) stays above both.
const MEMBER_SHEET_Z = 2600;

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
 * card. Tapping a row opens that swimmer's swims (map / list switcher)
 * layered over the popup — without navigating away — and photos open
 * full-screen on top of everything. Closing the sheet returns to the digest.
 */
type View = { digest: WhileAwayDigest; manual: boolean };

export default function WhileAwayPopup() {
  const myUid = useStore((s) => s.myUid);
  const lastSeenResolved = useStore((s) => s.lastSeenResolved);
  const launchRequests = useWhileAwayLauncher((s) => s.requests);
  const places = useStore((s) => s.places);
  const [view, setView] = useState<View | null>(null);
  // The swimmer whose swims are open over the popup (map / list switcher).
  const [member, setMember] = useState<UserDoc | null>(null);
  const [memberSessions, setMemberSessions] = useState<SessionDoc[]>([]);
  const processed = useRef<Set<string>>(new Set());
  const t = useT();

  // Drop everything (and let it recompute on next login) whenever the user
  // signs out or switches account.
  useEffect(() => {
    if (!myUid) {
      setView(null);
      setMember(null);
    }
  }, [myUid]);

  // Stream the selected swimmer's full (all-time) swims for the sheet.
  useEffect(() => {
    if (!member) {
      setMemberSessions([]);
      return;
    }
    return watchMemberSessions([member.uid], setMemberSessions);
  }, [member]);

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

  // Open a swimmer's swims over the popup (without leaving it). For a swim
  // item that's the friend; for a reaction on your own swim, that's you.
  function openItem(item: AwayItem) {
    const uid = item.kind === "swims" ? item.uid : myUid;
    const name = item.kind === "swims" ? item.name : "";
    if (!uid) return;
    const me = useStore.getState().profile;
    if (item.kind === "reactions" && me) {
      setMember(me);
      return;
    }
    // Show immediately with a minimal profile, then enrich with the real
    // user doc (for the avatar emoji) once it loads.
    setMember({ uid, displayName: name, createdAt: 0 });
    void fetchUsers([uid]).then(([u]) => {
      if (u) setMember((prev) => (prev && prev.uid === uid ? u : prev));
    });
  }

  return (
    <>
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
                    <DigestRow
                      key={rowKey(item)}
                      item={item}
                      onOpen={openItem}
                    />
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

      {/* A friend's (or your own) swims, layered above the popup. Closing it
          returns to the still-open digest. */}
      <AnimatePresence>
        {member ? (
          <MemberSwimsSheet
            member={member}
            sessions={memberSessions}
            places={places}
            zBase={MEMBER_SHEET_Z}
            onClose={() => setMember(null)}
          />
        ) : null}
      </AnimatePresence>
    </>
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
  onOpen: (item: AwayItem) => void;
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

      {/* Text + the "view swims" jump-off (the whole block is tappable). */}
      <button
        onClick={() => onOpen(item)}
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
          <Waves className="h-3 w-3" />
          {t("whileaway.view_swims")}
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
