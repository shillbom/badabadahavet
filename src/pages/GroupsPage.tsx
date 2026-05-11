import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Copy,
  LogOut,
  Plus,
  X,
  UserMinus,
  MapPin,
  Waves,
  Pencil,
  Check,
} from "lucide-react";
import { useStore } from "@/store/sessions";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { toast } from "@/components/ui/Toast";
import {
  createGroup,
  joinGroupByCode,
  kickGroupMember,
  leaveGroup,
  fetchUsers,
  updateGroupMeta,
} from "@/lib/data";
import type { GroupDoc, PlaceDoc, SessionDoc, UserDoc } from "@/lib/types";
import { useT } from "@/lib/i18n";
import SwimMap from "@/components/SwimMap";

export default function GroupsPage() {
  const { user } = useAuth();
  const t = useT();
  const groups = useStore((s) => s.groups);
  const allSessions = useStore((s) => s.allSessions);
  const places = useStore((s) => s.places);
  const [groupName, setGroupName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [openGroup, setOpenGroup] = useState<GroupDoc | null>(null);

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
    if (joinCode.trim().length < 3) {
      toast.error(t("groups.join.too_short"));
      return;
    }
    setBusy(true);
    try {
      const g = await joinGroupByCode({ code: joinCode, uid: user.uid });
      if (!g) toast.error(t("groups.join.not_found"));
      else {
        toast.success(t("groups.join.success", { name: g.name }));
        setJoinCode("");
      }
    } catch {
      toast.error(t("groups.join.error.generic"));
    } finally {
      setBusy(false);
    }
  }

  function copyCode(code: string) {
    navigator.clipboard.writeText(code).then(
      () => toast.success(t("groups.code_copied")),
      () => toast.error(t("groups.copy_failed")),
    );
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
          <Button
            type="submit"
            variant="secondary"
            size="md"
            loading={busy}
            className="px-4"
          >
            {t("groups.join.button")}
          </Button>
        </div>
      </motion.form>

      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
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
                className="glass flex items-center gap-3 p-3 cursor-pointer hover:bg-white/60 transition-colors"
                onClick={() => setOpenGroup(g)}
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-wave-100 text-xl">
                  {g.emoji ?? "👥"}
                </div>
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

      <AnimatePresence>
        {openGroup ? (
          <GroupDetailSheet
            group={openGroup}
            myUid={user?.uid ?? ""}
            allSessions={allSessions}
            places={places}
            onClose={() => setOpenGroup(null)}
            onLeave={() => onLeave(openGroup.id, openGroup.name)}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function GroupDetailSheet({
  group,
  myUid,
  allSessions,
  places,
  onClose,
  onLeave,
}: {
  group: GroupDoc;
  myUid: string;
  allSessions: SessionDoc[];
  places: PlaceDoc[];
  onClose: () => void;
  onLeave: () => void;
}) {
  const t = useT();
  const isLeader = group.createdBy === myUid;
  const [profiles, setProfiles] = useState<UserDoc[]>([]);
  const [loadingProfiles, setLoadingProfiles] = useState(true);
  const [selectedMember, setSelectedMember] = useState<UserDoc | null>(null);

  // Rename state
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(group.name);
  const [savingMeta, setSavingMeta] = useState(false);

  // Emoji picker state
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);

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
    setNameInput(group.name);
  }, [group.name]);

  useEffect(() => {
    setLoadingProfiles(true);
    fetchUsers(group.members).then((users) => {
      setProfiles(users);
      setLoadingProfiles(false);
    });
  }, [group.members]);

  const memberStats = useMemo(() => {
    const memberSet = new Set(group.members);
    const map = new Map<
      string,
      { points: number; swims: number; spots: Set<string> }
    >();
    for (const uid of group.members)
      map.set(uid, { points: 0, swims: 0, spots: new Set() });
    for (const s of allSessions) {
      if (!memberSet.has(s.uid)) continue;
      const entry = map.get(s.uid)!;
      entry.points += s.points;
      entry.swims += 1;
      entry.spots.add(s.placeId);
    }
    return map;
  }, [allSessions, group.members]);

  const sortedMembers = useMemo(() => {
    return [...profiles].sort((a, b) => {
      const pa = memberStats.get(a.uid)?.points ?? 0;
      const pb = memberStats.get(b.uid)?.points ?? 0;
      return pb - pa;
    });
  }, [profiles, memberStats]);

  async function onKick(member: UserDoc) {
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

  async function saveName() {
    const trimmed = nameInput.trim();
    if (!trimmed || trimmed === group.name) {
      setEditingName(false);
      return;
    }
    setSavingMeta(true);
    try {
      await updateGroupMeta(group.id, { name: trimmed, emoji: group.emoji });
      toast.success(t("groups.detail.rename.success"));
      setEditingName(false);
    } catch {
      toast.error(t("groups.detail.rename.error"));
    } finally {
      setSavingMeta(false);
    }
  }

  async function saveEmoji(emoji: string) {
    setEmojiPickerOpen(false);
    try {
      await updateGroupMeta(group.id, { name: group.name, emoji });
      toast.success(t("groups.detail.rename.success"));
    } catch {
      toast.error(t("groups.detail.rename.error"));
    }
  }

  const groupIcon = group.emoji ?? "👥";

  return (
    <>
      {/* Backdrop */}
      <motion.div
        key="backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-[1100] bg-black/40 backdrop-blur-sm"
      />
      {/* Sheet */}
      <motion.div
        key="sheet"
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", stiffness: 320, damping: 32 }}
        className="fixed inset-x-0 bottom-0 z-[1200] mx-auto max-w-md overflow-hidden rounded-t-3xl bg-white/95 shadow-2xl backdrop-blur-sm"
        style={{ maxHeight: "85dvh" }}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="h-1 w-10 rounded-full bg-slate-300" />
        </div>
        {/* Header */}
        <div className="flex items-start justify-between px-5 pb-3 pt-1 gap-3">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            {/* Group emoji / picker trigger */}
            <div className="relative flex-none">
              <button
                disabled={!isLeader}
                onClick={() => isLeader && setEmojiPickerOpen((v) => !v)}
                className="flex h-12 w-12 items-center justify-center rounded-full bg-wave-100 text-2xl ring-1 ring-wave-200 transition hover:bg-wave-200 disabled:cursor-default"
                title={isLeader ? t("groups.detail.emoji.pick") : undefined}
              >
                {groupIcon}
              </button>
              <AnimatePresence>
                {emojiPickerOpen && (
                  <>
                    {/* Click-away backdrop, scoped within the sheet */}
                    <button
                      type="button"
                      aria-label="close"
                      onClick={() => setEmojiPickerOpen(false)}
                      className="fixed inset-0 z-[1300] cursor-default"
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
                      className="absolute left-1/2 top-full z-[1310] mt-2 -translate-x-1/2 rounded-2xl bg-white p-2 shadow-xl ring-1 ring-slate-200"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {/* Triangle pointer */}
                      <div className="absolute -top-1.5 left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 bg-white ring-1 ring-slate-200" />
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
              </AnimatePresence>
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
                  <button
                    onClick={saveName}
                    disabled={savingMeta}
                    className="rounded-full bg-wave-600 p-1.5 text-white hover:bg-wave-700 disabled:opacity-50"
                  >
                    <Check className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => setEditingName(false)}
                    className="rounded-full bg-slate-100 p-1.5 text-slate-500 hover:bg-slate-200"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <h3 className="truncate font-display text-xl font-black text-wave-900">
                    {group.name}
                  </h3>
                  {isLeader && (
                    <button
                      onClick={() => {
                        setNameInput(group.name);
                        setEditingName(true);
                      }}
                      className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              )}
              <p className="text-[11px] text-slate-500">
                {group.members.length === 1
                  ? t("groups.member_one")
                  : t("groups.member_many", { n: group.members.length })}
                {" · "}
                <span className="font-mono tracking-wider">{group.code}</span>
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

        {/* Member list */}
        <div className="overflow-y-auto px-4 pb-[max(env(safe-area-inset-bottom),1.5rem)]">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            {t("groups.detail.members")}
          </h4>
          {loadingProfiles ? (
            <div className="flex h-20 items-center justify-center">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-wave-600 border-r-transparent" />
            </div>
          ) : (
            <ul className="space-y-2 pb-4">
              {sortedMembers.map((member, i) => {
                const stats = memberStats.get(member.uid) ?? {
                  points: 0,
                  swims: 0,
                  spots: new Set(),
                };
                const isMe = member.uid === myUid;
                return (
                  <li
                    key={member.uid}
                    onClick={() => setSelectedMember(member)}
                    className="flex cursor-pointer items-center gap-3 rounded-2xl bg-white/70 px-3 py-2.5 ring-1 ring-white/60 transition hover:bg-white/90 active:scale-[0.99]"
                  >
                    <div className="relative flex h-8 w-8 flex-none items-center justify-center rounded-full bg-wave-100 text-lg">
                      {member.emoji ?? "🌊"}
                      {i === 0 && (
                        <span className="absolute -right-1 -top-1 text-[10px]">
                          🥇
                        </span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 truncate font-semibold text-wave-900 text-sm">
                        {member.displayName}
                        {isMe && (
                          <span className="text-[10px] text-wave-500">
                            {t("common.you")}
                          </span>
                        )}
                        {member.uid === group.createdBy && (
                          <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-700">
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
                        <span className="flex items-center gap-0.5">
                          <MapPin className="h-2.5 w-2.5" /> {stats.spots.size}{" "}
                          {t("groups.detail.spots")}
                        </span>
                      </div>
                    </div>
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
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-rose-50 px-4 py-2.5 text-sm font-semibold text-rose-600 ring-1 ring-rose-200 hover:bg-rose-100"
          >
            <LogOut className="h-4 w-4" />
            {t("groups.leave_title")}
          </button>
        </div>
      </motion.div>

      {/* Member-detail map overlay (stacks above the group sheet) */}
      <AnimatePresence>
        {selectedMember ? (
          <MemberMapSheet
            member={selectedMember}
            allSessions={allSessions}
            places={places}
            stats={
              memberStats.get(selectedMember.uid) ?? {
                points: 0,
                swims: 0,
                spots: new Set(),
              }
            }
            onClose={() => setSelectedMember(null)}
          />
        ) : null}
      </AnimatePresence>
    </>
  );
}

function MemberMapSheet({
  member,
  allSessions,
  places,
  stats,
  onClose,
}: {
  member: UserDoc;
  allSessions: SessionDoc[];
  places: PlaceDoc[];
  stats: { points: number; swims: number; spots: Set<string> };
  onClose: () => void;
}) {
  const t = useT();
  const memberSessions = useMemo(
    () => allSessions.filter((s) => s.uid === member.uid),
    [allSessions, member.uid],
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

  return (
    <>
      <motion.div
        key="m-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-[1300] bg-black/50 backdrop-blur-sm"
      />
      <motion.div
        key="m-sheet"
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", stiffness: 320, damping: 32 }}
        className="fixed inset-x-0 bottom-0 z-[1400] mx-auto flex max-w-md flex-col overflow-hidden rounded-t-3xl bg-white/95 shadow-2xl backdrop-blur-sm"
        style={{ maxHeight: "90dvh" }}
      >
        <div className="flex justify-center pt-3 pb-1">
          <div className="h-1 w-10 rounded-full bg-slate-300" />
        </div>
        <div className="flex items-center justify-between gap-3 px-5 pb-3 pt-1">
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
                  spots: stats.spots.size,
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
        <div className="relative px-3 pb-[max(env(safe-area-inset-bottom),1rem)]">
          {memberPlaces.length === 0 ? (
            <div className="flex h-[60dvh] items-center justify-center rounded-2xl bg-white/60 text-sm text-slate-500">
              {t("groups.member.no_swims")}
            </div>
          ) : (
            <div className="h-[60dvh] overflow-hidden rounded-2xl ring-1 ring-white/60">
              <SwimMap
                places={memberPlaces}
                sessionsByPlace={sessionsByPlace}
                linkToSpot
              />
            </div>
          )}
        </div>
      </motion.div>
    </>
  );
}
