import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router";
import { motion, AnimatePresence } from "framer-motion";
import {
  Copy,
  LogOut,
  Plus,
  Share2,
  X,
  UserMinus,
  Waves,
  Pencil,
  Check,
  Merge,
} from "lucide-react";
import { useStore } from "@/store/sessions";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/ui/Button";
import SegmentedControl from "@/components/ui/SegmentedControl";
import { Input, Label } from "@/components/ui/Input";
import { toast } from "@/components/ui/Toast";
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
import type { GroupDoc, PlaceDoc, SessionDoc, UserDoc } from "@/lib/types";
import { useT } from "@/lib/i18n";
import { longestStreakInYear } from "@/lib/streak";
import { DAY_MS, dayStartMs as dayStart } from "@/lib/date";
import { cn } from "@/lib/utils";
import MemberSwimsSheet from "@/components/MemberSwimsSheet";
import EmojiAvatar from "@/components/EmojiAvatar";
import BottomSheet from "@/components/BottomSheet";

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

export default function GroupsPage() {
  const { user } = useAuth();
  const t = useT();
  const groups = useStore((s) => s.groups);
  const places = useStore((s) => s.places);
  const [groupName, setGroupName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [openGroup, setOpenGroup] = useState<GroupDoc | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  // Pending join confirmation: the group preview returned by lookupGroupByCode.
  const [pendingJoin, setPendingJoin] = useState<{
    id: string;
    name: string;
    emoji: string | null;
    memberCount: number;
    code: string;
  } | null>(null);

  // Keep the last preview so the confirm sheet still has content to render
  // while it animates closed (`open` flips to false before unmount).
  const lastJoinRef = useRef(pendingJoin);
  if (pendingJoin) lastJoinRef.current = pendingJoin;
  const join = pendingJoin ?? lastJoinRef.current;

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
        return;
      }
      // Already a member? Tell them immediately without showing the dialog.
      if (groups.some((g) => g.id === preview.id)) {
        toast.info(t("groups.join.already_member"));
        return;
      }
      setPendingJoin({ ...preview, code: code.trim().toUpperCase() });
    } catch {
      toast.error(t("groups.join.error.generic"));
    } finally {
      setBusy(false);
    }
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
    } finally {
      setBusy(false);
    }
  }

  // Auto-trigger confirmation from ?join=CODE deep-link on mount.
  useEffect(() => {
    const code = searchParams.get("join");
    if (code) {
      setSearchParams({}, { replace: true });
      // Small delay so the page is fully rendered before the dialog appears.
      setTimeout(() => lookupAndConfirm(code), 350);
    }
    // Only run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    if (!groupName.trim()) {
      toast.error(t("groups.create.error.empty"));
      return;
    }
    setBusy(true);
    try {
      const g = await createGroup({ name: groupName, uid: user.uid });
      toast.success(t("groups.create.success", { name: g.name, code: g.code }));
      setGroupName("");
    } catch {
      toast.error(t("groups.create.error.generic"));
    } finally {
      setBusy(false);
    }
  }

  async function onJoin(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    await lookupAndConfirm(joinCode);
  }

  function copyCode(code: string) {
    navigator.clipboard.writeText(code).then(
      () => toast.success(t("groups.code_copied")),
      () => toast.error(t("groups.copy_failed")),
    );
  }

  function shareInviteLink(group: GroupDoc) {
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

  async function onLeave(groupId: string, name: string) {
    if (!user) return;
    if (!window.confirm(t("groups.leave_confirm", { name }))) return;
    try {
      await leaveGroup({ groupId, uid: user.uid });
      toast.success(t("groups.left", { name }));
      if (openGroup?.id === groupId) setOpenGroup(null);
    } catch {
      toast.error(t("groups.leave.error.generic"));
    }
  }

  // Keep openGroup in sync with live store updates (e.g. after a kick).
  useEffect(() => {
    if (!openGroup) return;
    const live = groups.find((g) => g.id === openGroup.id);
    if (!live) setOpenGroup(null);
    else if (live !== openGroup) setOpenGroup(live);
  }, [groups, openGroup]);

  return (
    <div className="px-4 pt-2">
      <h2 className="mb-3 font-display text-2xl font-black text-wave-900">
        {t("groups.title")}
      </h2>

      <motion.form
        onSubmit={onCreate}
        layout
        className="glass mb-3 space-y-3 p-4"
      >
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
      </motion.form>

      <motion.form
        onSubmit={onJoin}
        layout
        className="glass mb-5 space-y-3 p-4"
      >
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
      </motion.form>

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
        <ul className="space-y-2">
          <AnimatePresence initial={false}>
            {groups.map((g) => (
              <motion.li
                key={g.id}
                layout
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4, scale: 0.97 }}
                className="glass flex cursor-pointer items-center gap-3 p-3 transition-colors hover:bg-white/60"
                onClick={() => setOpenGroup(g)}
              >
                <EmojiAvatar emoji={g.emoji ?? "👥"} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold text-wave-900">
                    {g.name}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {g.members.length === 1
                      ? t("groups.member_one")
                      : t("groups.member_many", { n: g.members.length })}
                    {g.createdBy === user?.uid
                      ? ` · ${t("groups.founder")}`
                      : ""}
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    copyCode(g.code);
                  }}
                  className="flex items-center gap-1 rounded-full bg-white/80 px-3 py-1 font-mono text-sm font-bold tracking-widest text-wave-800 ring-1 ring-wave-200 hover:bg-white"
                >
                  {g.code}
                  <Copy className="h-3 w-3" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    shareInviteLink(g);
                  }}
                  className="rounded-full bg-white/70 p-2 text-wave-600 ring-1 ring-wave-200 hover:bg-wave-50 hover:text-wave-700"
                  aria-label={t("groups.share_link")}
                  title={t("groups.share_link")}
                >
                  <Share2 className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onLeave(g.id, g.name);
                  }}
                  className="rounded-full bg-white/70 p-2 text-slate-500 ring-1 ring-slate-200 hover:bg-rose-50 hover:text-rose-600"
                  aria-label={t("groups.leave_aria", { name: g.name })}
                  title={t("groups.leave_title")}
                >
                  <LogOut className="h-3.5 w-3.5" />
                </button>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}

      <GroupDetailSheet
        group={openGroup}
        myUid={user?.uid ?? ""}
        places={places}
        onClose={() => setOpenGroup(null)}
        onLeave={() => {
          if (openGroup) onLeave(openGroup.id, openGroup.name);
        }}
      />

      {/* Join confirmation dialog */}
      <BottomSheet
        size="small"
        open={!!pendingJoin}
        onClose={() => !busy && setPendingJoin(null)}
      >
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
                onClick={() => setPendingJoin(null)}
                disabled={busy}
              >
                {t("common.cancel")}
              </Button>
              <Button className="flex-1" loading={busy} onClick={confirmJoin}>
                {t("groups.join.confirm.button")}
              </Button>
            </div>
          </div>
        ) : null}
      </BottomSheet>
    </div>
  );
}

function GroupDetailSheet({
  group,
  myUid,
  places,
  onClose,
  onLeave,
}: {
  group: GroupDoc | null;
  myUid: string;
  places: PlaceDoc[];
  onClose: () => void;
  onLeave: () => void;
}) {
  const t = useT();

  // Keep the last group around so the sheet still renders content while it
  // animates closed (`group` flips to null before the sheet unmounts).
  const lastRef = useRef<GroupDoc | null>(group);
  if (group) lastRef.current = group;
  const shown = group ?? lastRef.current;

  const [allSessions, setAllSessions] = useState<SessionDoc[]>([]);
  const [sortBy, setSortBy] = useState<"points" | "recent" | "streak">(
    "points",
  );

  // Every groups snapshot delivers a fresh `members` array reference even
  // when nobody joined or left, and the parent re-syncs `group` to the live
  // store object on each one. Key the member-scoped effects on the
  // membership *content* so unrelated group updates don't tear down the
  // sessions listener or re-fetch every member's profile.
  const membersKey = group?.members.join("\n");

  useEffect(() => {
    if (!group) return;
    // Current year only — the board compares this season, and the query
    // stays bounded as members' histories grow.
    return watchMemberSessions(group.members, setAllSessions);
  }, [membersKey]);

  function shareInviteLink() {
    if (!shown) return;
    const url = `${window.location.origin}/groups?join=${shown.code}`;
    if (navigator.share) {
      navigator
        .share({
          title: t("groups.share_title", { name: shown.name }),
          text: t("groups.share_text", { code: shown.code }),
          url,
        })
        .catch(() => {});
    } else {
      navigator.clipboard.writeText(url).then(
        () => toast.success(t("groups.link_copied")),
        () => toast.error(t("groups.copy_failed")),
      );
    }
  }
  const isLeader = shown?.createdBy === myUid;
  const [profiles, setProfiles] = useState<UserDoc[]>([]);
  const [loadingProfiles, setLoadingProfiles] = useState(true);
  const [selectedMember, setSelectedMember] = useState<UserDoc | null>(null);

  // Rename state
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(shown?.name ?? "");
  const [savingMeta, setSavingMeta] = useState(false);

  // Emoji picker state
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const emojiTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [pickerPos, setPickerPos] = useState<{
    top: number;
    left: number;
  } | null>(null);

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

  useEffect(() => {
    if (shown) setNameInput(shown.name);
  }, [shown?.name]);

  useEffect(() => {
    if (!group) return;
    setLoadingProfiles(true);
    fetchUsers(group.members).then((users) => {
      setProfiles(users);
      setLoadingProfiles(false);
    });
  }, [membersKey]);

  const memberStats = useMemo(() => {
    const members = shown?.members ?? [];
    const memberSet = new Set(members);
    const acc = new Map<
      string,
      {
        points: number;
        swims: number;
        spots: Set<string>;
        lastSwim: number;
        dates: number[];
      }
    >();
    for (const uid of members)
      acc.set(uid, {
        points: 0,
        swims: 0,
        spots: new Set(),
        lastSwim: 0,
        dates: [],
      });
    for (const s of allSessions) {
      if (!memberSet.has(s.uid)) continue;
      const entry = acc.get(s.uid)!;
      entry.points += s.points;
      entry.swims += 1;
      entry.spots.add(s.placeId);
      if (s.date > entry.lastSwim) entry.lastSwim = s.date;
      entry.dates.push(s.date);
    }
    const map = new Map<
      string,
      {
        points: number;
        swims: number;
        spots: Set<string>;
        lastSwim: number;
        streak: number;
      }
    >();
    for (const [uid, e] of acc)
      map.set(uid, {
        points: e.points,
        swims: e.swims,
        spots: e.spots,
        lastSwim: e.lastSwim,
        // The year's best streak, not the live one — keeps the group
        // comparison fair for members whose streak happens to be broken today.
        streak: longestStreakInYear(e.dates, new Date().getFullYear()),
      });
    return map;
  }, [allSessions, shown?.members]);

  const sortedMembers = useMemo(() => {
    return [...profiles].sort((a, b) => {
      const sa = memberStats.get(a.uid);
      const sb = memberStats.get(b.uid);
      if (sortBy === "recent") return (sb?.lastSwim ?? 0) - (sa?.lastSwim ?? 0);
      if (sortBy === "streak")
        return (
          (sb?.streak ?? 0) - (sa?.streak ?? 0) ||
          (sb?.lastSwim ?? 0) - (sa?.lastSwim ?? 0)
        );
      return (sb?.points ?? 0) - (sa?.points ?? 0);
    });
  }, [profiles, memberStats, sortBy]);

  // Whoever's on top of the points board — but only a single member, and only
  // when they actually beat everyone else. With nobody on the board yet (0
  // points) there's no "lead" to award, and when two or more share the top
  // score it's a tie, not a lead — handled separately below.
  const topPoints = sortedMembers.length
    ? (memberStats.get(sortedMembers[0].uid)?.points ?? 0)
    : 0;
  const leaderUids = useMemo(() => {
    if (topPoints <= 0) return new Set<string>();
    return new Set(
      sortedMembers
        .filter((m) => (memberStats.get(m.uid)?.points ?? 0) === topPoints)
        .map((m) => m.uid),
    );
  }, [sortedMembers, memberStats, topPoints]);
  const tiedForLead = leaderUids.size > 1;

  async function onKick(member: UserDoc) {
    if (!shown) return;
    if (
      !window.confirm(
        t("groups.detail.kick_confirm", { name: member.displayName }),
      )
    )
      return;
    try {
      await kickGroupMember({ groupId: shown.id, memberUid: member.uid });
      toast.success(t("groups.detail.kicked", { name: member.displayName }));
    } catch {
      toast.error(t("groups.detail.kick_error"));
    }
  }

  async function saveName() {
    if (!shown) return;
    const trimmed = nameInput.trim();
    if (!trimmed || trimmed === shown.name) {
      setEditingName(false);
      return;
    }
    setSavingMeta(true);
    try {
      await updateGroupMeta(shown.id, { name: trimmed, emoji: shown.emoji });
      toast.success(t("groups.detail.rename.success"));
      setEditingName(false);
    } catch {
      toast.error(t("groups.detail.rename.error"));
    } finally {
      setSavingMeta(false);
    }
  }

  async function saveEmoji(emoji: string) {
    if (!shown) return;
    setEmojiPickerOpen(false);
    try {
      await updateGroupMeta(shown.id, { name: shown.name, emoji });
      toast.success(t("groups.detail.rename.success"));
    } catch {
      toast.error(t("groups.detail.rename.error"));
    }
  }

  const groupIcon = shown?.emoji ?? "👥";

  const header =
    shown != null ? (
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {/* Group emoji / picker trigger */}
        <div className="relative flex-none">
          <button
            ref={emojiTriggerRef}
            disabled={!isLeader}
            onClick={() => {
              if (!isLeader) return;
              if (!emojiPickerOpen && emojiTriggerRef.current) {
                const r = emojiTriggerRef.current.getBoundingClientRect();
                setPickerPos({
                  top: r.bottom + 8,
                  left: r.left + r.width / 2,
                });
              }
              setEmojiPickerOpen((v) => !v);
            }}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-wave-100 text-2xl ring-1 ring-wave-200 transition hover:bg-wave-200 disabled:cursor-default"
            title={isLeader ? t("groups.detail.emoji.pick") : undefined}
          >
            {groupIcon}
          </button>
          {createPortal(
            <AnimatePresence>
              {emojiPickerOpen && pickerPos && (
                <>
                  {/* Click-away backdrop */}
                  <button
                    type="button"
                    aria-label="close"
                    onClick={() => setEmojiPickerOpen(false)}
                    className="fixed inset-0 z-[1300] cursor-default bg-transparent"
                  />
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9, y: -4 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.9, y: -4 }}
                    transition={{
                      type: "spring",
                      stiffness: 380,
                      damping: 28,
                    }}
                    style={{
                      position: "fixed",
                      top: pickerPos.top,
                      left: pickerPos.left,
                      transform: "translateX(-50%)",
                    }}
                    className="z-[1310] w-[14.5rem] rounded-2xl bg-white p-2 shadow-xl ring-1 ring-slate-200"
                  >
                    {/* Triangle pointer */}
                    <div className="relative grid grid-cols-5 gap-1">
                      {GROUP_EMOJIS.map((e) => {
                        const active = e === groupIcon;
                        return (
                          <button
                            key={e}
                            onClick={() => saveEmoji(e)}
                            className={`flex h-10 w-10 items-center justify-center rounded-xl text-xl transition active:scale-95 ${
                              active
                                ? "bg-wave-100 ring-2 ring-wave-500"
                                : "hover:bg-wave-50"
                            }`}
                          >
                            {e}
                          </button>
                        );
                      })}
                    </div>
                  </motion.div>
                </>
              )}
            </AnimatePresence>,
            document.body,
          )}
        </div>
        {/* Name / rename */}
        <div className="min-w-0 flex-1">
          {editingName && isLeader ? (
            <div className="flex items-center gap-1.5">
              <input
                autoFocus
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveName();
                  if (e.key === "Escape") setEditingName(false);
                }}
                maxLength={60}
                className="min-w-0 flex-1 rounded-lg border border-wave-300 bg-white px-2 py-1 font-display text-lg font-black text-wave-900 outline-none focus:ring-2 focus:ring-wave-400"
              />
              <Button
                size="icon-sm"
                onClick={saveName}
                loading={savingMeta}
                icon={<Check className="h-3.5 w-3.5" />}
              />
              <button
                onClick={() => setEditingName(false)}
                className="rounded-full bg-slate-100 p-2 text-slate-500 hover:bg-slate-200"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <h3 className="truncate font-display text-xl font-black text-wave-900">
                {shown.name}
              </h3>
              {isLeader && (
                <button
                  onClick={() => {
                    setNameInput(shown.name);
                    setEditingName(true);
                  }}
                  className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}
          <p className="flex items-center gap-1.5 text-[11px] text-slate-500">
            {shown.members.length === 1
              ? t("groups.member_one")
              : t("groups.member_many", { n: shown.members.length })}
            {" · "}
            <span className="font-mono tracking-wider">{shown.code}</span>
            <button
              onClick={shareInviteLink}
              className="inline-flex items-center gap-0.5 rounded-full bg-wave-50 px-2 py-0.5 text-[10px] font-medium text-wave-600 ring-1 ring-wave-200 hover:bg-wave-100"
              title={t("groups.share_link")}
            >
              <Share2 className="h-2.5 w-2.5" />
              {t("groups.share_link")}
            </button>
          </p>
        </div>
      </div>
    ) : null;

  return (
    <>
      <BottomSheet open={!!group} onClose={onClose} size="large" title={header}>
        {shown ? (
          <div className="px-4 pb-[calc(max(env(safe-area-inset-bottom),0.5rem)+1.5rem)]">
            <h4 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
              {t("groups.detail.members")}
            </h4>
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
            {loadingProfiles ? (
              <div className="flex h-20 items-center justify-center">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-wave-600 border-r-transparent" />
              </div>
            ) : (
              <ul className="space-y-2 pb-4">
                {sortedMembers.map((member) => {
                  const stats = memberStats.get(member.uid) ?? {
                    points: 0,
                    swims: 0,
                    spots: new Set<string>(),
                    lastSwim: 0,
                    streak: 0,
                  };
                  const isMe = member.uid === myUid;
                  const last = recency(stats.lastSwim, t);
                  return (
                    <li
                      key={member.uid}
                      onClick={() => setSelectedMember(member)}
                      className="flex cursor-pointer items-center gap-3 rounded-2xl bg-white/70 px-3 py-2.5 ring-1 ring-white/60 transition hover:bg-white/90 active:scale-[0.99]"
                    >
                      <EmojiAvatar emoji={member.emoji} size="sm">
                        {sortBy === "points" && leaderUids.has(member.uid) && (
                          <motion.span
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            transition={{
                              type: "spring",
                              stiffness: 500,
                              damping: 20,
                            }}
                            className="absolute -top-1 -right-1 text-[10px]"
                            title={
                              tiedForLead
                                ? t("groups.detail.tied")
                                : t("groups.detail.lead")
                            }
                          >
                            {tiedForLead ? "🪢" : "🥇"}
                          </motion.span>
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
                          {member.uid === shown.createdBy && (
                            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-amber-700 uppercase">
                              {t("groups.founder")}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-slate-500">
                          <span className="font-semibold text-wave-700">
                            {stats.points} {t("groups.detail.points")}
                          </span>
                          <span>·</span>
                          <span className="flex items-center gap-0.5">
                            <Waves className="h-2.5 w-2.5" /> {stats.swims}{" "}
                            {t("groups.detail.swims")}
                          </span>
                          <span>·</span>
                          <span
                            className={cn(
                              "flex items-center gap-0.5",
                              stats.streak > 0 &&
                                "font-semibold text-orange-600",
                            )}
                          >
                            🔥 {stats.streak}
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
                      {isLeader && !isMe ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onKick(member);
                          }}
                          className="rounded-full bg-white p-1.5 text-rose-400 ring-1 ring-rose-200 hover:bg-rose-50 hover:text-rose-600"
                          title={t("groups.detail.kick")}
                          aria-label={t("groups.detail.kick")}
                        >
                          <UserMinus className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
            {/* Leave button at bottom */}
            <button
              onClick={onLeave}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-2xl bg-rose-50 px-4 py-2.5 text-sm font-semibold text-rose-600 ring-1 ring-rose-200 hover:bg-rose-100"
            >
              <LogOut className="h-4 w-4" />
              {t("groups.leave_title")}
            </button>
          </div>
        ) : null}
      </BottomSheet>

      {/* Member-detail map overlay (stacks above the group sheet) */}
      <MemberSwimsSheet
        member={selectedMember}
        sessions={allSessions}
        places={places}
        onClose={() => setSelectedMember(null)}
      />
    </>
  );
}
