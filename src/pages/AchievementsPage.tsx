import { useMemo } from "react";
import { motion } from "framer-motion";
import { Lock } from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { useStore } from "@/store/sessions";
import {
  ACHIEVEMENTS,
  type Achievement,
  type AchievementContext,
} from "@/lib/achievements";
import { tierForCount, nextTier } from "@/lib/borders";
import { cn, formatDate } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import BackButton from "@/components/ui/BackButton";

export default function AchievementsPage() {
  const { profile } = useAuth();
  const t = useT();
  const achievementCtx = useStore((s) => s.achievementCtx);
  const unlockedAchievements = useStore((s) => s.unlockedAchievements);

  const tier = tierForCount(unlockedAchievements.size);
  const next = nextTier(unlockedAchievements.size);

  const items = useMemo(() => {
    return [...ACHIEVEMENTS].sort((a, b) => {
      const ua = unlockedAchievements.has(a.id);
      const ub = unlockedAchievements.has(b.id);
      if (ua !== ub) return ua ? -1 : 1;
      return a.tier - b.tier;
    });
  }, [unlockedAchievements]);

  return (
    <div className="px-4 pt-2 pb-12">
      <div className="mb-3 flex items-center gap-2">
        <BackButton />
        <div>
          <h2 className="font-display text-2xl font-black text-wave-900">
            {t("achievements.title")}
          </h2>
          <p className="text-xs text-slate-500">
            {t("achievements.summary", {
              n: unlockedAchievements.size,
              total: ACHIEVEMENTS.length,
            })}
          </p>
        </div>
      </div>

      {/* Rank banner — turns achievement count into a visible badge that
          also decorates the user's pins and profile. */}
      <div
        className={cn(
          "mb-3 flex items-center gap-3 rounded-2xl p-3 text-white shadow-sm",
          tier.id === "none"
            ? "bg-gradient-to-br from-slate-300 to-slate-500"
            : tier.bgClass,
        )}
      >
        <div className="flex h-12 w-12 flex-none items-center justify-center rounded-full bg-white/25 text-2xl ring-2 ring-white/50">
          {tier.id === "none" ? "🌊" : tier.emoji}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-display text-lg font-black">
            {t(`border.${tier.id}`)}
          </div>
          <div className="text-[11px] text-white/90">
            {next
              ? t("border.next", {
                  n: next.remaining,
                  rank: t(`border.${next.border.id}`),
                })
              : t("border.maxed")}
          </div>
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
        whileHover={
          unlocked ? { rotate: [-3, 3, -2, 0], scale: 1.05 } : undefined
        }
        transition={{ duration: 0.6 }}
        className={cn(
          "relative flex h-12 w-12 flex-none items-center justify-center rounded-full text-2xl ring-2",
          unlocked
            ? "bg-gradient-to-br from-amber-200 to-wave-200 shadow-sm ring-amber-300"
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
              "rounded-full px-1.5 py-0.5 text-[9px] font-bold tracking-wide uppercase",
              achievement.tier === 3
                ? "bg-amber-100 text-amber-800"
                : achievement.tier === 2
                  ? "bg-wave-100 text-wave-800"
                  : "bg-slate-100 text-slate-600",
            )}
            title={t("achievements.tier", { n: achievement.tier })}
          >
            {"★".repeat(achievement.tier)}
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
