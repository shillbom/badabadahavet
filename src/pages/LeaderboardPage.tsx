import { useEffect, useRef, useState } from "react";
import { m, useInView } from "framer-motion";
import {
  ChevronLeft,
  ChevronRight,
  Crown,
  Snowflake,
  MapPin,
} from "lucide-react";
import { useStore } from "@/store/sessions";
import { useAuth } from "@/auth/AuthContext";
import type { SessionDoc, UserDoc, YearStats } from "@/lib/types";
import {
  fetchLatestSwimUid,
  watchMemberSessions,
  watchUsersByYearScore,
} from "@/lib/data";
import { splitTopList } from "@/lib/leaderboard";
import { resolveBorder, type Border } from "@/lib/borders";
import { useT } from "@/lib/i18n";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import MemberSwimsSheet from "@/components/MemberSwimsSheet";
import { cn } from "@/lib/utils";
import { useIsAdmin } from "@/lib/adminMode";

type Row = {
  uid: string;
  displayName: string;
  points: number;
  border: Border;
  /** Server-maintained card stats; null for users logged before the
   *  statsByYear backfill ran (renders as a placeholder). */
  stats: YearStats | null;
};

/** First season the app was live — the year picker never goes below this. */
const MIN_YEAR = 2026;

export default function LeaderboardPage() {
  const groups = useStore((s) => s.groups);
  const { user } = useAuth();
  const isAdmin = useIsAdmin();

  const t = useT();

  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);

  // `scope` is the user's explicit choice; null means "not chosen yet", in
  // which case we fall back to the computed default group (freshest swim)
  // and finally to global. Group ids are validated against the live group
  // list so leaving a group can't strand the board on a dead scope.
  const [scope, setScope] = useState<string | null>(null);
  const [defaultScope, setDefaultScope] = useState<string | null>(null);

  // Default tab: the group whose members swam most recently. One cheap
  // one-shot lookup (limit-1 query per 30 members) across the union of all
  // group members; when the freshest swimmer is in several of my groups —
  // or nobody has swum yet — the biggest group wins.
  const groupsKey = groups
    .map((g) => g.id)
    .toSorted()
    .join("\n");
  useEffect(() => {
    if (!user || groups.length === 0) return;
    let active = true;
    const memberUnion = new Set<string>();
    for (const g of groups) for (const uid of g.members) memberUnion.add(uid);
    void fetchLatestSwimUid([...memberUnion]).then((latestUid) => {
      if (!active) return;
      const withSwimmer = latestUid
        ? groups.filter((g) => g.members.includes(latestUid))
        : [];
      const pool = withSwimmer.length > 0 ? withSwimmer : groups;
      const biggest = pool.toSorted(
        (a, b) => b.members.length - a.members.length,
      )[0];
      setDefaultScope(biggest.id);
      return;
    });
    return () => {
      active = false;
    };
    // Keyed on membership content, same trick as GroupsPage.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [user, groupsKey]);

  const validGroupIds = new Set(groups.map((g) => g.id));
  const effectiveScope =
    scope && (scope === "global" || validGroupIds.has(scope))
      ? scope
      : defaultScope && validGroupIds.has(defaultScope)
        ? defaultScope
        : "global";

  // Where the 🌍 toggle returns to when switched off: the last group scope
  // that was actually shown (falls back to the default group).
  const lastGroupScopeRef = useRef<string | null>(null);
  if (effectiveScope !== "global") lastGroupScopeRef.current = effectiveScope;
  const toggleGlobal = () => {
    if (effectiveScope !== "global") {
      setScope("global");
      return;
    }
    const back = lastGroupScopeRef.current ?? defaultScope ?? groups[0]?.id;
    if (back && validGroupIds.has(back)) setScope(back);
  };

  // The whole board is one query over user docs: the server-maintained
  // yearly score provides membership and order, and the doc carries
  // everything the card shows (name, points, border, achievements, and the
  // per-year stat chips). No session docs are read at all. Guests can't
  // read user docs (rules), so the board is empty until signed in.
  const [roster, setRoster] = useState<UserDoc[]>([]);
  useEffect(() => {
    if (!user) return;
    return watchUsersByYearScore(year, setRoster);
  }, [user, year]);

  // A sign-out leaves the last subscription value in state briefly, but it
  // must never be rendered to a guest. Deriving this avoids an extra effect
  // render solely to clear state.
  const visibleRoster = user ? roster : [];

  const rows: Row[] = (() => {
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

  // The global board only shows the podium (top 5) plus your own row with
  // its true rank when you're further down. Group boards are small and
  // personal, so they stay complete.
  const TOP_N = 5;
  const { top, me } =
    effectiveScope === "global"
      ? splitTopList(rows, user?.uid, TOP_N)
      : { top: rows, me: null };

  // Group rows open the same member-swims sheet as the group view. The
  // global board stays non-interactive (strangers' swims aren't a tap
  // target). Sessions are subscribed per clicked member — one year-bounded
  // single-uid query — instead of preloading the whole scope.
  const isGroupScope = effectiveScope !== "global";
  const places = useStore((s) => s.placesWithTemps);
  const [memberSelection, setMemberSelection] = useState<{
    member: UserDoc | null;
    key: number;
  }>({ member: null, key: 0 });
  const selectedMember = memberSelection.member;
  const [memberSessions, setMemberSessions] = useState<SessionDoc[]>([]);
  const selectedUid = selectedMember?.uid;
  useEffect(() => {
    if (!selectedUid) return;
    return watchMemberSessions([selectedUid], setMemberSessions, year);
  }, [selectedUid, year]);

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
          <YearPicker
            year={year}
            min={MIN_YEAR}
            max={Math.max(currentYear, MIN_YEAR)}
            onChange={setYear}
          />
        </div>
      </div>

      {groups.length > 0 ? (
        <div className="no-scrollbar -mx-4 mb-3 flex gap-2 overflow-x-auto px-4 py-1">
          {groups.map((g) => (
            <ScopeChip
              key={g.id}
              label={`${g.emoji ?? "👥"} ${g.name}`}
              active={effectiveScope === g.id}
              onClick={() => setScope(g.id)}
            />
          ))}
        </div>
      ) : null}

      <ol className="mb-4 space-y-2">
        {top.map((r, i) => (
          <BoardRow
            key={r.uid}
            row={r}
            rank={i}
            isMe={user?.uid === r.uid}
            onSelect={
              isGroupScope || isAdmin
                ? () => {
                    setMemberSessions([]);
                    setMemberSelection((current) => ({
                      member: roster.find((u) => u.uid === r.uid) ?? null,
                      key: current.key + 1,
                    }));
                  }
                : undefined
            }
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
  min,
  max,
  onChange,
}: {
  year: number;
  min: number;
  max: number;
  onChange: (year: number) => void;
}) {
  const t = useT();
  return (
    <div className="chip gap-0.5 px-1">
      <button
        type="button"
        onClick={() => onChange(year - 1)}
        disabled={year <= min}
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
        disabled={year >= max}
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
