import { useMemo } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, Lock } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";
import { useStore } from "@/store/sessions";
import {
  ACHIEVEMENTS,
  type Achievement,
  type AchievementContext,
} from "@/lib/achievements";
import { cn, formatDate } from "@/lib/utils";
import { useT } from "@/lib/i18n";

export default function AchievementsPage() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const t = useT();
  const achievementCtx = useStore((s) => s.achievementCtx);
  const unlockedAchievements = useStore((s) => s.unlockedAchievements);
  const achievementBonusPoints = useStore((s) => s.achievementBonusPoints);

  const items = useMemo(() => {
    return [...ACHIEVEMENTS].sort((a, b) => {
      const ua = unlockedAchievements.has(a.id);
      const ub = unlockedAchievements.has(b.id);
      if (ua !== ub) return ua ? -1 : 1;
      return a.tier - b.tier;
    });
  }, [unlockedAchievements]);

  return (
    <div className="px-4 pb-12 pt-2">
      <div className="mb-3 flex items-center gap-2">
        <button
          onClick={() => navigate(-1)}
          className="rounded-full bg-white/70 p-2 ring-1 ring-slate-200"
          aria-label={t("common.back")}
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div>
          <h2 className="font-display text-2xl font-black text-wave-900">
            {t("achievements.title")}
          </h2>
          <p className="text-xs text-slate-500">
            {t("achievements.summary", {
              n: unlockedAchievements.size,
              total: ACHIEVEMENTS.length,
              pts: achievementBonusPoints,
            })}
          </p>
        </div>
      </div>

      <ul className="space-y-2">
        {items.map((a, i) => (
          <Row
            key={a.id}
            achievement={a}
            unlocked={unlockedAchievements.has(a.id)}
            unlockedAt={profile?.achievements?.[a.id]}
            ctx={achievementCtx}
            index={i}
          />
        ))}
      </ul>
    </div>
  );
}

function Row({
  achievement,
  unlocked,
  unlockedAt,
  ctx,
  index,
}: {
  achievement: Achievement;
  unlocked: boolean;
  unlockedAt?: number;
  ctx: AchievementContext;
  index: number;
}) {
  const t = useT();
  const progress = achievement.progress?.(ctx) ?? (unlocked ? 1 : 0);
  return (
    <motion.li
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 12) * 0.025 }}
      className={cn(
        "glass flex items-center gap-3 p-3",
        !unlocked && "opacity-70",
      )}
    >
      <motion.div
        whileHover={unlocked ? { rotate: [-3, 3, -2, 0], scale: 1.05 } : undefined}
        transition={{ duration: 0.6 }}
        className={cn(
          "relative flex h-12 w-12 flex-none items-center justify-center rounded-full text-2xl ring-2",
          unlocked
            ? "bg-gradient-to-br from-amber-200 to-wave-200 ring-amber-300 shadow-sm"
            : "bg-slate-100 ring-slate-200 grayscale",
        )}
      >
        {unlocked ? (
          <>
            <span className="pointer-events-none absolute inset-0 -z-10 rounded-full bg-amber-200/60 blur-md" />
            {achievement.emoji}
          </>
        ) : (
          <Lock className="h-5 w-5 text-slate-400" />
        )}
      </motion.div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              "truncate font-display text-base font-bold",
              unlocked ? "text-wave-900" : "text-slate-500",
            )}
          >
            {t(`achievement.${achievement.id}.name`)}
          </span>
          <span
            className={cn(
              "rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide",
              achievement.tier === 3
                ? "bg-amber-100 text-amber-800"
                : achievement.tier === 2
                  ? "bg-wave-100 text-wave-800"
                  : "bg-slate-100 text-slate-600",
            )}
          >
            +{achievement.points}
          </span>
        </div>
        <div className="text-[11px] text-slate-500">
          {t(`achievement.${achievement.id}.desc`)}
          {unlocked && unlockedAt
            ? ` · ${t("achievements.earned_on", { date: formatDate(unlockedAt) })}`
            : null}
        </div>
        {!unlocked && progress > 0 ? (
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${Math.round(progress * 100)}%` }}
              transition={{
                duration: 0.9,
                ease: [0.16, 1, 0.3, 1],
                delay: Math.min(index, 12) * 0.04,
              }}
              className="h-full rounded-full bg-gradient-to-r from-wave-400 to-wave-600"
            />
          </div>
        ) : null}
      </div>
    </motion.li>
  );
}
