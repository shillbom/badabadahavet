import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { m, AnimatePresence } from "framer-motion";
import { DayPicker, type DateRange } from "react-day-picker";
import { sv as svLocale, enGB } from "react-day-picker/locale";
import "react-day-picker/style.css";
import {
  Copy,
  LogOut,
  Plus,
  Share2,
  UserMinus,
  Waves,
  Check,
  Merge,
  Settings,
  CalendarRange,
} from "lucide-react";
import { useStore } from "@/store/sessions";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { toast } from "@/components/ui/toastStore";
import {
  createGroup,
  joinGroupByCode,
  kickGroupMember,
  leaveGroup,
  fetchUsers,
  lookupGroupByCode,
  updateGroupMeta,
  watchMemberSessions,
} from "@/lib/data";
import type { GroupDoc, PlaceWithTemp, SessionDoc, UserDoc } from "@/lib/types";
import { useT, useLocale, localeBcp } from "@/lib/i18n";
import { assertTextAllowed, ModerationError } from "@/lib/moderation";
import { aggregateMemberStats, compareMemberStats } from "@/lib/leaderboard";
import { DAY_MS, dayStartMs as dayStart, formatGroupRange } from "@/lib/date";
import { cn } from "@/lib/utils";
import MemberSwimsSheet from "@/components/MemberSwimsSheet";
import EmojiAvatar from "@/components/EmojiAvatar";
import BottomSheet from "@/components/BottomSheet";

const GROUP_EMOJIS = [
  "👥",
  "🌊",
  "🏊",
  "🦭",
  "🐬",
  "❄️",
  "🔥",
  "⚡",
  "🏆",
  "🌴",
  "🐋",
  "🦑",
  "🐟",
  "🦀",
  "🍀",
  "💪",
  "🎯",
  "🚀",
  "🎉",
  "🧊",
];

/** Short "last swim" recency label + colour, for the competitive at-a-glance. */
function recency(
  lastSwim: number,
  t: ReturnType<typeof useT>,
): { label: string; cls: string } {
  if (!lastSwim)
    return {
      label: t("groups.last.never"),
      cls: "bg-slate-100 text-slate-400",
    };
  const days = Math.round((dayStart(Date.now()) - dayStart(lastSwim)) / DAY_MS);
  if (days <= 0)
    return {
      label: t("groups.last.today"),
      cls: "bg-emerald-100 text-emerald-700",
    };
  if (days === 1)
    return {
      label: t("groups.last.yesterday"),
      cls: "bg-wave-100 text-wave-700",
    };
  return {
    label: t("groups.last.days_ago", { n: days }),
    cls:
      days <= 6 ? "bg-wave-100 text-wave-700" : "bg-slate-100 text-slate-500",
  };
}

/** Group preview returned by lookupGroupByCode, plus the confirmed code. */
type JoinPreview = {
  id: string;
  name: string;
  emoji: string | null;
  memberCount: number;
  code: string;
};

/**
 * Owns the create/join/leave/share flows and the pending-join confirmation
 * state (including the ?join=CODE deep-link auto-trigger). Kept as a hook so
 * GroupsPage stays a thin composition of the forms, list, and dialogs.
 */
function useGroupActions(user: ReturnType<typeof useAuth>["user"]) {
  const t = useT();
  const groups = useStore((s) => s.groups);
  const [groupName, setGroupName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [busy, setBusy] = useState(false);
  // Optional competition timespan. `undefined` means "no window set".
  const [timespan, setTimespan] = useState<DateRange | undefined>(undefined);
  const [searchParams, setSearchParams] = useSearchParams();

  // Pending join confirmation: the group preview returned by lookupGroupByCode.
  const [pendingJoin, setPendingJoin] = useState<JoinPreview | null>(null);

  const [lastJoin, setLastJoin] = useState<JoinPreview | null>(null);
  const join = pendingJoin ?? lastJoin;

  // Trigger a group lookup, then show the confirmation dialog.
  async function lookupAndConfirm(code: string) {
    if (code.trim().length < 3) {
      toast.error(t("groups.join.too_short"));
      return;
    }
    setBusy(true);
    try {
      const preview = await lookupGroupByCode(code.trim());
      if (!preview) {
        toast.error(t("groups.join.not_found"));
      } else if (groups.some((g) => g.id === preview.id)) {
        // Already a member? Tell them immediately without showing the dialog.
        toast.info(t("groups.join.already_member"));
      } else {
        const setJoin = { ...preview, code: code.trim().toUpperCase() };
        setLastJoin(setJoin);
        setPendingJoin(setJoin);
      }
    } catch {
      toast.error(t("groups.join.error.generic"));
    }
    setBusy(false);
  }

  // Actually join after the user confirmed in the dialog.
  async function confirmJoin() {
    if (!user || !pendingJoin) return;
    setBusy(true);
    try {
      const g = await joinGroupByCode({
        code: pendingJoin.code,
        uid: user.uid,
      });
      if (!g) toast.error(t("groups.join.not_found"));
      else {
        toast.success(t("groups.join.success", { name: g.name }));
        setJoinCode("");
        setPendingJoin(null);
      }
    } catch {
      toast.error(t("groups.join.error.generic"));
    }
    setBusy(false);
  }

  // Auto-trigger confirmation from ?join=CODE deep-link on mount.
  useEffect(() => {
    const code = searchParams.get("join");
    if (!code) return;
    setSearchParams({}, { replace: true });
    // Small delay so the page is fully rendered before the dialog appears.
    // Cleared on unmount so navigating away before it fires can't run a
    // stale callback (setState/toast on an unmounted page).
    const id = setTimeout(() => lookupAndConfirm(code), 350);
    return () => clearTimeout(id);
    // Only run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onCreate(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!user) return;
    if (!groupName.trim()) {
      toast.error(t("groups.create.error.empty"));
      return;
    }
    setBusy(true);
    try {
      await assertTextAllowed(groupName);
      const { start, end } = rangeToMs(timespan);
      const g = await createGroup({
        name: groupName,
        uid: user.uid,
        startDate: start,
        endDate: end,
      });
      toast.success(t("groups.create.success", { name: g.name, code: g.code }));
      setGroupName("");
      setTimespan(undefined);
    } catch (err) {
      toast.error(
        t(
          err instanceof ModerationError
            ? "moderation.name_rejected"
            : "groups.create.error.generic",
        ),
      );
    }
    setBusy(false);
  }

  async function onJoin(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!user) return;
    await lookupAndConfirm(joinCode);
  }

  return {
    groups,
    groupName,
    setGroupName,
    timespan,
    setTimespan,
    joinCode,
    setJoinCode,
    busy,
    join,
    pendingJoin,
    setPendingJoin,
    onCreate,
    onJoin,
    confirmJoin,
  };
}

/**
 * Build a react-day-picker range from stored day-start ms bounds, or undefined
 * when the group has no competition window.
 */
function toDateRange(startMs?: number, endMs?: number): DateRange | undefined {
  if (startMs == null && endMs == null) return undefined;
  return {
    from: startMs != null ? new Date(startMs) : undefined,
    to: endMs != null ? new Date(endMs) : undefined,
  };
}

/**
 * Convert a picked range into day-start ms bounds for storage. A range with
 * only a start (mid-selection) stores the same day for both ends so the window
 * is still valid; an undefined range clears both bounds.
 */
function rangeToMs(range: DateRange | undefined): {
  start?: number;
  end?: number;
} {
  if (!range) return {};
  const start = range.from ? dayStart(range.from.getTime()) : undefined;
  const end = range.to ? dayStart(range.to.getTime()) : start;
  return { start, end };
}

/**
 * Optional competition-window picker shared by the create form and the settings
 * sheet. A checkbox reveals a react-day-picker range calendar; ticking it seeds
 * a sensible default of the whole current year, unticking clears the window.
 */
function TimespanPicker({
  range,
  onRangeChange,
}: {
  range: DateRange | undefined;
  onRangeChange: (r: DateRange | undefined) => void;
}) {
  const t = useT();
  const locale = useLocale((s) => s.locale);
  const dpLocale = locale === "sv" ? svLocale : enGB;
  const enabled = range !== undefined;

  // Tint react-day-picker with the app's wave palette (matches SwimDatePicker).
  const dpStyle = {
    "--rdp-accent-color": "#019eea",
    "--rdp-accent-background-color": "#def1ff",
    "--rdp-today-color": "#007ec6",
  } as React.CSSProperties;

  function toggle(on: boolean) {
    if (!on) {
      onRangeChange(undefined);
      return;
    }
    const y = new Date().getFullYear();
    onRangeChange({ from: new Date(y, 0, 1), to: new Date(y, 11, 31) });
  }

  return (
    <div className="space-y-2 border-t border-white/40 pt-3">
      <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-600">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => toggle(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300 text-wave-600 accent-wave-600 focus:ring-wave-500"
        />
        <CalendarRange className="h-3.5 w-3.5" />
        {t("groups.timespan.add")}
      </label>
      <AnimatePresence initial={false}>
        {enabled && (
          <m.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <p className="pb-1 text-[11px] text-slate-400">
              {t("groups.timespan.optional_hint")}
            </p>
            <div className="flex justify-center rounded-2xl bg-white/60 p-1 ring-1 ring-white/60">
              <DayPicker
                mode="range"
                locale={dpLocale}
                selected={range}
                onSelect={(next, triggerDate) => {
                  // When a complete range already exists, RDP's default treats
                  // a click inside it as moving a boundary — so a click meant
                  // to be the new *start* becomes the end. Reset to a fresh
                  // one-day range at the clicked date instead; the next click
                  // then completes the range as usual.
                  if (range?.from && range?.to) {
                    onRangeChange({ from: triggerDate, to: undefined });
                  } else {
                    onRangeChange(next);
                  }
                }}
                defaultMonth={range?.from ?? new Date()}
                style={dpStyle}
              />
            </div>
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function copyCode(code: string, t: ReturnType<typeof useT>) {
  navigator.clipboard.writeText(code).then(
    () => toast.success(t("groups.code_copied")),
    () => toast.error(t("groups.copy_failed")),
  );
}

function shareInviteLink(
  group: { name: string; code: string },
  t: ReturnType<typeof useT>,
) {
  const url = `${window.location.origin}/groups?join=${group.code}`;
  if (navigator.share) {
    navigator
      .share({
        title: t("groups.share_title", { name: group.name }),
        text: t("groups.share_text", { code: group.code }),
        url,
      })
      .catch(() => {
        // User dismissed the share sheet — no toast needed.
      });
  } else {
    navigator.clipboard.writeText(url).then(
      () => toast.success(t("groups.link_copied")),
      () => toast.error(t("groups.copy_failed")),
    );
  }
}

export default function GroupsPage() {
  const { user } = useAuth();
  const t = useT();
  const places = useStore((s) => s.placesWithTemps);
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  const [groupSheetOpen, setGroupSheetOpen] = useState(false);

  const {
    groups,
    groupName,
    setGroupName,
    timespan,
    setTimespan,
    joinCode,
    setJoinCode,
    busy,
    join,
    pendingJoin,
    setPendingJoin,
    onCreate,
    onJoin,
    confirmJoin,
  } = useGroupActions(user);

  // Derive the open group from the live list so edits (rename, timespan, kicks)
  // reflect in the detail sheet immediately instead of showing a stale snapshot.
  const openGroup = groups.find((g) => g.id === openGroupId) ?? null;

  async function onLeave(groupId: string, name: string) {
    if (!user) return;
    if (!window.confirm(t("groups.leave_confirm", { name }))) return;
    try {
      await leaveGroup({ groupId, uid: user.uid });
      toast.success(t("groups.left", { name }));
      if (openGroupId === groupId) setGroupSheetOpen(false);
    } catch {
      toast.error(t("groups.leave.error.generic"));
    }
  }

  return (
    <div className="px-4 pt-2">
      <h2 className="mb-3 font-display text-2xl font-black text-wave-900">
        {t("groups.title")}
      </h2>

      <m.form onSubmit={onCreate} layout className="glass mb-3 space-y-3 p-4">
        <Label>{t("groups.create.label")}</Label>
        <div className="flex gap-2">
          <Input
            placeholder={t("groups.create.placeholder")}
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
          />
          <Button type="submit" loading={busy} size="md" className="px-4">
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        <TimespanPicker range={timespan} onRangeChange={setTimespan} />
      </m.form>

      <m.form onSubmit={onJoin} layout className="glass mb-5 space-y-3 p-4">
        <Label>{t("groups.join.label")}</Label>
        <div className="flex gap-2">
          <Input
            placeholder="ABCDE"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            maxLength={8}
            className="font-mono tracking-[0.3em]"
          />
          <Button type="submit" size="md" loading={busy} className="px-4">
            <Merge className="h-4 w-4" />
          </Button>
        </div>
      </m.form>

      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
          {t("groups.your_groups")}
        </h3>
        <span className="text-[11px] text-slate-400">
          {t("groups.unlimited_hint")}
        </span>
      </div>
      {groups.length === 0 ? (
        <div className="rounded-2xl bg-white/60 p-6 text-center text-sm text-slate-500">
          {t("groups.empty")}
        </div>
      ) : (
        <ul className="mb-4 space-y-2">
          <AnimatePresence initial={false}>
            {groups.map((g) => (
              <GroupListItem
                key={g.id}
                group={g}
                myUid={user?.uid}
                onOpen={() => {
                  setOpenGroupId(g.id);
                  setGroupSheetOpen(true);
                }}
                onLeave={() => onLeave(g.id, g.name)}
              />
            ))}
          </AnimatePresence>
        </ul>
      )}

      <GroupDetailSheet
        key={openGroup?.id ?? "none"}
        group={openGroup}
        open={groupSheetOpen}
        myUid={user?.uid ?? ""}
        places={places}
        onClose={() => setGroupSheetOpen(false)}
        onLeave={() => {
          if (openGroup) onLeave(openGroup.id, openGroup.name);
        }}
      />

      <JoinConfirmSheet
        join={join}
        open={!!pendingJoin}
        busy={busy}
        onCancel={() => setPendingJoin(null)}
        onConfirm={confirmJoin}
      />
    </div>
  );
}

/** One row in the "your groups" list: emoji, name, code, share, leave. */
function GroupListItem({
  group,
  myUid,
  onOpen,
  onLeave,
}: {
  group: GroupDoc;
  myUid: string | undefined;
  onOpen: () => void;
  onLeave: () => void;
}) {
  const t = useT();
  return (
    <m.li
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4, scale: 0.97 }}
      className="glass flex cursor-pointer items-center gap-3 p-3 transition-colors hover:bg-white/60"
      onClick={onOpen}
    >
      <EmojiAvatar emoji={group.emoji ?? "👥"} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold text-wave-900">{group.name}</div>
        <div className="text-[11px] text-slate-500">
          {group.members.length === 1
            ? t("groups.member_one")
            : t("groups.member_many", { n: group.members.length })}
          {group.createdBy === myUid ? ` · ${t("groups.founder")}` : ""}
        </div>
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          copyCode(group.code, t);
        }}
        className="flex items-center gap-1 rounded-full bg-white/80 px-3 py-1 font-mono text-sm font-bold tracking-widest text-wave-800 ring-1 ring-wave-200 hover:bg-white"
      >
        {group.code}
        <Copy className="h-3 w-3" />
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          shareInviteLink(group, t);
        }}
        className="rounded-full bg-white/70 p-2 text-wave-600 ring-1 ring-wave-200 hover:bg-wave-50 hover:text-wave-700"
        aria-label={t("groups.share_link")}
        title={t("groups.share_link")}
      >
        <Share2 className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onLeave();
        }}
        className="rounded-full bg-white/70 p-2 text-slate-500 ring-1 ring-slate-200 hover:bg-rose-50 hover:text-rose-600"
        aria-label={t("groups.leave_aria", { name: group.name })}
        title={t("groups.leave_title")}
      >
        <LogOut className="h-3.5 w-3.5" />
      </button>
    </m.li>
  );
}

/** Confirmation dialog shown before joining a group by code. */
function JoinConfirmSheet({
  join,
  open,
  busy,
  onCancel,
  onConfirm,
}: {
  join: JoinPreview | null;
  open: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useT();
  return (
    <BottomSheet size="small" open={open} onClose={() => !busy && onCancel()}>
      {join ? (
        <div className="flex flex-col items-center gap-3 text-center">
          <EmojiAvatar emoji={join.emoji ?? "👥"} size="xl" ring />
          <div>
            <p className="text-sm text-slate-500">
              {t("groups.join.confirm.body")}
            </p>
            <h3 className="mt-0.5 font-display text-2xl font-black text-wave-900">
              {join.name}
            </h3>
            <p className="mt-1 text-sm text-slate-400">
              {join.memberCount === 1
                ? t("groups.join.confirm.member_one")
                : t("groups.join.confirm.members", {
                    n: join.memberCount,
                  })}
            </p>
          </div>

          <div className="mt-2 flex w-full gap-3">
            <Button
              variant="secondary"
              className="flex-1"
              onClick={onCancel}
              disabled={busy}
            >
              {t("common.cancel")}
            </Button>
            <Button className="flex-1" loading={busy} onClick={onConfirm}>
              {t("groups.join.confirm.button")}
            </Button>
          </div>
        </div>
      ) : null}
    </BottomSheet>
  );
}

/** Aggregated per-member stats for the group leaderboard. */
type MemberStats = {
  points: number;
  swims: number;
  spots: Set<string>;
  lastSwim: number;
  streak: number;
};

/**
 * Subscribes to the group's member profiles and sessions, and derives the
 * sorted leaderboard + leader set. Keyed on membership *content* so unrelated
 * group snapshots don't tear down the sessions listener or re-fetch profiles.
 */
function useGroupMemberStats(
  group: GroupDoc | null,
  sortBy: "points" | "recent" | "streak",
) {
  const [allSessions, setAllSessions] = useState<SessionDoc[]>([]);

  // Every groups snapshot delivers a fresh `members` array reference even
  // when nobody joined or left, and the parent re-syncs `group` to the live
  // store object on each one. Key the member-scoped effects on the
  // membership *content* so unrelated group updates don't tear down the
  // sessions listener or re-fetch every member's profile.
  const membersKey = group?.members.join("\n");

  const [{ profiles, loading: loadingProfiles }, setProfilesState] = useState<{
    profiles: UserDoc[];
    loading: boolean;
  }>({ profiles: [], loading: true });

  useEffect(() => {
    if (!group) return;
    let active = true;

    void fetchUsers(group.members).then((users) => {
      if (active) setProfilesState({ profiles: users, loading: false });
      return;
    });

    const unsubscribe = watchMemberSessions(group.members, setAllSessions);
    return () => {
      active = false;
      unsubscribe();
    };
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [membersKey]);

  const memberStats = aggregateMemberStats(
    allSessions,
    group?.members ?? [],
    new Date().getFullYear(),
  );

  const sortedMembers = [...profiles].toSorted((a, b) =>
    compareMemberStats(memberStats.get(a.uid), memberStats.get(b.uid), sortBy),
  );

  // Whoever's on top of the points board — but only a single member, and only
  // when they actually beat everyone else. With nobody on the board yet (0
  // points) there's no "lead" to award, and when two or more share the top
  // score it's a tie, not a lead — handled separately below.
  const topPoints = sortedMembers.length
    ? (memberStats.get(sortedMembers[0].uid)?.points ?? 0)
    : 0;
  const leaderUids = ((): Set<string> => {
    const uids = new Set<string>();
    if (topPoints <= 0) return uids;
    // One pass instead of filter-then-map over the member list.
    for (const member of sortedMembers) {
      if ((memberStats.get(member.uid)?.points ?? 0) === topPoints)
        uids.add(member.uid);
    }
    return uids;
  })();

  return {
    allSessions,
    profiles,
    loadingProfiles,
    memberStats,
    sortedMembers,
    leaderUids,
    tiedForLead: leaderUids.size > 1,
  };
}

function GroupDetailSheet({
  group,
  open,
  myUid,
  places,
  onClose,
  onLeave,
}: {
  group: GroupDoc | null;
  open: boolean;
  myUid: string;
  places: PlaceWithTemp[];
  onClose: () => void;
  onLeave: () => void;
}) {
  const t = useT();
  const locale = useLocale((s) => s.locale);

  const shown = group;

  const {
    allSessions,
    profiles,
    loadingProfiles,
    memberStats,
    sortedMembers,
    leaderUids,
    tiedForLead,
  } = useGroupMemberStats(group, "points");

  const isLeader = shown?.createdBy === myUid;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const rangeLabel = shown
    ? formatGroupRange(shown, localeBcp(locale), {
        openStart: t("groups.timespan.open_start_label"),
        openEnd: t("groups.timespan.open_end_label"),
      })
    : null;
  const [memberSelection, setMemberSelection] = useState<{
    member: UserDoc | null;
    key: number;
  }>({ member: null, key: 0 });
  const selectedMember = memberSelection.member;

  const header =
    shown != null ? (
      <GroupSheetHeader
        group={shown}
        onOpenSettings={() => setSettingsOpen(true)}
      />
    ) : null;

  return (
    <>
      <BottomSheet open={open} onClose={onClose} size="large" title={header}>
        {shown ? (
          <div className="px-4 pt-1 pb-[calc(max(env(safe-area-inset-bottom),0.5rem)+1.5rem)]">
            {rangeLabel && (
              <div className="mb-3 flex items-center gap-1.5 rounded-xl bg-wave-50 px-3 py-2 text-xs font-medium text-wave-700 ring-1 ring-wave-200">
                <CalendarRange className="h-3.5 w-3.5 flex-none" />
                <span>{rangeLabel}</span>
              </div>
            )}
            <h4 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
              {t("groups.detail.members")}
            </h4>
            {loadingProfiles ? (
              <div className="flex h-20 items-center justify-center">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-wave-600 border-r-transparent" />
              </div>
            ) : (
              <ul className="space-y-2 pb-4">
                {sortedMembers.map((member) => (
                  <MemberRow
                    key={member.uid}
                    member={member}
                    stats={memberStats.get(member.uid)}
                    isMe={member.uid === myUid}
                    isFounder={member.uid === shown.createdBy}
                    leaderBadge={
                      leaderUids.has(member.uid)
                        ? tiedForLead
                          ? "tied"
                          : "lead"
                        : null
                    }
                    onSelect={() =>
                      setMemberSelection((current) => ({
                        member,
                        key: current.key + 1,
                      }))
                    }
                  />
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </BottomSheet>

      {shown && (
        <GroupSettingsSheet
          group={shown}
          open={settingsOpen}
          isLeader={isLeader}
          myUid={myUid}
          profiles={profiles}
          onClose={() => setSettingsOpen(false)}
          onLeave={onLeave}
        />
      )}

      {/* Member-detail map overlay (stacks above the group sheet) */}
      <MemberSwimsSheet
        key={memberSelection.key}
        member={selectedMember}
        sessions={allSessions}
        places={places}
        onClose={() =>
          setMemberSelection((current) => ({ ...current, member: null }))
        }
      />
    </>
  );
}

/**
 * The group sheet's title area: emoji picker (leader-only), inline rename, and
 * the member-count / code / share row. Owns its own rename + emoji-picker
 * state and writes group metadata via updateGroupMeta.
 */
function GroupSheetHeader({
  group,
  onOpenSettings,
}: {
  group: GroupDoc;
  onOpenSettings: () => void;
}) {
  const t = useT();
  const groupIcon = group.emoji ?? "👥";

  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <div className="flex h-12 w-12 flex-none items-center justify-center rounded-full bg-wave-100 text-2xl ring-1 ring-wave-200">
        {groupIcon}
      </div>
      {/* Name + meta */}
      <div className="min-w-0 flex-1">
        <h3 className="truncate font-display text-xl font-black text-wave-900">
          {group.name}
        </h3>
        <p className="flex items-center gap-1.5 text-[11px] text-slate-500">
          {group.members.length === 1
            ? t("groups.member_one")
            : t("groups.member_many", { n: group.members.length })}
          {" · "}
          <span className="font-mono tracking-wider">{group.code}</span>
          <button
            type="button"
            onClick={() => shareInviteLink(group, t)}
            className="inline-flex items-center gap-0.5 rounded-full bg-wave-50 px-2 py-0.5 text-[10px] font-medium text-wave-600 ring-1 ring-wave-200 hover:bg-wave-100"
            title={t("groups.share_link")}
          >
            <Share2 className="h-2.5 w-2.5" />
            {t("groups.share_link")}
          </button>
        </p>
      </div>
      <button
        type="button"
        onClick={onOpenSettings}
        aria-label={t("groups.settings.open")}
        title={t("groups.settings.open")}
        className="flex-none rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
      >
        <Settings className="h-5 w-5" />
      </button>
    </div>
  );
}

/**
 * Group settings sheet, opened from the detail-sheet cog. Consolidates every
 * admin affordance (rename, emoji, competition timespan, member management)
 * plus "leave group" so the roster view stays uncluttered. The leader sees the
 * full toolset; other members see only "leave".
 */
function GroupSettingsSheet({
  group,
  open,
  isLeader,
  myUid,
  profiles,
  onClose,
  onLeave,
}: {
  group: GroupDoc;
  open: boolean;
  isLeader: boolean;
  myUid: string;
  profiles: UserDoc[];
  onClose: () => void;
  onLeave: () => void;
}) {
  const t = useT();
  const locale = useLocale((s) => s.locale);

  const [nameInput, setNameInput] = useState(group.name);
  const [savingName, setSavingName] = useState(false);
  const [timespan, setTimespan] = useState<DateRange | undefined>(
    toDateRange(group.startDate, group.endDate),
  );
  const [savingDates, setSavingDates] = useState(false);

  // Resync local inputs whenever the underlying group doc changes (e.g. a
  // concurrent edit or reopening on a different group).
  useEffect(() => {
    setNameInput(group.name);
  }, [group.id, group.name]);
  useEffect(() => {
    setTimespan(toDateRange(group.startDate, group.endDate));
  }, [group.id, group.startDate, group.endDate]);

  const rangeLabel = formatGroupRange(group, localeBcp(locale), {
    openStart: t("groups.timespan.open_start_label"),
    openEnd: t("groups.timespan.open_end_label"),
  });

  async function saveName() {
    const trimmed = nameInput.trim();
    if (!trimmed || trimmed === group.name) return;
    setSavingName(true);
    try {
      await assertTextAllowed(trimmed);
      await updateGroupMeta(group.id, { name: trimmed, emoji: group.emoji });
      toast.success(t("groups.detail.rename.success"));
    } catch (err) {
      toast.error(
        t(
          err instanceof ModerationError
            ? "moderation.name_rejected"
            : "groups.detail.rename.error",
        ),
      );
    }
    setSavingName(false);
  }

  async function saveEmoji(emoji: string) {
    try {
      await updateGroupMeta(group.id, { name: group.name, emoji });
      toast.success(t("groups.detail.rename.success"));
    } catch {
      toast.error(t("groups.detail.rename.error"));
    }
  }

  async function saveDates() {
    const { start, end } = rangeToMs(timespan);
    setSavingDates(true);
    try {
      await updateGroupMeta(group.id, {
        startDate: start ?? null,
        endDate: end ?? null,
      });
      toast.success(t("groups.settings.saved"));
    } catch {
      toast.error(t("groups.detail.rename.error"));
    }
    setSavingDates(false);
  }

  async function kick(member: UserDoc) {
    if (
      !window.confirm(
        t("groups.detail.kick_confirm", { name: member.displayName }),
      )
    )
      return;
    try {
      await kickGroupMember({ groupId: group.id, memberUid: member.uid });
      toast.success(t("groups.detail.kicked", { name: member.displayName }));
    } catch {
      toast.error(t("groups.detail.kick_error"));
    }
  }

  const groupIcon = group.emoji ?? "👥";

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      size="large"
      title={t("groups.settings.title")}
    >
      <div className="space-y-5 px-4 pb-[calc(max(env(safe-area-inset-bottom),0.5rem)+1.5rem)]">
        {isLeader ? (
          <>
            {/* Rename */}
            <div className="space-y-1.5">
              <Label>{t("groups.detail.rename")}</Label>
              <div className="flex gap-2">
                <Input
                  value={nameInput}
                  maxLength={60}
                  onChange={(e) => setNameInput(e.target.value)}
                />
                <Button
                  onClick={saveName}
                  loading={savingName}
                  disabled={
                    !nameInput.trim() || nameInput.trim() === group.name
                  }
                  icon={<Check className="h-4 w-4" />}
                />
              </div>
            </div>

            {/* Emoji */}
            <div className="space-y-1.5">
              <Label>{t("groups.detail.emoji.pick")}</Label>
              <div className="grid grid-cols-5 gap-1">
                {GROUP_EMOJIS.map((e) => {
                  const active = e === groupIcon;
                  return (
                    <button
                      type="button"
                      key={e}
                      onClick={() => saveEmoji(e)}
                      className={cn(
                        "flex h-10 items-center justify-center rounded-xl text-xl transition active:scale-95",
                        active
                          ? "bg-wave-100 ring-2 ring-wave-500"
                          : "hover:bg-wave-50",
                      )}
                    >
                      {e}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Competition timespan */}
            <div className="space-y-1.5">
              <Label>{t("groups.settings.timespan")}</Label>
              <TimespanPicker range={timespan} onRangeChange={setTimespan} />
              <Button
                size="sm"
                onClick={saveDates}
                loading={savingDates}
                className="w-full"
              >
                {t("groups.settings.saved_action")}
              </Button>
            </div>

            {/* Manage members */}
            <div className="space-y-1.5">
              <Label>{t("groups.settings.manage_members")}</Label>
              <ul className="space-y-2">
                {profiles.map((mbr) => (
                  <li
                    key={mbr.uid}
                    className="flex items-center gap-3 rounded-2xl bg-white/70 px-3 py-2 ring-1 ring-white/60"
                  >
                    <EmojiAvatar emoji={mbr.emoji} size="sm" />
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-wave-900">
                      {mbr.displayName}
                      {mbr.uid === myUid && (
                        <span className="ml-1.5 text-[10px] text-wave-500">
                          {t("common.you")}
                        </span>
                      )}
                    </span>
                    {mbr.uid !== myUid && (
                      <button
                        type="button"
                        onClick={() => kick(mbr)}
                        className="rounded-full bg-white p-1.5 text-rose-400 ring-1 ring-rose-200 hover:bg-rose-50 hover:text-rose-600"
                        title={t("groups.detail.kick")}
                        aria-label={t("groups.detail.kick")}
                      >
                        <UserMinus className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </>
        ) : (
          rangeLabel && (
            <div className="flex items-center gap-1.5 rounded-xl bg-wave-50 px-3 py-2 text-xs font-medium text-wave-700 ring-1 ring-wave-200">
              <CalendarRange className="h-3.5 w-3.5 flex-none" />
              <span>{rangeLabel}</span>
            </div>
          )
        )}

        {/* Leave group (all members) */}
        <button
          type="button"
          onClick={onLeave}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-rose-50 px-4 py-2.5 text-sm font-semibold text-rose-600 ring-1 ring-rose-200 hover:bg-rose-100"
        >
          <LogOut className="h-4 w-4" />
          {t("groups.leave_title")}
        </button>
      </div>
    </BottomSheet>
  );
}

/** One member row in the group leaderboard, tappable to open their swims. */
function MemberRow({
  member,
  stats,
  isMe,
  isFounder,
  leaderBadge,
  onSelect,
}: {
  member: UserDoc;
  stats: MemberStats | undefined;
  isMe: boolean;
  isFounder: boolean;
  /** Leaderboard badge to show on the avatar: gold for sole lead, knot for a
   *  tie, or none. */
  leaderBadge: "lead" | "tied" | null;
  onSelect: () => void;
}) {
  const t = useT();
  const s = stats ?? {
    points: 0,
    swims: 0,
    spots: new Set<string>(),
    lastSwim: 0,
    streak: 0,
  };
  const last = recency(s.lastSwim, t);
  return (
    <li className="flex cursor-pointer items-center gap-3 rounded-2xl bg-white/70 px-3 py-2.5 ring-1 ring-white/60 transition hover:bg-white/90 active:scale-[0.99]">
      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <EmojiAvatar emoji={member.emoji} size="sm">
          {leaderBadge && (
            <m.span
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{
                type: "spring",
                stiffness: 500,
                damping: 20,
              }}
              className="absolute -top-1 -right-1 text-[10px]"
              title={
                leaderBadge === "tied"
                  ? t("groups.detail.tied")
                  : t("groups.detail.lead")
              }
            >
              {leaderBadge === "tied" ? "🪢" : "🥇"}
            </m.span>
          )}
        </EmojiAvatar>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 truncate text-sm font-semibold text-wave-900">
            {member.displayName}
            {isMe && (
              <span className="text-[10px] text-wave-500">
                {t("common.you")}
              </span>
            )}
            {isFounder && (
              <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-amber-700 uppercase">
                {t("groups.founder")}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-[11px] text-slate-500">
            <span className="font-semibold text-wave-700">
              {s.points} {t("groups.detail.points")}
            </span>
            <span>·</span>
            <span className="flex items-center gap-0.5">
              <Waves className="h-2.5 w-2.5" /> {s.swims}{" "}
              {t("groups.detail.swims")}
            </span>
            <span>·</span>
            <span
              className={cn(
                "flex items-center gap-0.5",
                s.streak > 0 && "font-semibold text-orange-600",
              )}
            >
              🔥 {s.streak}
            </span>
          </div>
        </div>
        <span
          className={cn(
            "flex-none rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap",
            last.cls,
          )}
          title={t("groups.last.tooltip")}
        >
          {last.label}
        </span>
      </button>
    </li>
  );
}
