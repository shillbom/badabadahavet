import { useEffect, useRef, useState } from "react";
import { m, useInView } from "framer-motion";
import {
  ChevronLeft,
  ChevronRight,
  Crown,
  Snowflake,
  MapPin,
  CalendarRange,
} from "lucide-react";
import { useStore } from "@/store/sessions";
import { useAuth } from "@/auth/AuthContext";
import SegmentedControl from "@/components/ui/SegmentedControl";
import type {
  GroupDoc,
  SessionDoc,
  UserDoc,
  YearStats,
  LeaderboardEntry,
} from "@/lib/types";
import {
  fetchLatestSwimAt,
  fetchUsers,
  watchGlobalLeaderboard,
  watchMemberSessions,
  watchMemberSessionsRange,
  watchUsersByYearScore,
} from "@/lib/data";
import {
  aggregateMemberStats,
  compareMemberStats,
  splitTopList,
  yearPickerBounds,
  type MemberSortBy,
} from "@/lib/leaderboard";
import { groupRangeMs, formatGroupRange } from "@/lib/date";
import { resolveBorder, type Border } from "@/lib/borders";
import { useT, useLocale, localeBcp } from "@/lib/i18n";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import MemberSwimsSheet from "@/components/MemberSwimsSheet";
import { cn } from "@/lib/utils";

type Row = {
  uid: string;
  displayName: string;
  points: number;
  border: Border;
  /** Server-maintained card stats; null for users logged before the
   *  statsByYear backfill ran (renders as a placeholder). */
  stats: YearStats | null;
};

export default function LeaderboardPage() {
  const groups = useStore((s) => s.groups);
  const { user } = useAuth();

  const t = useT();
  const locale = useLocale((s) => s.locale);

  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [sortBy, setSortBy] = useState<MemberSortBy>("points");

  const {
    scope,
    setScope,
    effectiveScope,
    orderedGroups,
    groupRecencyReady,
    toggleGlobal,
  } = useGroupScope(user, groups);

  const isGroupScope = effectiveScope !== "global";
  const activeGroup = isGroupScope
    ? (groups.find((g) => g.id === effectiveScope) ?? null)
    : null;
  // A group with a competition window scores by its date range instead of the
  // calendar year, so the year picker is hidden and the dates shown instead.
  const isTimespan = !!(
    activeGroup &&
    (activeGroup.startDate != null || activeGroup.endDate != null)
  );
  const rangeLabel =
    activeGroup && isTimespan
      ? formatGroupRange(activeGroup, localeBcp(locale), {
          openStart: t("groups.timespan.open_start_label"),
          openEnd: t("groups.timespan.open_end_label"),
        })
      : null;

  // The global board reads precomputed yearly scores from the roster; group
  // boards compute points from member sessions so they can be sorted by
  // recency/streak and sliced to a competition window. Both hooks run (hooks
  // can't be conditional); only the active scope's result is rendered.
  const globalData = useLeaderboardRows(user, year, groups, effectiveScope);
  const groupData = useGroupBoardRows(user, activeGroup, year, sortBy);

  const rows = isGroupScope ? groupData.rows : globalData.rows;
  const visibleRoster = isGroupScope
    ? groupData.roster
    : globalData.visibleRoster;
  const dataReady = isGroupScope ? groupData.ready : globalData.dataReady;

  // A sign-out leaves the last subscription value in state briefly, but it
  // must never be rendered to a guest. Group boards also wait for the
  // recency lookup so the default scope doesn't flip under the user.
  const showingGhost = user
    ? !dataReady || (groups.length > 0 && scope === null && !groupRecencyReady)
    : !dataReady;

  // The global board only shows the podium (top 5) plus your own row with
  // its true rank when you're further down. Group boards are small and
  // personal, so they stay complete.
  const TOP_N = 5;
  const { top, me } = isGroupScope
    ? { top: rows, me: null }
    : splitTopList(rows, user?.uid, TOP_N);

  // Group rows open the same member-swims sheet as the group view. The
  // sessions are subscribed per clicked member — a single-uid query bounded
  // to the active scope's range — instead of preloading the whole scope.
  const places = useStore((s) => s.placesWithTemps);
  const [memberSelection, setMemberSelection] = useState<{
    member: UserDoc | null;
    key: number;
  }>({ member: null, key: 0 });
  const selectedMember = memberSelection.member;
  const [memberSessions, setMemberSessions] = useState<SessionDoc[]>([]);
  const selectedUid = selectedMember?.uid;
  const memberRange =
    isTimespan && activeGroup ? groupRangeMs(activeGroup) : null;
  const rangeStart = memberRange?.startMs;
  const rangeEnd = memberRange?.endExclusiveMs;
  useEffect(() => {
    if (!selectedUid) return;
    if (rangeStart != null && rangeEnd != null)
      return watchMemberSessionsRange(
        [selectedUid],
        rangeStart,
        rangeEnd,
        setMemberSessions,
      );
    return watchMemberSessions([selectedUid], setMemberSessions, year);
  }, [selectedUid, year, rangeStart, rangeEnd]);

  return (
    <div className="px-4 pt-2">
      <div className="mb-3 flex items-end justify-between gap-2">
        <h2 className="font-display text-2xl font-black text-wave-900">
          {t("leaderboard.title")}
        </h2>
        <div className="flex flex-none items-center gap-2">
          <button
            type="button"
            onClick={toggleGlobal}
            data-active={effectiveScope === "global"}
            aria-pressed={effectiveScope === "global"}
            aria-label={t("leaderboard.global_toggle")}
            title={t("leaderboard.global_toggle")}
            className="chip data-[active=true]:bg-wave-600 data-[active=true]:text-white data-[active=true]:ring-wave-700"
          >
            <span className="text-sm">🌍</span>
            {t("leaderboard.scope.global")}
          </button>
          {isTimespan ? (
            <span
              className="chip cursor-default gap-1 whitespace-nowrap"
              title={rangeLabel ?? undefined}
            >
              <CalendarRange className="h-3.5 w-3.5" />
              {rangeLabel}
            </span>
          ) : (
            <YearPicker
              year={year}
              {...yearPickerBounds(year, currentYear)}
              onChange={setYear}
            />
          )}
        </div>
      </div>

      {groups.length > 0 ? (
        <div className="no-scrollbar -mx-4 mb-3 flex gap-2 overflow-x-auto px-4 py-1">
          {orderedGroups.map((g) => (
            <ScopeChip
              key={g.id}
              label={`${g.emoji ?? "👥"} ${g.name}`}
              active={effectiveScope === g.id}
              onClick={() => setScope(g.id)}
            />
          ))}
        </div>
      ) : null}

      {isGroupScope ? (
        <SegmentedControl
          className="mb-3 flex"
          size="sm"
          grow
          value={sortBy}
          onChange={setSortBy}
          options={[
            { value: "points", label: t("groups.sort.points") },
            { value: "recent", label: t("groups.sort.recent") },
            { value: "streak", label: t("groups.sort.streak") },
          ]}
        />
      ) : null}

      <ol className="mb-4 space-y-2">
        {showingGhost ? (
          <>
            <LeaderboardGhostRow />
            <LeaderboardGhostRow />
            <LeaderboardGhostRow />
          </>
        ) : (
          <>
            {top.map((r, i) => (
              <BoardRow
                key={r.uid}
                row={r}
                rank={i}
                isMe={user?.uid === r.uid}
                onSelect={() => {
                  setMemberSessions([]);
                  setMemberSelection((current) => ({
                    member: visibleRoster.find((u) => u.uid === r.uid) ?? null,
                    key: current.key + 1,
                  }));
                }}
              />
            ))}
            {me ? (
              <>
                <li
                  aria-hidden
                  className="py-0.5 text-center text-sm leading-none tracking-[0.4em] text-slate-400 select-none"
                >
                  •••
                </li>
                <BoardRow row={me.row} rank={me.rank} isMe />
              </>
            ) : null}
            {rows.length === 0 ? (
              <m.li
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-2xl bg-white/60 p-6 text-center text-sm text-slate-500"
              >
                {t("leaderboard.empty")}
              </m.li>
            ) : null}
          </>
        )}
      </ol>

      <MemberSwimsSheet
        key={memberSelection.key}
        member={selectedMember}
        sessions={memberSessions}
        places={places}
        onClose={() =>
          setMemberSelection((current) => ({ ...current, member: null }))
        }
      />
    </div>
  );
}

/**
 * Group tab ordering + the active scope. `scope` is the user's explicit
 * choice; null means "not chosen yet", in which case we fall back to the
 * computed default group (freshest member swim) and finally to global.
 * Group ids are validated against the live group list so leaving a group
 * can't strand the board on a dead scope.
 */
function useGroupScope(user: { uid: string } | null, groups: GroupDoc[]) {
  const [scope, setScope] = useState<string | null>(null);
  const [groupRecency, setGroupRecency] = useState<{
    key: string;
    defaultScope: string | null;
    lastSwimAt: Map<string, number>;
  } | null>(null);

  // Default tab + chip order: groups by most-recent member swim (all-time),
  // with biggest-group tie-breaks and then name for stable output.
  const groupsKey = groups
    .map((g) => `${g.id}:${g.members.toSorted().join(",")}`)
    .toSorted()
    .join("\n");
  const groupRecencyKey = user ? `${user.uid}\n${groupsKey}` : "";

  useEffect(() => {
    if (!user || groups.length === 0) return;
    let active = true;
    void Promise.all(
      groups.map(async (g) => ({
        group: g,
        lastSwimAt: (await fetchLatestSwimAt(g.members)) ?? 0,
      })),
    )
      .then((withRecency) => {
        if (!active) return;
        const byRecency = withRecency.toSorted(
          (a, b) =>
            b.lastSwimAt - a.lastSwimAt ||
            b.group.members.length - a.group.members.length ||
            a.group.name.localeCompare(b.group.name),
        );
        setGroupRecency({
          key: groupRecencyKey,
          defaultScope: byRecency[0]?.group.id ?? null,
          lastSwimAt: new Map(
            byRecency.map(({ group, lastSwimAt }) => [group.id, lastSwimAt]),
          ),
        });
        return;
      })
      .catch(() => {
        if (!active) return;
        // Fail open: stable fallback if recency lookup fails.
        const biggest = groups.toSorted(
          (a, b) =>
            b.members.length - a.members.length || a.name.localeCompare(b.name),
        )[0];
        setGroupRecency({
          key: groupRecencyKey,
          defaultScope: biggest?.id ?? null,
          lastSwimAt: new Map(),
        });
        return;
      });
    return () => {
      active = false;
    };
    // Keyed on membership content, same trick as GroupsPage.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [groupRecencyKey]);

  const validGroupIds = new Set(groups.map((g) => g.id));
  const groupRecencyReady =
    groups.length === 0 || groupRecency?.key === groupRecencyKey;
  const defaultScope = groupRecencyReady
    ? (groupRecency?.defaultScope ?? null)
    : null;
  const groupLastSwimAt = groupRecencyReady
    ? (groupRecency?.lastSwimAt ?? new Map<string, number>())
    : new Map<string, number>();
  const orderedGroups = groups.toSorted(
    (a, b) =>
      (groupLastSwimAt.get(b.id) ?? 0) - (groupLastSwimAt.get(a.id) ?? 0) ||
      b.members.length - a.members.length ||
      a.name.localeCompare(b.name),
  );
  const effectiveScope =
    scope && (scope === "global" || validGroupIds.has(scope))
      ? scope
      : defaultScope && validGroupIds.has(defaultScope)
        ? defaultScope
        : "global";

  // Where the 🌍 toggle returns to when switched off: the last group scope
  // that was actually shown (falls back to the default group).
  const lastGroupScopeRef = useRef<string | null>(null);
  useEffect(() => {
    if (effectiveScope !== "global") lastGroupScopeRef.current = effectiveScope;
  }, [effectiveScope]);
  const toggleGlobal = () => {
    if (effectiveScope !== "global") {
      setScope("global");
      return;
    }
    const back =
      lastGroupScopeRef.current ?? defaultScope ?? orderedGroups[0]?.id;
    if (back && validGroupIds.has(back)) setScope(back);
  };

  return {
    scope,
    setScope,
    effectiveScope,
    orderedGroups,
    groupRecencyReady,
    toggleGlobal,
  };
}

/**
 * The board's rows for the active year/scope. Signed-in users read the
 * server-maintained per-year roster (one query over user docs, which carries
 * everything a card shows — name, points, border, achievements, stat chips).
 * Guests can't read user docs (rules) so they fall back to the world-readable
 * top-5 snapshot. `dataReady` guards against rendering a stale value to a
 * guest right after sign-out.
 */
function useLeaderboardRows(
  user: { uid: string } | null,
  year: number,
  groups: GroupDoc[],
  effectiveScope: string,
) {
  const rosterKey = user ? `${user.uid}:${year}` : "";
  const [rosterResult, setRosterResult] = useState<{
    key: string;
    users: UserDoc[];
  } | null>(null);
  useEffect(() => {
    if (!user) return;
    return watchUsersByYearScore(year, (next) => {
      setRosterResult({ key: rosterKey, users: next });
    });
  }, [user, year, rosterKey]);

  // Guests only ever see the global board, powered by the world-readable
  // `leaderboard/{year}` snapshot (top 5) that the scoring functions keep
  // fresh. Signed-in users don't need it — their roster is richer.
  const guestKey = `guest:${year}`;
  const [guestSnap, setGuestSnap] = useState<{
    key: string;
    entries: LeaderboardEntry[];
  } | null>(null);
  useEffect(() => {
    if (user) return;
    return watchGlobalLeaderboard(year, (entries) => {
      setGuestSnap({ key: guestKey, entries });
    });
  }, [user, year, guestKey]);
  const guestReady = guestSnap?.key === guestKey;

  const rosterReady = rosterResult?.key === rosterKey;
  const visibleRoster = user && rosterReady ? rosterResult.users : [];
  const dataReady = user ? rosterReady : guestReady;

  const rows: Row[] = (() => {
    // Guests render straight from the top-5 snapshot — same shape as a
    // roster row, with the border resolved from the stored achievement ids.
    if (!user) {
      const entries = guestReady ? guestSnap.entries : [];
      return entries.map((e) => {
        const unlocked = new Set(Object.keys(e.achievements ?? {}));
        return {
          uid: e.uid,
          displayName: e.displayName,
          points: e.points,
          border: resolveBorder(e.selectedBorder, unlocked.size, unlocked),
          stats: e.stats ?? null,
        };
      });
    }
    const memberFilter: Set<string> | null =
      effectiveScope === "global"
        ? null
        : new Set(groups.find((g) => g.id === effectiveScope)?.members ?? []);
    // One pass: skip non-members and build each row inline, instead of
    // filtering the roster and then mapping the survivors.
    const out: Row[] = [];
    for (const u of visibleRoster) {
      if (memberFilter && !memberFilter.has(u.uid)) continue;
      // Achievements persisted on the profile drive the border — richer
      // than the old live computation (all-time, not just this year).
      const unlocked = new Set(Object.keys(u.achievements ?? {}));
      out.push({
        uid: u.uid,
        displayName: u.displayName,
        points: u.scores?.[String(year)] ?? 0,
        border: resolveBorder(u.selectedBorder, unlocked.size, unlocked),
        stats: u.statsByYear?.[String(year)] ?? null,
      });
    }
    return out;
  })();

  return { rows, visibleRoster, dataReady };
}

/**
 * Group-board rows computed from the members' actual sessions, so the board can
 * be sorted by points/recency/streak and sliced to a competition window. Falls
 * back to the calendar `year` when the group has no timespan. A no-op (empty,
 * ready) when `group` is null (global scope) or the viewer is a guest — the
 * security rules reject unauthenticated session reads.
 */
function useGroupBoardRows(
  user: { uid: string } | null,
  group: GroupDoc | null,
  year: number,
  sortBy: MemberSortBy,
): { rows: Row[]; roster: UserDoc[]; ready: boolean } {
  const hasTimespan =
    !!group && (group.startDate != null || group.endDate != null);
  const range =
    group && hasTimespan
      ? groupRangeMs(group)
      : {
          startMs: new Date(year, 0, 1).getTime(),
          endExclusiveMs: new Date(year + 1, 0, 1).getTime(),
        };
  const membersKey = group?.members.join("\n") ?? "";
  const key = group
    ? `${membersKey}:${range.startMs}:${range.endExclusiveMs}`
    : "";

  const [profiles, setProfiles] = useState<{
    key: string;
    users: UserDoc[];
  } | null>(null);
  const [sessions, setSessions] = useState<{
    key: string;
    list: SessionDoc[];
  } | null>(null);

  useEffect(() => {
    if (!group || !user) {
      setProfiles(null);
      setSessions(null);
      return;
    }
    let active = true;
    setProfiles(null);
    setSessions(null);
    void fetchUsers(group.members).then((users) => {
      if (active) setProfiles({ key, users });
      return;
    });
    const unsub = watchMemberSessionsRange(
      group.members,
      range.startMs,
      range.endExclusiveMs,
      (list) => setSessions({ key, list }),
    );
    return () => {
      active = false;
      unsub();
    };
    // `key` folds in members + range; `user` gates the guest case.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [key, user]);

  if (!group || !user) return { rows: [], roster: [], ready: true };

  const ready = profiles?.key === key && sessions?.key === key;
  if (!ready) return { rows: [], roster: [], ready: false };

  const roster = profiles!.users;
  // Streak metric is "the year's best run" — for a window pick the year it
  // mostly falls in (its end, or start for an open-ended range).
  const streakYear = hasTimespan
    ? new Date(group.endDate ?? group.startDate ?? Date.now()).getFullYear()
    : year;
  const stats = aggregateMemberStats(sessions!.list, group.members, streakYear);

  const rows: Row[] = roster
    .map((u): Row => {
      const st = stats.get(u.uid);
      const unlocked = new Set(Object.keys(u.achievements ?? {}));
      return {
        uid: u.uid,
        displayName: u.displayName,
        points: st?.points ?? 0,
        border: resolveBorder(u.selectedBorder, unlocked.size, unlocked),
        stats: {
          swims: st?.swims ?? 0,
          uniquePlaces: st?.spots.size ?? 0,
          winters: 0,
          countriesAbroad: 0,
        },
      };
    })
    .toSorted((a, b) =>
      compareMemberStats(stats.get(a.uid), stats.get(b.uid), sortBy),
    );

  return { rows, roster, ready: true };
}

function LeaderboardGhostRow() {
  return (
    <li className="glass relative flex items-center gap-3 p-3">
      <div className="h-9 w-9 flex-none animate-pulse rounded-full bg-slate-200/70" />
      <div className="min-w-0 flex-1">
        <div className="h-3.5 w-32 animate-pulse rounded bg-slate-200/70" />
        <div className="mt-1.5 flex h-4 items-center gap-2 overflow-hidden whitespace-nowrap">
          <div className="h-2.5 w-20 animate-pulse rounded bg-slate-200/70" />
          <div className="h-2.5 w-16 animate-pulse rounded bg-slate-200/70" />
        </div>
        <div className="mt-1 flex h-3.5 items-center">
          <div className="h-2 w-14 animate-pulse rounded bg-slate-200/70" />
        </div>
      </div>
      <div className="h-7 w-10 flex-none animate-pulse rounded bg-slate-200/70" />
    </li>
  );
}

function BoardRow({
  row: r,
  rank,
  isMe,
  onSelect,
}: {
  row: Row;
  rank: number;
  isMe: boolean;
  /** When set, the card is tappable (group scopes); global rows pass nothing. */
  onSelect?: () => void;
}) {
  const t = useT();
  const podium = podiumStyle(rank);
  const stats = r.stats;

  // Rows reveal — and their score rolls up from 0 — when they scroll into
  // view rather than all at once on mount, so the odometer effect is
  // actually seen as the user scrolls down the board. The 400px bottom
  // margin starts the reveal well before the row enters the viewport:
  // triggering at 50% visibility made rows visibly pop in mid-scroll.
  const ref = useRef<HTMLLIElement | null>(null);
  const inView = useInView(ref, {
    once: true,
    margin: "0px 0px 400px 0px",
  });

  return (
    // No `layout`/AnimatePresence here on purpose: they force framer-motion
    // to measure every row on any roster change, which scales badly — the
    // board can hold up to LEADERBOARD_LIMIT rows.
    <m.li
      ref={ref}
      initial={{ opacity: 0, y: 8 }}
      animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }}
      transition={{ type: "tween", duration: 0.2 }}
      onClick={onSelect}
      role={onSelect ? "button" : undefined}
      tabIndex={onSelect ? 0 : undefined}
      onKeyDown={
        onSelect
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect();
              }
            }
          : undefined
      }
      className={cn(
        "glass relative flex items-center gap-3 p-3 transition",
        podium.cardClass,
        isMe && "ring-2 ring-wave-400",
        onSelect && "cursor-pointer hover:bg-white/90 active:scale-[0.99]",
      )}
    >
      <div className="relative flex-none">
        <div
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-full text-lg font-black",
            podium.medalClass,
            r.border.id !== "none" && `ring-2 ${r.border.ringClass}`,
          )}
        >
          {podium.medal ?? <span>{rank + 1}</span>}
        </div>
        {r.border.id !== "none" ? (
          <span
            className="absolute -right-1 -bottom-1 text-[11px] leading-none drop-shadow-sm"
            title={t(`border.${r.border.id}`)}
          >
            {r.border.emoji}
          </span>
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold text-wave-900">
          {r.displayName}
          {isMe ? (
            <span className="ml-2 rounded-full bg-wave-100 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-wave-700 uppercase">
              {t("common.you")}
            </span>
          ) : null}
        </div>
        {/* Fixed two-line stat block so every card is the same height:
            swims + spots always on the first line, winters/countries on a
            tighter, dimmer second line that keeps its space (empty) when
            there's nothing to show — no flex-wrap, no per-row card growth. */}
        {stats ? (
          <div className="text-[11px] leading-4 text-slate-500">
            <div className="flex items-center gap-2 overflow-hidden whitespace-nowrap">
              <span>
                {stats.swims === 1
                  ? t("leaderboard.swim")
                  : t("leaderboard.swims", { n: stats.swims })}
              </span>
              <span className="inline-flex items-center gap-0.5">
                <MapPin className="h-3 w-3" />
                {stats.uniquePlaces === 1
                  ? t("leaderboard.spot")
                  : t("leaderboard.spots", { n: stats.uniquePlaces })}
              </span>
            </div>
            <div className="flex h-3.5 items-center gap-2 overflow-hidden text-[10px] leading-none whitespace-nowrap text-slate-400">
              {stats.winters > 0 ? (
                <span className="inline-flex items-center gap-0.5">
                  <Snowflake className="h-2.5 w-2.5" />
                  {stats.winters === 1
                    ? t("leaderboard.winter")
                    : t("leaderboard.winters", { n: stats.winters })}
                </span>
              ) : null}
              {stats.countriesAbroad > 0 ? (
                <span className="text-teal-700">
                  {t("leaderboard.countries", { n: stats.countriesAbroad + 1 })}
                </span>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="text-[11px] leading-4">
            <div className="flex h-4 items-center">
              <div className="h-2.5 w-32 animate-pulse rounded bg-slate-200/70" />
            </div>
            <div className="flex h-3.5 items-center">
              <div className="h-2 w-20 animate-pulse rounded bg-slate-200/70" />
            </div>
          </div>
        )}
      </div>
      <AnimatedNumber
        value={inView ? r.points : 0}
        className="font-display text-2xl font-black text-wave-700"
      />
    </m.li>
  );
}

function podiumStyle(rank: number): {
  medal: React.ReactNode | null;
  medalClass: string;
  cardClass: string;
} {
  if (rank === 0)
    return {
      medal: <Crown className="h-5 w-5" />,
      medalClass:
        "bg-gradient-to-br from-amber-300 to-amber-500 text-white shadow-md shadow-amber-500/30",
      cardClass:
        "bg-gradient-to-r from-amber-50 via-white to-white ring-1 ring-amber-200",
    };
  if (rank === 1)
    return {
      medal: null,
      medalClass:
        "bg-gradient-to-br from-slate-200 to-slate-400 text-white shadow",
      cardClass: "bg-gradient-to-r from-slate-50 via-white to-white",
    };
  if (rank === 2)
    return {
      medal: null,
      medalClass:
        "bg-gradient-to-br from-orange-300 to-orange-500 text-white shadow",
      cardClass: "bg-gradient-to-r from-orange-50 via-white to-white",
    };
  return {
    medal: null,
    medalClass: "bg-slate-100 text-slate-500",
    cardClass: "",
  };
}

/**
 * Season stepper: ‹ 2026 ›. Bounded by the app's first season (min) and the
 * current year (max) — with one season live both arrows render disabled,
 * and new years light up on their own each January.
 */
function YearPicker({
  year,
  canGoBack,
  canGoForward,
  onChange,
}: {
  year: number;
  min: number;
  max: number;
  canGoBack: boolean;
  canGoForward: boolean;
  onChange: (year: number) => void;
}) {
  const t = useT();
  return (
    <div className="chip gap-0.5 px-1">
      <button
        type="button"
        onClick={() => onChange(year - 1)}
        disabled={!canGoBack}
        aria-label={t("leaderboard.year_prev")}
        className="rounded-full p-0.5 text-wave-700 hover:bg-wave-100 disabled:text-slate-300 disabled:hover:bg-transparent"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
      </button>
      <span className="min-w-9 text-center text-sm font-semibold tabular-nums">
        {year}
      </span>
      <button
        type="button"
        onClick={() => onChange(year + 1)}
        disabled={!canGoForward}
        aria-label={t("leaderboard.year_next")}
        className="rounded-full p-0.5 text-wave-700 hover:bg-wave-100 disabled:text-slate-300 disabled:hover:bg-transparent"
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function ScopeChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-active={active}
      className="chip whitespace-nowrap data-[active=true]:bg-wave-600 data-[active=true]:text-white data-[active=true]:ring-wave-700"
    >
      {label}
    </button>
  );
}
