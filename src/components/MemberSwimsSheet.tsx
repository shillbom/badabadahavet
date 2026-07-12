import { useEffect, useMemo, useRef, useState } from "react";
import { List as ListIcon, Map as MapIcon, MapPin } from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { useT } from "@/lib/i18n";
import SwimMap from "@/components/SwimMap";
import SwimPhoto from "@/components/SwimPhoto";
import ReactionBar from "@/components/ReactionBar";
import SwimListItem from "@/components/SwimListItem";
import BottomSheet from "@/components/BottomSheet";
import SegmentedControl from "@/components/ui/SegmentedControl";
import EmojiAvatar from "@/components/EmojiAvatar";
import type { PlaceWithTemp, SessionDoc, UserDoc } from "@/lib/types";

/**
 * Bottom-sheet showing one swimmer's swims with a map / list switcher.
 * Stacks above the group sheet, so the z-order is configurable via `zBase`.
 * `sessions` may be a superset — it's filtered to `member.uid` internally —
 * and the summary stats are derived from it.
 *
 * Keep this mounted and pass `member: null` to close: the last member is
 * retained so the slide-down animation still has content to show.
 */
export default function MemberSwimsSheet({
  member,
  sessions,
  places,
  onClose,
  zBase = 1300,
}: {
  member: UserDoc | null;
  sessions: SessionDoc[];
  places: PlaceWithTemp[];
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

  // Keep the closing frame populated while the sheet slides away.
  const lastMemberRef = useRef<UserDoc | null>(null);
  if (member) lastMemberRef.current = member;
  const shown = member ?? lastMemberRef.current;

  // Fresh member → start over on the map view without a stale focus.
  useEffect(() => {
    if (!member) return;
    setView("map");
    setFocus(null);
  }, [member?.uid]); // eslint-disable-line react-hooks/exhaustive-deps

  function showOnMap(placeId: string) {
    setFocus({ id: placeId, token: Date.now() });
    setView("map");
  }

  const memberSessions = useMemo(
    () => (shown ? sessions.filter((s) => s.uid === shown.uid) : []),
    [sessions, shown],
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

  const title = shown ? (
    <div className="flex min-w-0 items-center gap-3">
      <EmojiAvatar emoji={shown.emoji} />
      <div className="min-w-0">
        <h3 className="truncate font-display text-lg font-black text-wave-900">
          {t("groups.member.swims_title", { name: shown.displayName })}
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
  ) : null;

  return (
    <BottomSheet open={!!member} onClose={onClose} zBase={zBase} title={title}>
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
            <SegmentedControl
              size="sm"
              value={view}
              onChange={(next) => {
                if (next === "map") setFocus(null);
                setView(next);
              }}
              options={[
                {
                  value: "map",
                  label: (
                    <>
                      <MapIcon className="h-3.5 w-3.5" />
                      {t("groups.member.view.map")}
                    </>
                  ),
                },
                {
                  value: "list",
                  label: (
                    <>
                      <ListIcon className="h-3.5 w-3.5" />
                      {t("groups.member.view.list")}
                    </>
                  ),
                },
              ]}
            />
          </div>

          <div className="px-3 pb-[max(env(safe-area-inset-bottom),1rem)]">
            {view === "map" ? (
              <div className="h-[60dvh] overflow-hidden rounded-2xl ring-1 ring-white/60">
                <SwimMap
                  places={memberPlaces}
                  sessionsByPlace={sessionsByPlace}
                  fitBoundsToPlaces
                  linkToSpot
                  viewKey={`member-${shown?.uid}`}
                  skipInitialFit={!!focus}
                  focusPlaceId={focus?.id ?? null}
                  focusToken={focus?.token}
                />
              </div>
            ) : (
              <ul className="h-[60dvh] space-y-2 overflow-y-auto pr-0.5">
                {memberSwims.map((s, i) => (
                  <SwimListItem
                    key={s.id}
                    index={i}
                    thumb={
                      s.photoUrl ? (
                        <SwimPhoto
                          session={s}
                          className="h-14 w-14 flex-none rounded-lg"
                        />
                      ) : undefined
                    }
                    title={
                      /* Tap the place to reveal it on the map. */
                      <button
                        type="button"
                        onClick={() => showOnMap(s.placeId)}
                        title={t("groups.member.show_on_map")}
                        className="flex w-full min-w-0 items-center gap-1 text-left font-semibold text-wave-900"
                      >
                        <span className="truncate">{s.placeName}</span>
                        <MapPin className="h-3 w-3 flex-none text-wave-500" />
                      </button>
                    }
                    points={s.points}
                    date={s.date}
                    winter={s.isWinter}
                    unique={s.isUniqueForUser}
                    note={s.note}
                  >
                    <ReactionBar session={s} myUid={user?.uid} />
                  </SwimListItem>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </BottomSheet>
  );
}
