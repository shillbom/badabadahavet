import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Award,
} from "lucide-react";
import { useStore } from "@/store/sessions";
import { useAuth } from "@/auth/AuthContext";
import { startOfYear, endOfYear } from "@/lib/scoring";
import { computeMyStats } from "@/lib/stats";
import {
  ACHIEVEMENTS,
  ACHIEVEMENTS_BY_ID,
  evaluateAchievements,
} from "@/lib/achievements";
import { monthShort, useT } from "@/lib/i18n";

export default function RecapPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const t = useT();
  const mySessions = useStore((s) => s.mySessions);
  const allSessions = useStore((s) => s.allSessions);

  const year = new Date().getFullYear();
  const startTs = startOfYear(year);
  const endTs = endOfYear(year);

  const yearSessions = useMemo(
    () => mySessions.filter((s) => s.date >= startTs && s.date <= endTs),
    [mySessions, startTs, endTs],
  );
  const stats = useMemo(() => computeMyStats(yearSessions), [yearSessions]);

  const ctxYear = useMemo(
    () => ({
      uid: user?.uid ?? "",
      mySessions: yearSessions,
      allSessions: allSessions.filter(
        (s) => s.date >= startTs && s.date <= endTs,
      ),
    }),
    [user, yearSessions, allSessions, startTs, endTs],
  );
  const unlockedYear = useMemo(
    () => evaluateAchievements(ctxYear),
    [ctxYear],
  );

  const yearBonus = useMemo(() => {
    let pts = 0;
    for (const a of ACHIEVEMENTS) if (unlockedYear.has(a.id)) pts += a.points;
    return pts;
  }, [unlockedYear]);

  const slides = useMemo<Slide[]>(() => {
    const total = stats.totalPoints + yearBonus;
    const fav = stats.favouriteSpot;
    const best = stats.bestMonth;
    const winters = stats.winterSwims;
    const range = stats.range?.km ?? 0;
    const earnedThisYear = [...unlockedYear];
    return [
      {
        kind: "intro",
        title: `${year}`,
        subtitle: t("recap.intro.subtitle"),
        accent: "🌊",
        big: yearSessions.length.toString(),
        bigLabel:
          yearSessions.length === 1
            ? t("recap.intro.label_one")
            : t("recap.intro.label_many"),
      },
      {
        kind: "stat",
        title: t("recap.points.title"),
        subtitle: yearBonus
          ? t("recap.points.bonus", { n: yearBonus })
          : t("recap.points.normal"),
        accent: "🏆",
        big: total.toString(),
        bigLabel: t("recap.points.label"),
      },
      {
        kind: "stat",
        title: t("recap.spots.title"),
        subtitle:
          stats.uniquePlaces > 1 ? t("recap.spots.subtitle") : undefined,
        accent: "📍",
        big: stats.uniquePlaces.toString(),
        bigLabel: t("recap.spots.label"),
      },
      {
        kind: "stat",
        title: t("recap.winter.title"),
        subtitle:
          winters >= 5
            ? t("recap.winter.brave")
            : winters > 0
              ? t("recap.winter.cold")
              : t("recap.winter.maybe"),
        accent: "❄️",
        big: winters.toString(),
        bigLabel:
          winters === 1
            ? t("recap.winter.label_one")
            : t("recap.winter.label_many"),
      },
      ...(fav
        ? [
            {
              kind: "stat" as const,
              title: t("recap.fav.title"),
              subtitle: fav.name,
              accent: "⭐",
              big: fav.count.toString(),
              bigLabel:
                fav.count === 1
                  ? t("recap.fav.label_one")
                  : t("recap.fav.label_many"),
              link: `/spot/${fav.placeId}`,
            },
          ]
        : []),
      ...(best
        ? [
            {
              kind: "stat" as const,
              title: t("recap.month.title"),
              subtitle: t("recap.month.subtitle"),
              accent: "🗓️",
              big: monthShort(best.month),
              bigLabel: t("recap.month.label", { n: best.points }),
            },
          ]
        : []),
      ...(range > 0.5
        ? [
            {
              kind: "stat" as const,
              title: t("recap.range.title"),
              subtitle: t("recap.range.subtitle"),
              accent: "🧭",
              big: `${range.toFixed(0)}`,
              bigLabel: t("recap.range.label"),
            },
          ]
        : []),
      {
        kind: "achievements",
        title: t("recap.achievements.title"),
        subtitle: t("recap.achievements.subtitle", { n: earnedThisYear.length }),
        accent: "🏅",
        ids: earnedThisYear,
      },
      {
        kind: "outro",
        title: t("recap.outro.title"),
        subtitle: t("recap.outro.subtitle"),
        accent: "💧",
      },
    ];
  }, [stats, yearBonus, year, yearSessions, unlockedYear, t]);

  const [idx, setIdx] = useState(0);
  const slide = slides[idx];
  const isLast = idx === slides.length - 1;

  return (
    <div className="relative min-h-[calc(100dvh-4rem)] overflow-hidden px-4 pb-12 pt-2">
      <ConfettiBackdrop />
      <div className="relative z-10 mb-3 flex items-center gap-2">
        <button
          onClick={() => navigate(-1)}
          className="rounded-full bg-white/80 p-2 ring-1 ring-slate-200"
          aria-label={t("common.back")}
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h2 className="font-display text-xl font-black text-wave-900">
          {t("recap.title", { year })}
        </h2>
      </div>

      <div className="relative z-10 mb-3 flex gap-1">
        {slides.map((_, i) => (
          <span
            key={i}
            className={`h-1 flex-1 rounded-full ${
              i <= idx ? "bg-wave-600" : "bg-white/70"
            }`}
          />
        ))}
      </div>

      <div className="relative z-10 mt-4 flex h-[60vh] items-center justify-center">
        <AnimatePresence mode="wait">
          <motion.div
            key={idx}
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -24, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 220, damping: 22 }}
            className="w-full max-w-sm"
          >
            <SlideCard slide={slide} />
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="relative z-10 mt-4 flex justify-between">
        <button
          disabled={idx === 0}
          onClick={() => setIdx((i) => Math.max(0, i - 1))}
          className="rounded-full bg-white/80 p-3 ring-1 ring-slate-200 disabled:opacity-40"
          aria-label={t("common.previous")}
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        {isLast ? (
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 rounded-full bg-wave-600 px-5 py-3 text-sm font-medium text-white shadow"
          >
            {t("recap.back_to_map")}
          </Link>
        ) : (
          <button
            onClick={() => setIdx((i) => Math.min(slides.length - 1, i + 1))}
            className="rounded-full bg-wave-600 p-3 text-white shadow"
            aria-label={t("common.next")}
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        )}
      </div>
    </div>
  );
}

type Slide =
  | {
      kind: "intro" | "stat" | "outro";
      title: string;
      subtitle?: string;
      accent: string;
      big?: string;
      bigLabel?: string;
      link?: string;
    }
  | {
      kind: "achievements";
      title: string;
      subtitle?: string;
      accent: string;
      ids: string[];
    };

function SlideCard({ slide }: { slide: Slide }) {
  const inner = (
    <div className="glass relative flex h-[60vh] max-h-[600px] flex-col items-center justify-center gap-3 bg-gradient-to-br from-white via-wave-50 to-amber-50 p-8 text-center">
      <motion.div
        initial={{ scale: 0.6, rotate: -10 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 16, delay: 0.05 }}
        className="text-7xl drop-shadow"
      >
        {slide.accent}
      </motion.div>
      <div className="text-[11px] font-semibold uppercase tracking-widest text-wave-700">
        {slide.title}
      </div>

      {slide.kind !== "achievements" ? (
        <>
          {slide.big ? (
            <motion.div
              initial={{ y: 10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.18 }}
              className="font-display text-6xl font-black text-wave-900"
            >
              {slide.big}
            </motion.div>
          ) : null}
          {slide.bigLabel ? (
            <div className="font-display text-base font-bold text-slate-600">
              {slide.bigLabel}
            </div>
          ) : null}
          {slide.subtitle ? (
            <p className="max-w-xs text-sm text-slate-600">{slide.subtitle}</p>
          ) : null}
        </>
      ) : (
        <AchievementsSlide ids={slide.ids} subtitle={slide.subtitle} />
      )}
    </div>
  );

  if (slide.kind !== "achievements" && slide.link) {
    return <Link to={slide.link}>{inner}</Link>;
  }
  return inner;
}

function AchievementsSlide({
  ids,
  subtitle,
}: {
  ids: string[];
  subtitle?: string;
}) {
  const t = useT();
  if (ids.length === 0)
    return (
      <p className="max-w-xs text-sm text-slate-600">
        {t("recap.achievements.empty")}
      </p>
    );
  return (
    <>
      <p className="text-sm text-slate-600">{subtitle}</p>
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        {ids.slice(0, 9).map((id) => {
          const a = ACHIEVEMENTS_BY_ID[id];
          if (!a) return null;
          return (
            <motion.div
              key={id}
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.05, type: "spring", stiffness: 240 }}
              className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-2xl shadow ring-2 ring-amber-300"
              title={t(`achievement.${id}.name`)}
            >
              {a.emoji}
            </motion.div>
          );
        })}
      </div>
      {ids.length > 9 ? (
        <div className="mt-1 text-[11px] text-slate-500">
          {t("recap.achievements.more", { n: ids.length - 9 })}
        </div>
      ) : null}
      <Link
        to="/achievements"
        className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-wave-700"
      >
        {t("recap.achievements.see_all")} <Award className="h-3 w-3" />
      </Link>
    </>
  );
}

function ConfettiBackdrop() {
  const pieces = Array.from({ length: 30 }, (_, i) => i);
  const emojis = ["🌊", "💧", "❄️", "✨", "⭐", "🐬"];
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {pieces.map((i) => {
        const left = Math.random() * 100;
        const delay = Math.random() * 4;
        const duration = 5 + Math.random() * 4;
        const e = emojis[i % emojis.length];
        return (
          <motion.span
            key={i}
            initial={{ y: -40, opacity: 0 }}
            animate={{ y: "100dvh", opacity: [0, 1, 0.7, 0] }}
            transition={{
              duration,
              delay,
              repeat: Infinity,
              ease: "linear",
            }}
            className="absolute select-none text-lg"
            style={{ left: `${left}%` }}
          >
            {e}
          </motion.span>
        );
      })}
    </div>
  );
}
