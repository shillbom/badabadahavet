import { useState, useTransition } from "react";
import { Link, useNavigate } from "react-router";
import { m, AnimatePresence } from "framer-motion";
import {
  Award,
  CalendarHeart,
  Check,
  ChevronRight,
  Clock,
  Compass,
  Flame,
  History as HistoryIcon,
  Info,
  Lock,
  LogOut,
  MapPin,
  Pencil,
  Snowflake,
  Sparkles,
  Star,
  Trash2,
  Trophy,
  ShieldCheck,
  X,
} from "lucide-react";
import { updateProfile } from "firebase/auth";
import { auth } from "@/firebase";
import { useAuth } from "@/auth/AuthContext";
import { useStore } from "@/store/sessions";
import {
  updateUserBorder,
  updateUserDisplayName,
  updateUserEmoji,
  updateUserHomeCountry,
  updateUserLocale,
} from "@/lib/data";
import { useLocale } from "@/lib/i18n";
import { useAdminMode, useIsRealAdmin } from "@/lib/adminMode";
import { assertTextAllowed, ModerationError } from "@/lib/moderation";
import { assertUsernameClean } from "@/lib/username";
import { COUNTRIES, flagEmoji } from "@/lib/countries";
import { ACHIEVEMENTS } from "@/lib/achievements";
import {
  BORDERS,
  isBorderUnlocked,
  resolveBorder,
  type Border,
} from "@/lib/borders";
import { sumScores } from "@/lib/scoring";
import type { MyStats } from "@/lib/stats";
import { formatDate, cn } from "@/lib/utils";
import { monthShort, useT } from "@/lib/i18n";
import { Button } from "@/components/ui/Button";
import Stat from "@/components/ui/Stat";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { Input } from "@/components/ui/Input";
import { toast } from "@/components/ui/toastStore";
import BackButton from "@/components/ui/BackButton";

const EMOJI_POOL = [
  "🐬",
  "🦭",
  "🐟",
  "🦦",
  "🐳",
  "🪼",
  "🐠",
  "🦑",
  "🐢",
  "🦞",
  "🐙",
  "🦈",
  "🐧",
  "🦆",
  "🦀",
  "🪴",
];

export default function ProfilePage() {
  const { user, profile } = useAuth();
  const t = useT();
  const myStats = useStore((s) => s.myStats);
  const unlockedAchievements = useStore((s) => s.unlockedAchievements);

  const isRealAdmin = useIsRealAdmin();
  const adminMode = useAdminMode((s) => s.adminMode);
  const isAdmin = isRealAdmin && adminMode;
  const achievementCount = unlockedAchievements.size;
  const myBorder = resolveBorder(
    profile?.selectedBorder,
    achievementCount,
    unlockedAchievements,
  );

  const actions = useProfileActions(user?.uid);

  return (
    <div className="px-4 pt-2 pb-12">
      <div className="mb-5 flex items-center gap-2">
        <BackButton />
        <h2 className="font-display text-2xl font-black text-wave-900">
          {t("profile.title")}
        </h2>
      </div>

      <ProfileHeader
        displayName={profile?.displayName}
        emoji={profile?.emoji}
        border={myBorder}
        achievementCount={achievementCount}
        onSaveName={actions.saveName}
        onPickEmoji={actions.pickEmoji}
        nameBusy={actions.nameBusy}
      />

      <ProfileSettings
        homeCountry={profile?.homeCountry}
        onPickHomeCountry={actions.pickHomeCountry}
      />

      {/* Stats */}
      <div className="mb-4 grid grid-cols-4 gap-2">
        <MiniCard
          icon={<Trophy className="h-3.5 w-3.5" />}
          label={t("map.stat.points")}
          value={
            profile?.scores ? sumScores(profile.scores) : myStats.totalPoints
          }
        />
        <MiniCard
          icon={<Flame className="h-3.5 w-3.5" />}
          label={t("profile.stat.swims")}
          value={myStats.totalSwims}
        />
        <MiniCard
          icon={<MapPin className="h-3.5 w-3.5" />}
          label={t("map.stat.spots")}
          value={myStats.uniquePlaces}
        />
        <MiniCard
          icon={<Snowflake className="h-3.5 w-3.5" />}
          label={t("profile.stat.winter")}
          value={myStats.winterSwims}
        />
      </div>

      {/* Border picker — choose any frame you've unlocked (or turn it off). */}
      {achievementCount > 0 ? (
        <BorderPicker
          emoji={profile?.emoji ?? "🌊"}
          selectedId={myBorder.id}
          achievementCount={achievementCount}
          unlocked={unlockedAchievements}
          onPick={actions.pickBorder}
        />
      ) : null}

      {/* Shortcuts */}
      {myStats.totalSwims > 0 ? (
        <div className="mb-4 grid grid-cols-2 gap-2">
          <Link
            to="/recap"
            className="glass flex items-center gap-2 bg-gradient-to-br from-amber-50 via-white to-wave-50 p-3"
          >
            <Sparkles className="h-5 w-5 text-amber-500" />
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-semibold tracking-wide text-slate-500 uppercase">
                {t("map.recap.label")}
              </div>
              <div className="font-display text-sm font-bold text-wave-900">
                {t("map.recap.cta", { year: new Date().getFullYear() })}
              </div>
            </div>
          </Link>
          <Link
            to="/achievements"
            className="glass flex items-center gap-2 p-3"
          >
            <Award className="h-5 w-5 text-amber-500" />
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-semibold tracking-wide text-slate-500 uppercase">
                {t("map.achievements.label")}
              </div>
              <div className="font-display text-sm font-bold text-wave-900">
                {t("map.achievements.count", {
                  n: unlockedAchievements.size,
                  total: ACHIEVEMENTS.length,
                })}
              </div>
            </div>
          </Link>
        </div>
      ) : null}

      {/* History shortcut — History isn't in the bottom nav anymore, so
          make sure it stays discoverable from the profile. */}
      <Link to="/history" className="glass mb-4 flex items-center gap-2 p-3">
        <HistoryIcon className="h-5 w-5 text-wave-700" />
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold tracking-wide text-slate-500 uppercase">
            {t("nav.history")}
          </div>
          <div className="font-display text-sm font-bold text-wave-900">
            {t("profile.history_cta")}
          </div>
        </div>
        <ChevronRight className="h-4 w-4 text-slate-400" />
      </Link>

      {/* Achievement chips */}
      {/* {unlockedAchievements.size > 0 ? (
        <div className="no-scrollbar -mx-4 mb-4 flex gap-1.5 overflow-x-auto px-4">
          {[...unlockedAchievements]
            .map((id) => ACHIEVEMENTS_BY_ID[id])
            .filter(Boolean)
            .slice(0, 12)
            .map((a) => (
              <span
                key={a.id}
                className="flex-none rounded-full bg-white/80 px-2.5 py-2 my-1 text-base ring-1 ring-amber-200"
                title={t(`achievement.${a.id}.name`)}
              >
                {a.emoji}
              </span>
            ))}
        </div>
      ) : null} */}

      {/* Vibes */}
      {myStats.totalSwims > 0 ? <Vibes stats={myStats} /> : null}

      <ProfileFooter isRealAdmin={isRealAdmin} isAdmin={isAdmin} />

      <DangerZone
        onDeleteAccount={actions.onDeleteAccount}
        deleting={actions.deleting}
      />
    </div>
  );
}

/**
 * Profile write actions (name, emoji, border, home country, locale, delete).
 * Server-authoritative via the data-layer callables; groups the related
 * transitions and toasts so the page component stays declarative.
 */
function useProfileActions(uid: string | undefined) {
  const { deleteAccount } = useAuth();
  const navigate = useNavigate();
  const t = useT();
  const [nameBusy, startBusy] = useTransition();
  const [deleting, deleteTransition] = useTransition();

  async function pickBorder(id: string) {
    if (!uid) return;
    try {
      await updateUserBorder(uid, id);
    } catch {
      toast.error(t("profile.save_error"));
    }
  }

  async function onDeleteAccount() {
    deleteTransition(async () => {
      try {
        await deleteAccount();
        // Auth state listener will tear down to the login screen.
        navigate("/", { replace: true });
      } catch (e) {
        const msg = (e as Error).message ?? "";
        if (msg.includes("requires-recent-login")) {
          toast.error(t("profile.delete.relogin"));
        } else {
          toast.error(t("profile.delete.error"));
        }
      }
    });
  }

  async function pickHomeCountry(next: string) {
    if (!uid) return;
    try {
      await updateUserHomeCountry(uid, next);
      toast.success(t("profile.home_country_saved"));
    } catch {
      toast.error(t("profile.save_error"));
    }
  }

  async function saveName(trimmed: string): Promise<boolean> {
    if (!uid || !trimmed) return false;
    return new Promise<boolean>((resolve) => {
      startBusy(async () => {
        try {
          await assertUsernameClean(trimmed);
          await assertTextAllowed(trimmed);
          // Keep Firebase Auth and Firestore in sync so ensureUserDoc
          // doesn't revert the name on the next app load.
          await updateProfile(auth.currentUser!, { displayName: trimmed });
          await updateUserDisplayName(uid, trimmed);
          toast.success(t("profile.name_saved"));
          resolve(true);
        } catch (err) {
          toast.error(
            t(
              err instanceof ModerationError
                ? "moderation.name_rejected"
                : "profile.save_error",
            ),
          );
          resolve(false);
        }
      });
    });
  }

  async function pickEmoji(emoji: string): Promise<boolean> {
    if (!uid) return false;
    try {
      await updateUserEmoji(uid, emoji);
      toast.success(t("profile.emoji_saved"));
      return true;
    } catch {
      toast.error(t("profile.save_error"));
      return false;
    }
  }

  return {
    nameBusy,
    deleting,
    pickBorder,
    onDeleteAccount,
    pickHomeCountry,
    saveName,
    pickEmoji,
  };
}

/** Avatar + emoji picker + editable display name + border badge. */
function ProfileHeader({
  displayName,
  emoji,
  border,
  achievementCount,
  onSaveName,
  onPickEmoji,
  nameBusy,
}: {
  displayName: string | undefined;
  emoji: string | undefined;
  border: Border;
  achievementCount: number;
  onSaveName: (trimmed: string) => Promise<boolean>;
  onPickEmoji: (emoji: string) => Promise<boolean>;
  nameBusy: boolean;
}) {
  const t = useT();
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(displayName ?? "");
  const [emojiOpen, setEmojiOpen] = useState(false);

  async function submitName(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = nameInput.trim();
    if (!trimmed) return;
    if (await onSaveName(trimmed)) setEditingName(false);
  }

  async function pickEmoji(e: string) {
    if (await onPickEmoji(e)) setEmojiOpen(false);
  }

  return (
    <div className="mb-5 flex flex-col items-center gap-3">
      <button
        type="button"
        onClick={() => setEmojiOpen((v) => !v)}
        className={cn(
          "flex h-20 w-20 items-center justify-center rounded-full bg-wave-100 text-5xl shadow-md ring-4 transition-transform active:scale-95",
          border.id === "none" ? "ring-white" : border.ringClass,
        )}
        style={
          border.id === "none"
            ? undefined
            : { boxShadow: `0 0 0 1px white, 0 6px 18px ${border.glow}` }
        }
        aria-label={t("profile.change_emoji")}
        title={t("profile.change_emoji")}
      >
        {emoji ?? "🌊"}
      </button>

      <AnimatePresence>
        {emojiOpen && (
          <m.div
            initial={{ opacity: 0, scale: 0.95, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -4 }}
            transition={{ type: "spring", stiffness: 320, damping: 26 }}
            className="glass flex flex-wrap justify-center gap-2 px-4 py-3"
          >
            {EMOJI_POOL.map((e) => (
              <button
                type="button"
                key={e}
                onClick={() => pickEmoji(e)}
                className={cn(
                  "rounded-xl p-1.5 text-3xl transition-transform active:scale-90",
                  emoji === e
                    ? "bg-wave-100 ring-2 ring-wave-400"
                    : "hover:bg-slate-100",
                )}
              >
                {e}
              </button>
            ))}
          </m.div>
        )}
      </AnimatePresence>

      {editingName ? (
        <form onSubmit={submitName} className="flex items-center gap-2">
          <Input
            autoFocus
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            maxLength={40}
            className="text-center font-display text-lg font-bold"
          />
          <Button
            type="submit"
            size="icon-sm"
            disabled={nameBusy}
            icon={<Check className="h-4 w-4" />}
          />
          <button
            type="button"
            onClick={() => {
              setEditingName(false);
              setNameInput(displayName ?? "");
            }}
            aria-label={t("common.cancel")}
            className="rounded-full bg-white/70 p-2 ring-1 ring-slate-200"
          >
            <X className="h-4 w-4" />
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => {
            setNameInput(displayName ?? "");
            setEditingName(true);
          }}
          className="flex items-center gap-1.5 font-display text-2xl font-black text-wave-900"
        >
          {displayName ?? t("layout.swimmer")}
          <Pencil className="h-4 w-4 text-slate-400" />
        </button>
      )}

      <Link
        to="/achievements"
        className={cn(
          "flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ring-1",
          border.id === "none"
            ? "bg-white/80 text-slate-500 ring-slate-200"
            : cn(border.bgClass, "text-white shadow-sm ring-white/40"),
        )}
        title={t("border.tooltip", {
          n: achievementCount,
          total: ACHIEVEMENTS.length,
        })}
      >
        {border.id !== "none" ? <span>{border.emoji}</span> : null}
        {t(`border.${border.id}`)}
        <span className="opacity-80">
          · {achievementCount}/{ACHIEVEMENTS.length}
        </span>
      </Link>
    </div>
  );
}

/** Home country + language selectors. */
function ProfileSettings({
  homeCountry,
  onPickHomeCountry,
}: {
  homeCountry: string | undefined;
  onPickHomeCountry: (next: string) => void;
}) {
  const t = useT();
  const locale = useLocale((s) => s.locale);
  const setLocale = useLocale((s) => s.setLocale);
  const { user } = useAuth();

  async function pickLocale(next: "sv" | "en") {
    setLocale(next);
    if (user) {
      try {
        await updateUserLocale(user.uid, next);
      } catch {
        // non-fatal; local pref is already updated
      }
    }
  }

  return (
    <>
      {/* Home country */}
      <div className="mb-3 flex items-center justify-center gap-2">
        <span className="text-[10px] font-semibold tracking-wide text-slate-500 uppercase">
          {t("profile.home_country")}
        </span>
        <select
          aria-label={t("profile.home_country")}
          value={homeCountry ?? ""}
          onChange={(e) => onPickHomeCountry(e.target.value)}
          className="rounded-full border border-slate-200 bg-white/90 px-2.5 py-1 text-xs font-medium text-slate-700 shadow-sm focus:border-wave-400 focus:ring-2 focus:ring-wave-200 focus:outline-none"
        >
          {!homeCountry ? (
            <option value="" disabled>
              —
            </option>
          ) : null}
          {COUNTRIES.map((c) => (
            <option key={c.code} value={c.code}>
              {flagEmoji(c.code)} {c.name}
            </option>
          ))}
        </select>
      </div>

      {/* Language */}
      <div className="mb-4 flex items-center justify-center gap-2">
        <span className="text-[10px] font-semibold tracking-wide text-slate-500 uppercase">
          {t("profile.language")}
        </span>
        <div
          className="flex rounded-full bg-white/80 p-0.5 text-[11px] font-bold tracking-wide uppercase shadow-sm ring-1 ring-white/70"
          role="group"
          aria-label="Language"
        >
          <button
            type="button"
            onClick={() => pickLocale("sv")}
            data-active={locale === "sv"}
            className="rounded-full px-2.5 py-1 text-slate-500 transition data-[active=true]:bg-wave-600 data-[active=true]:text-white"
            aria-pressed={locale === "sv"}
          >
            SV
          </button>
          <button
            type="button"
            onClick={() => pickLocale("en")}
            data-active={locale === "en"}
            className="rounded-full px-2.5 py-1 text-slate-500 transition data-[active=true]:bg-wave-600 data-[active=true]:text-white"
            aria-pressed={locale === "en"}
          >
            EN
          </button>
        </div>
      </div>
    </>
  );
}

/** About + admin toggle + sign out. */
function ProfileFooter({
  isRealAdmin,
  isAdmin,
}: {
  isRealAdmin: boolean;
  isAdmin: boolean;
}) {
  const t = useT();
  const { logout } = useAuth();
  const adminMode = useAdminMode((s) => s.adminMode);
  const setAdminMode = useAdminMode((s) => s.setAdminMode);

  return (
    <div className="mt-8 space-y-2">
      {/* Admin mode is opt-in: real admins browse as normal users until they
          flip this on, so the extra powers stay out of the way by default. */}
      {isRealAdmin ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2">
          <span className="flex items-center gap-2 text-sm font-semibold text-amber-700">
            <ShieldCheck className="h-4 w-4" />
            {t("admin.mode")}
          </span>
          <div
            className="flex rounded-full bg-white/80 p-0.5 text-[11px] font-bold tracking-wide uppercase shadow-sm ring-1 ring-amber-200"
            role="group"
            aria-label={t("admin.mode")}
          >
            <button
              type="button"
              onClick={() => setAdminMode(false)}
              data-active={!adminMode}
              className="rounded-full px-2.5 py-1 text-slate-500 transition data-[active=true]:bg-amber-500 data-[active=true]:text-white"
              aria-pressed={!adminMode}
            >
              {t("admin.mode.off")}
            </button>
            <button
              type="button"
              onClick={() => setAdminMode(true)}
              data-active={adminMode}
              className="rounded-full px-2.5 py-1 text-slate-500 transition data-[active=true]:bg-amber-500 data-[active=true]:text-white"
              aria-pressed={adminMode}
            >
              {t("admin.mode.on")}
            </button>
          </div>
        </div>
      ) : null}
      {isAdmin ? (
        <Link
          to="/admin/users"
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2 text-sm font-semibold text-amber-700 transition hover:bg-amber-50"
        >
          <ShieldCheck className="h-4 w-4" />
          {t("admin.users.cta")}
        </Link>
      ) : null}
      <Link
        to="/about"
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white/70 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-white"
      >
        <Info className="h-4 w-4" />
        {t("about.title")}
      </Link>
      <button
        type="button"
        onClick={() => logout()}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white/70 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-white"
      >
        <LogOut className="h-4 w-4" />
        {t("layout.log_out")}
      </button>
    </div>
  );
}

/** Delete-account section with inline confirm. */
function DangerZone({
  onDeleteAccount,
  deleting,
}: {
  onDeleteAccount: () => void;
  deleting: boolean;
}) {
  const t = useT();
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div className="mt-6 border-t border-rose-100 pt-4">
      <h3 className="mb-2 text-xs font-semibold tracking-wide text-rose-500 uppercase">
        {t("profile.danger.title")}
      </h3>
      {!confirmDelete ? (
        <button
          type="button"
          onClick={() => setConfirmDelete(true)}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-rose-200 bg-white/70 px-3 py-2 text-sm font-semibold text-rose-600 transition hover:bg-rose-50"
        >
          <Trash2 className="h-4 w-4" />
          {t("profile.delete.button")}
        </button>
      ) : (
        <div className="rounded-xl border border-rose-200 bg-rose-50/80 p-3">
          <p className="mb-3 text-sm leading-snug text-rose-800">
            {t("profile.delete.confirm")}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              disabled={deleting}
              className="flex-1 rounded-xl bg-white px-3 py-2 text-sm font-semibold text-slate-700 ring-1 ring-slate-200 disabled:opacity-50"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              onClick={onDeleteAccount}
              disabled={deleting}
              className="flex-1 rounded-xl bg-rose-600 px-3 py-2 text-sm font-bold text-white shadow disabled:opacity-50"
            >
              {deleting
                ? t("profile.delete.deleting")
                : t("profile.delete.confirm_button")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function unlockHint(b: Border, t: ReturnType<typeof useT>): string {
  return b.unlock.kind === "count"
    ? t("border.unlock.count", { n: b.unlock.min })
    : t("border.unlock.achievement", {
        name: t(`achievement.${b.unlock.achievementId}.name`),
      });
}

function BorderPicker({
  emoji,
  selectedId,
  achievementCount,
  unlocked,
  onPick,
}: {
  emoji: string;
  selectedId: string;
  achievementCount: number;
  unlocked: Set<string>;
  onPick: (id: string) => void;
}) {
  const t = useT();
  return (
    <div className="mb-4">
      <h3 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
        {t("border.picker.title")}
      </h3>
      <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 py-2">
        {BORDERS.map((b) => {
          const earned = isBorderUnlocked(b, achievementCount, unlocked);
          const active = b.id === selectedId;
          return (
            <button
              key={b.id}
              type="button"
              disabled={!earned}
              onClick={() => onPick(b.id)}
              title={earned ? t(`border.${b.id}`) : unlockHint(b, t)}
              className={cn(
                "flex flex-none flex-col items-center gap-1",
                !earned && "opacity-60",
              )}
            >
              <span
                className={cn(
                  "relative flex h-12 w-12 items-center justify-center rounded-full bg-wave-100 text-2xl ring-4",
                  b.id === "none" ? "ring-slate-200" : b.ringClass,
                  active &&
                    "outline outline-2 outline-offset-2 outline-wave-500",
                )}
                style={
                  b.id === "none"
                    ? undefined
                    : { boxShadow: `0 2px 10px ${b.glow}` }
                }
              >
                {earned ? emoji : <Lock className="h-4 w-4 text-slate-400" />}
              </span>
              <span className="max-w-[4.5rem] truncate text-[10px] font-semibold text-slate-600">
                {t(`border.${b.id}`)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MiniCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div className="glass flex flex-col items-start gap-0.5 px-2.5 py-2">
      <div className="flex items-center gap-1 text-[9px] font-semibold tracking-wide text-wave-700 uppercase">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <AnimatedNumber
        value={value}
        className="font-display text-xl font-black text-wave-900"
      />
    </div>
  );
}

function Vibes({ stats }: { stats: MyStats }) {
  const t = useT();

  const streakValue =
    stats.currentWeekStreak === 0
      ? "—"
      : stats.currentWeekStreak === 1
        ? t("vibes.streak.weeks_one")
        : t("vibes.streak.weeks_many", { n: stats.currentWeekStreak });
  const streakSub =
    stats.longestWeekStreak > stats.currentWeekStreak
      ? t("vibes.streak.best", { n: stats.longestWeekStreak })
      : t("vibes.streak.on_fire");

  const lastValue =
    stats.daysSinceLast == null
      ? "—"
      : stats.daysSinceLast === 0
        ? t("vibes.last_swim.today")
        : t("vibes.last_swim.days_ago", { n: stats.daysSinceLast });
  const lastSub = t("vibes.last_swim.total", { n: stats.totalSwims });

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
        {t("vibes.title")}
      </h3>

      <div className="grid grid-cols-2 gap-2">
        <Stat
          icon={<Flame className="h-4 w-4 text-amber-500" />}
          label={t("vibes.streak")}
          value={streakValue}
          sub={streakSub}
        />
        <Stat
          icon={<Clock className="h-4 w-4 text-wave-600" />}
          label={t("vibes.last_swim")}
          value={lastValue}
          sub={lastSub}
        />
      </div>

      {stats.favouriteSpot ? (
        <Link
          to={`/spot/${stats.favouriteSpot.placeId}`}
          className="glass flex items-center gap-3 p-3"
        >
          <Star className="h-5 w-5 text-amber-500" />
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-semibold tracking-wide text-slate-500 uppercase">
              {t("vibes.fav_spot")}
            </div>
            <div className="truncate font-display text-base font-bold text-wave-900">
              {stats.favouriteSpot.name}
            </div>
          </div>
          <div className="font-display text-xl font-black text-wave-700">
            {stats.favouriteSpot.count}
          </div>
        </Link>
      ) : null}

      {stats.range ? (
        <div className="glass flex items-center gap-3 p-3">
          <Compass className="h-5 w-5 text-wave-600" />
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-semibold tracking-wide text-slate-500 uppercase">
              {t("vibes.range")}
            </div>
            <div className="text-sm text-wave-900">
              {t("vibes.range.spans", { n: stats.range.km.toFixed(1) })}
            </div>
          </div>
        </div>
      ) : null}

      {stats.bestMonth ? (
        <div className="glass flex items-center gap-3 p-3">
          <CalendarHeart className="h-5 w-5 text-rose-500" />
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-semibold tracking-wide text-slate-500 uppercase">
              {t("vibes.best_month")}
            </div>
            <div className="text-sm text-wave-900">
              {t("vibes.best_month.value", {
                month: monthShort(stats.bestMonth.month),
                n: stats.bestMonth.points,
              })}
            </div>
          </div>
        </div>
      ) : null}

      {stats.onThisDay ? (
        <Link
          to={`/spot/${stats.onThisDay.placeId}`}
          className="glass flex items-start gap-3 bg-gradient-to-br from-wave-50 to-white p-3"
        >
          <span className="text-2xl">🗓️</span>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-semibold tracking-wide text-wave-700 uppercase">
              {t("vibes.on_this_day")}
            </div>
            <div className="text-sm text-wave-900">
              {t("vibes.on_this_day.text", {
                place: stats.onThisDay.placeName,
                date: formatDate(stats.onThisDay.date),
              })}
              {stats.onThisDay.isWinter ? " ❄️" : ""}
            </div>
          </div>
        </Link>
      ) : null}
    </div>
  );
}
