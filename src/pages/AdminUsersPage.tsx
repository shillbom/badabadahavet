import { useEffect, useState } from "react";
import { Navigate } from "react-router";
import { motion } from "framer-motion";
import { Ban, ShieldAlert } from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { useIsAdmin } from "@/lib/adminMode";
import { useT } from "@/lib/i18n";
import { fetchAllUsers, fetchBannedUsers, banUser } from "@/lib/data";
import { sumScores } from "@/lib/scoring";
import { toast } from "@/components/ui/Toast";
import BackButton from "@/components/ui/BackButton";
import type { BannedUser, UserDoc } from "@/lib/types";

export default function AdminUsersPage() {
  const { user, profile } = useAuth();
  const isAdmin = useIsAdmin();
  const t = useT();

  const [users, setUsers] = useState<UserDoc[] | null>(null);
  const [banned, setBanned] = useState<BannedUser[]>([]);
  const [confirmUid, setConfirmUid] = useState<string | null>(null);
  const [busyUid, setBusyUid] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    let alive = true;
    void (async () => {
      const [u, b] = await Promise.all([fetchAllUsers(), fetchBannedUsers()]);
      if (!alive) return;
      setUsers(u);
      setBanned(b);
    })();
    return () => {
      alive = false;
    };
  }, [isAdmin]);

  // Only admins with admin mode on may see this page; everyone else (including
  // admins browsing as normal users) is bounced home once the profile loads.
  if (profile && !isAdmin) return <Navigate to="/" replace />;

  async function onBan(target: UserDoc) {
    setBusyUid(target.uid);
    try {
      await banUser(target.uid);
      toast.success(t("admin.users.ban.success", { name: target.displayName }));
      setUsers((prev) => prev?.filter((u) => u.uid !== target.uid) ?? null);
      setConfirmUid(null);
      // Refresh the banned list so the newly-banned user shows up.
      setBanned(await fetchBannedUsers());
    } catch {
      toast.error(t("admin.users.ban.error"));
    } finally {
      setBusyUid(null);
    }
  }

  return (
    <div className="px-4 pt-2 pb-12">
      <div className="mb-4 flex items-center gap-2">
        <BackButton />
        <h2 className="font-display text-2xl font-black text-wave-900">
          {t("admin.users.title")}
        </h2>
      </div>

      {users === null ? (
        <div className="flex h-40 items-center justify-center">
          <div className="h-7 w-7 animate-spin rounded-full border-2 border-wave-600 border-r-transparent" />
        </div>
      ) : (
        <>
          <p className="mb-3 text-xs font-semibold tracking-wide text-slate-500 uppercase">
            {t("admin.users.count", { n: users.length })}
          </p>

          {users.length === 0 ? (
            <p className="text-sm text-slate-500">{t("admin.users.empty")}</p>
          ) : (
            <ul className="space-y-2">
              {users.map((u) => {
                const isSelf = u.uid === user?.uid;
                const points = sumScores(u.scores);
                const confirming = confirmUid === u.uid;
                const busy = busyUid === u.uid;
                return (
                  <li
                    key={u.uid}
                    className="glass flex flex-col gap-2 p-3 sm:flex-row sm:items-center"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <span className="text-xl">{u.emoji ?? "🌊"}</span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate font-display text-sm font-bold text-wave-900">
                            {u.displayName}
                          </span>
                          {u.isAdmin ? (
                            <span className="rounded-full bg-amber-500 px-1.5 py-0.5 text-[9px] font-bold tracking-widest text-white uppercase">
                              {t("admin.label")}
                            </span>
                          ) : null}
                          {isSelf ? (
                            <span className="rounded-full bg-wave-100 px-1.5 py-0.5 text-[9px] font-bold tracking-widest text-wave-700 uppercase">
                              {t("admin.users.you")}
                            </span>
                          ) : null}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {t("admin.users.points", { n: points })}
                        </div>
                      </div>
                    </div>

                    {/* Admins can't ban themselves or other admins. */}
                    {!isSelf && !u.isAdmin ? (
                      confirming ? (
                        <div className="flex flex-col gap-2 rounded-xl border border-rose-200 bg-rose-50/80 p-2 sm:w-auto">
                          <p className="text-xs leading-snug text-rose-800">
                            {t("admin.users.ban.confirm", {
                              name: u.displayName,
                            })}
                          </p>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => setConfirmUid(null)}
                              disabled={busy}
                              className="flex-1 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 disabled:opacity-50"
                            >
                              {t("common.cancel")}
                            </button>
                            <button
                              type="button"
                              onClick={() => onBan(u)}
                              disabled={busy}
                              className="flex-1 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-bold text-white shadow disabled:opacity-50"
                            >
                              {busy
                                ? t("admin.users.banning")
                                : t("admin.users.ban.confirm_button")}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmUid(u.uid)}
                          className="flex items-center justify-center gap-1.5 rounded-xl border border-rose-200 bg-white/70 px-3 py-1.5 text-xs font-semibold text-rose-600 transition hover:bg-rose-50"
                        >
                          <Ban className="h-3.5 w-3.5" />
                          {t("admin.users.ban")}
                        </button>
                      )
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}

          <div className="mt-8">
            <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">
              <ShieldAlert className="h-3.5 w-3.5" />
              {t("admin.users.banned_title")}
            </h3>
            {banned.length === 0 ? (
              <p className="text-sm text-slate-500">
                {t("admin.users.banned_empty")}
              </p>
            ) : (
              <motion.ul
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="space-y-2"
              >
                {banned.map((b) => (
                  <li
                    key={b.uid}
                    className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white/60 p-3"
                  >
                    <Ban className="h-4 w-4 flex-none text-rose-500" />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-slate-700">
                        {b.displayName ?? b.email ?? b.uid}
                      </div>
                      {b.email ? (
                        <div className="truncate text-[11px] text-slate-400">
                          {b.email}
                        </div>
                      ) : null}
                    </div>
                  </li>
                ))}
              </motion.ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
