import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  X,
  Calendar,
  List as ListIcon,
  Map as MapIcon,
  MapPin,
} from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { useT } from "@/lib/i18n";
import { cn, formatDateTime } from "@/lib/utils";
import SwimMap from "@/components/SwimMap";
import SwimPhoto from "@/components/SwimPhoto";
import ReactionBar from "@/components/ReactionBar";
import type { PlaceDoc, SessionDoc, UserDoc } from "@/lib/types";

/**
 * Bottom-sheet showing one swimmer's swims with a map / list switcher. Used
 * both inside a group (over the group sheet) and from the "while you were
 * away" digest (over the popup), so the stacking is configurable via
 * `zBase`. `sessions` may be a superset — it's filtered to `member.uid`
 * internally — and the summary stats are derived from it.
 */
export default function MemberSwimsSheet({
  member,
  sessions,
  places,
  onClose,
  zBase = 1300,
}: {
  member: UserDoc;
  sessions: SessionDoc[];
  places: PlaceDoc[];
  onClose: () => void;
  /** Backdrop z-index; the sheet sits at zBase + 100. */
  zBase?: number;
}) {
  const t = useT();
  const { user } = useAuth();
  const [view, setView] = useState<"map" | "list">("map");
  // A place to reveal on the map (tapped from the list). The token re-fires
  // the focus even when the same place is tapped twice.
  const [focus, setFocus] = useState<{ id: string; token: number } | null>(
    null,
  );

  function showOnMap(placeId: string) {
    setFocus({ id: placeId, token: Date.now() });
    setView("map");
  }

  const memberSessions = useMemo(
    () => sessions.filter((s) => s.uid === member.uid),
    [sessions, member.uid],
  );
  // Only the places this member has actually swum at.
  const memberPlaces = useMemo(() => {
    const ids = new Set(memberSessions.map((s) => s.placeId));
    return places.filter((p) => ids.has(p.id));
  }, [memberSessions, places]);
  const sessionsByPlace = useMemo(() => {
    const m = new Map<string, SessionDoc[]>();
    for (const s of memberSessions) {
      const arr = m.get(s.placeId);
      if (arr) arr.push(s);
      else m.set(s.placeId, [s]);
    }
    return m;
  }, [memberSessions]);
  // Most-recent swim first for the list view.
  const memberSwims = useMemo(
    () => [...memberSessions].sort((a, b) => b.date - a.date),
    [memberSessions],
  );
  const stats = useMemo(() => {
    const spots = new Set<string>();
    let points = 0;
    for (const s of memberSessions) {
      spots.add(s.placeId);
      points += s.points;
    }
    return { points, swims: memberSessions.length, spots: spots.size };
  }, [memberSessions]);

  return (
    <>
      <motion.div
        key="m-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        style={{ zIndex: zBase }}
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
      />
      <motion.div
        key="m-sheet"
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", stiffness: 320, damping: 32 }}
        style={{ zIndex: zBase + 100, maxHeight: "90dvh" }}
        className="fixed inset-x-0 bottom-0 mx-auto flex max-w-md flex-col overflow-hidden rounded-t-3xl bg-white/95 shadow-2xl backdrop-blur-sm"
      >
        <div className="flex justify-center pt-3 pb-1">
          <div className="h-1 w-10 rounded-full bg-slate-300" />
        </div>
        <div className="flex items-center justify-between gap-3 px-5 pt-1 pb-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-wave-100 text-xl">
              {member.emoji ?? "🌊"}
            </div>
            <div className="min-w-0">
              <h3 className="truncate font-display text-lg font-black text-wave-900">
                {t("groups.member.swims_title", { name: member.displayName })}
              </h3>
              <p className="text-[11px] text-slate-500">
                {t("groups.member.summary", {
                  spots: stats.spots,
                  swims: stats.swims,
                  points: stats.points,
                })}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex-none rounded-full bg-slate-100 p-2 text-slate-500 hover:bg-slate-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {memberPlaces.length === 0 ? (
          <div className="px-3 pb-[max(env(safe-area-inset-bottom),1rem)]">
            <div className="flex h-[60dvh] items-center justify-center rounded-2xl bg-white/60 text-sm text-slate-500">
              {t("groups.member.no_swims")}
            </div>
          </div>
        ) : (
          <>
            {/* Map | List toggle — list makes it easy to react to each swim. */}
            <div className="flex justify-center px-3 pb-2">
              <div className="inline-flex rounded-full bg-slate-100 p-0.5 text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => {
                    setFocus(null);
                    setView("map");
                  }}
                  aria-pressed={view === "map"}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full px-3 py-1.5 transition-colors",
                    view === "map"
                      ? "bg-white text-wave-800 shadow-sm"
                      : "text-slate-500 hover:text-slate-700",
                  )}
                >
                  <MapIcon className="h-3.5 w-3.5" />
                  {t("groups.member.view.map")}
                </button>
                <button
                  type="button"
                  onClick={() => setView("list")}
                  aria-pressed={view === "list"}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full px-3 py-1.5 transition-colors",
                    view === "list"
                      ? "bg-white text-wave-800 shadow-sm"
                      : "text-slate-500 hover:text-slate-700",
                  )}
                >
                  <ListIcon className="h-3.5 w-3.5" />
                  {t("groups.member.view.list")}
                </button>
              </div>
            </div>

            <div className="px-3 pb-[max(env(safe-area-inset-bottom),1rem)]">
              {view === "map" ? (
                <div className="h-[60dvh] overflow-hidden rounded-2xl ring-1 ring-white/60">
                  <SwimMap
                    places={memberPlaces}
                    sessionsByPlace={sessionsByPlace}
                    fitBoundsToPlaces
                    linkToSpot
                    viewKey={`member-${member.uid}`}
                    skipInitialFit={!!focus}
                    focusPlaceId={focus?.id ?? null}
                    focusToken={focus?.token}
                  />
                </div>
              ) : (
                <ul className="h-[60dvh] space-y-2 overflow-y-auto pr-0.5">
                  {memberSwims.map((s, i) => (
                    <motion.li
                      key={s.id}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: Math.min(i, 8) * 0.03 }}
                      className="glass flex items-start gap-3 p-3"
                    >
                      {s.photoUrl ? (
                        <SwimPhoto
                          session={s}
                          className="h-14 w-14 flex-none rounded-lg"
                        />
                      ) : (
                        <div className="flex h-14 w-14 flex-none items-center justify-center rounded-lg bg-wave-100 text-2xl">
                          🌊
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        {/* Tap the place to reveal it on the map. */}
                        <button
                          type="button"
                          onClick={() => showOnMap(s.placeId)}
                          title={t("groups.member.show_on_map")}
                          className="block w-full text-left"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex min-w-0 items-center gap-1 font-semibold text-wave-900">
                              <span className="truncate">{s.placeName}</span>
                              <MapPin className="h-3 w-3 flex-none text-wave-500" />
                            </div>
                            <div className="flex-none font-display text-base font-black text-wave-700">
                              +{s.points}
                            </div>
                          </div>
                          <div className="mt-0.5 flex items-center gap-1 text-[11px] text-slate-500">
                            <Calendar className="h-3 w-3" />
                            {formatDateTime(s.date)}
                            {s.isWinter ? (
                              <span className="ml-1">❄️</span>
                            ) : null}
                            {s.isUniqueForUser ? (
                              <span className="ml-0.5">✨</span>
                            ) : null}
                          </div>
                        </button>
                        {s.note ? (
                          <p className="mt-0.5 line-clamp-2 text-xs text-slate-600">
                            {s.note}
                          </p>
                        ) : null}
                        <ReactionBar session={s} myUid={user?.uid} />
                      </div>
                    </motion.li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </motion.div>
    </>
  );
}
