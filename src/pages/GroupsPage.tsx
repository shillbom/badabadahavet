import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Copy, LogOut, Plus, Users } from "lucide-react";
import { useStore } from "@/store/sessions";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { toast } from "@/components/ui/Toast";
import { createGroup, joinGroupByCode, leaveGroup } from "@/lib/data";

export default function GroupsPage() {
  const { user } = useAuth();
  const groups = useStore((s) => s.groups);
  const [groupName, setGroupName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [busy, setBusy] = useState(false);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    if (!groupName.trim()) {
      toast.error("Pick a group name");
      return;
    }
    setBusy(true);
    try {
      const g = await createGroup({ name: groupName, uid: user.uid });
      toast.success(`Group "${g.name}" created · code ${g.code}`);
      setGroupName("");
    } catch (err) {
      toast.error((err as Error).message ?? "Couldn't create");
    } finally {
      setBusy(false);
    }
  }

  async function onJoin(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    if (joinCode.trim().length < 3) {
      toast.error("That code looks too short");
      return;
    }
    setBusy(true);
    try {
      const g = await joinGroupByCode({ code: joinCode, uid: user.uid });
      if (!g) toast.error("No group with that code");
      else {
        toast.success(`Joined ${g.name}`);
        setJoinCode("");
      }
    } catch (err) {
      toast.error((err as Error).message ?? "Couldn't join");
    } finally {
      setBusy(false);
    }
  }

  function copyCode(code: string) {
    navigator.clipboard.writeText(code).then(
      () => toast.success("Code copied"),
      () => toast.error("Copy failed"),
    );
  }

  async function onLeave(groupId: string, name: string) {
    if (!user) return;
    if (!window.confirm(`Leave "${name}"?`)) return;
    try {
      await leaveGroup({ groupId, uid: user.uid });
      toast.success(`Left ${name}`);
    } catch (err) {
      toast.error((err as Error).message ?? "Couldn't leave");
    }
  }

  return (
    <div className="px-4 pt-2">
      <h2 className="mb-3 font-display text-2xl font-black text-wave-900">
        Groups
      </h2>

      <motion.form
        onSubmit={onCreate}
        layout
        className="glass mb-3 space-y-3 p-4"
      >
        <Label>Create a new group</Label>
        <div className="flex gap-2">
          <Input
            placeholder="e.g. Wednesday dippers"
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
        <Label>Join with a code</Label>
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
            Join
          </Button>
        </div>
      </motion.form>

      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Your groups
        </h3>
        <span className="text-[11px] text-slate-400">
          You can be in as many as you like
        </span>
      </div>
      {groups.length === 0 ? (
        <div className="rounded-2xl bg-white/60 p-6 text-center text-sm text-slate-500">
          No groups yet — create one and share the code.
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
                className="glass flex items-center gap-3 p-3"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-wave-100 text-wave-700">
                  <Users className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold text-wave-900">
                    {g.name}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {g.members.length} member{g.members.length === 1 ? "" : "s"}
                    {g.createdBy === user?.uid ? " · founder" : ""}
                  </div>
                </div>
                <button
                  onClick={() => copyCode(g.code)}
                  className="flex items-center gap-1 rounded-full bg-white/80 px-3 py-1 font-mono text-sm font-bold tracking-widest text-wave-800 ring-1 ring-wave-200 hover:bg-white"
                >
                  {g.code}
                  <Copy className="h-3 w-3" />
                </button>
                <button
                  onClick={() => onLeave(g.id, g.name)}
                  className="rounded-full bg-white/70 p-2 text-slate-500 ring-1 ring-slate-200 hover:bg-rose-50 hover:text-rose-600"
                  aria-label={`Leave ${g.name}`}
                  title="Leave group"
                >
                  <LogOut className="h-3.5 w-3.5" />
                </button>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </div>
  );
}
