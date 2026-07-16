import { useReducer, useState } from "react";
import { Link, useNavigate } from "react-router";
import { m, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Award,
  Share2,
} from "lucide-react";
import { useAllSessionsFeed, useStore } from "@/store/sessions";
import { useAuth } from "@/auth/AuthContext";
import { startOfYear, endOfYear } from "@/lib/scoring";
import { computeMyStats } from "@/lib/stats";
import { ACHIEVEMENTS_BY_ID, evaluateAchievements } from "@/lib/achievements";
import { monthShort, useT } from "@/lib/i18n";
import { Button } from "@/components/ui/Button";
import { buttonClasses } from "@/components/ui/buttonStyles";
import { toast } from "@/components/ui/toastStore";
import { shareRecapCard } from "@/lib/recapCard";

const slideVariants = {
  enter: (dir: 1 | -1) => ({
    x: dir > 0 ? 60 : -60,
    opacity: 0,
    scale: 0.96,
  }),
  center: { x: 0, opacity: 1, scale: 1 },
  exit: (dir: 1 | -1) => ({
    x: dir > 0 ? -60 : 60,
    opacity: 0,
    scale: 0.96,
  }),
};

type RecapNavigation = {
  year: number;
  idx: number;
  dir: 1 | -1;
};

type RecapNavigationAction =
  | { type: "changeYear"; delta: 1 | -1 }
  | { type: "advance"; delta: 1 | -1; lastIndex: number };

function recapNavigationReducer(
  state: RecapNavigation,
  action: RecapNavigationAction,
): RecapNavigation {
  if (action.type === "changeYear") {
    return { year: state.year + action.delta, idx: 0, dir: action.delta };
  }

  return {
    ...state,
    idx: Math.max(0, Math.min(action.lastIndex, state.idx + action.delta)),
    dir: action.delta,
  };
}

export default function RecapPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const mySessions = useStore((s) => s.mySessions);
  const allSessions = useStore((s) => s.allSessions);
  // The recap's community slides read the year feed — keep it subscribed
  // while the recap is open (this page is behind login).
  useAllSessionsFeed();

  const currentYear = new Date().getFullYear();
  const [{ year, idx, dir }, navigateRecap] = useReducer(
    recapNavigationReducer,
    { year: currentYear, idx: 0, dir: 1 },
  );

  const availableYears = (() => {
    const years = new Set<number>();
    for (const s of mySessions) years.add(new Date(s.date).getFullYear());
    if (years.size === 0) return [currentYear];
    return [...years].toSorted((a, b) => a - b);
  })();

  const minYear = availableYears[0] ?? currentYear;
  const canGoPrev = year > minYear;
  const canGoNext = year < currentYear;

  const startTs = startOfYear(year);
  const endTs = endOfYear(year);

  const yearSessions = mySessions.filter(
    (s) => s.date >= startTs && s.date <= endTs,
  );
  const stats = computeMyStats(yearSessions);

  const ctxYear = {
    uid: user?.uid ?? "",
    mySessions: yearSessions,
    allSessions: allSessions.filter(
      (s) => s.date >= startTs && s.date <= endTs,
    ),
  };
  const unlockedYear = evaluateAchievements(ctxYear);

  const slides = useRecapSlides({ stats, year, yearSessions, unlockedYear });
  const { sharing, onShare } = useRecapShare({ stats, year, yearSessions });

  const slide = slides[idx];
  const isLast = idx === slides.length - 1;

  const advance = (delta: 1 | -1) => {
    navigateRecap({ type: "advance", delta, lastIndex: slides.length - 1 });
  };

  return (
    <div className="relative min-h-[calc(var(--app-height,100dvh)-4rem)] overflow-hidden px-4 pt-2 pb-12">
      <ConfettiBackdrop />
      <RecapHeader
        year={year}
        canGoPrev={canGoPrev}
        canGoNext={canGoNext}
        onBack={() => navigate(-1)}
        onChangeYear={(delta) => navigateRecap({ type: "changeYear", delta })}
      />

      <div className="relative z-10 mb-3 flex gap-1">
        {slides.map((s, i) => (
          <span
            key={s.title}
            className={`h-1 flex-1 rounded-full ${
              i <= idx ? "bg-wave-600" : "bg-white/70"
            }`}
          />
        ))}
      </div>

      <div className="relative z-10 mt-4 flex h-[60vh] items-center justify-center">
        <AnimatePresence mode="wait" custom={dir}>
          <m.div
            key={idx}
            custom={dir}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ type: "spring", stiffness: 240, damping: 26 }}
            drag="x"
            dragElastic={0.2}
            dragConstraints={{ left: 0, right: 0 }}
            onDragEnd={(_, info) => {
              if (info.offset.x < -60 && idx < slides.length - 1) {
                advance(1);
              } else if (info.offset.x > 60 && idx > 0) {
                advance(-1);
              }
            }}
            className="w-full max-w-sm cursor-grab active:cursor-grabbing"
          >
            <SlideCard slide={slide} />
          </m.div>
        </AnimatePresence>
      </div>

      <RecapFooter
        year={year}
        idx={idx}
        isLast={isLast}
        sharing={sharing}
        onShare={onShare}
        onAdvance={advance}
      />
    </div>
  );
}

function RecapHeader({
  year,
  canGoPrev,
  canGoNext,
  onBack,
  onChangeYear,
}: {
  year: number;
  canGoPrev: boolean;
  canGoNext: boolean;
  onBack: () => void;
  onChangeYear: (delta: 1 | -1) => void;
}) {
  const t = useT();
  return (
    <div className="relative z-10 mb-3 flex items-center gap-2">
      <button
        type="button"
        onClick={onBack}
        className="rounded-full bg-white/80 p-2 ring-1 ring-slate-200"
        aria-label={t("common.back")}
      >
        <ArrowLeft className="h-4 w-4" />
      </button>
      <h2 className="font-display text-xl font-black text-wave-900">
        {t("recap.title", { year })}
      </h2>
      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          onClick={() => onChangeYear(-1)}
          disabled={!canGoPrev}
          className="rounded-full bg-white/80 p-1.5 ring-1 ring-slate-200 disabled:opacity-30"
          aria-label={t("common.previous")}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => onChangeYear(1)}
          disabled={!canGoNext}
          className="rounded-full bg-white/80 p-1.5 ring-1 ring-slate-200 disabled:opacity-30"
          aria-label={t("common.next")}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function RecapFooter({
  year,
  idx,
  isLast,
  sharing,
  onShare,
  onAdvance,
}: {
  year: number;
  idx: number;
  isLast: boolean;
  sharing: boolean;
  onShare: () => void;
  onAdvance: (delta: 1 | -1) => void;
}) {
  const t = useT();
  return (
    <div className="relative z-10 mt-4 flex justify-between">
      <m.button
        whileTap={{ scale: 0.92 }}
        disabled={idx === 0}
        onClick={() => onAdvance(-1)}
        className="rounded-full bg-white/80 p-3 ring-1 ring-slate-200 disabled:opacity-40"
        aria-label={t("common.previous")}
      >
        <ChevronLeft className="h-5 w-5" />
      </m.button>
      {isLast ? (
        <div className="flex items-center gap-2">
          <Button
            size="lg"
            className="text-sm"
            icon={<Share2 className="h-4 w-4" />}
            loading={sharing}
            onClick={onShare}
          >
            {t("recap.share.button", { year })}
          </Button>
          <m.div whileTap={{ scale: 0.96 }}>
            <Link
              to="/"
              className={buttonClasses("secondary", "lg", "text-sm")}
            >
              {t("recap.back_to_map")}
            </Link>
          </m.div>
        </div>
      ) : (
        <m.button
          whileTap={{ scale: 0.92 }}
          onClick={() => onAdvance(1)}
          className={buttonClasses("primary", "icon", "h-11 w-11")}
          aria-label={t("common.next")}
        >
          <ChevronRight className="h-5 w-5" />
        </m.button>
      )}
    </div>
  );
}

type MyStats = ReturnType<typeof computeMyStats>;

function useRecapSlides({
  stats,
  year,
  yearSessions,
  unlockedYear,
}: {
  stats: MyStats;
  year: number;
  yearSessions: { date: number }[];
  unlockedYear: Set<string>;
}): Slide[] {
  const t = useT();
  const total = stats.totalPoints;
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
      subtitle: t("recap.points.normal"),
      accent: "🏆",
      big: total.toString(),
      bigLabel: t("recap.points.label"),
    },
    {
      kind: "stat",
      title: t("recap.spots.title"),
      subtitle: stats.uniquePlaces > 1 ? t("recap.spots.subtitle") : undefined,
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
      subtitle: t("recap.achievements.subtitle", {
        n: earnedThisYear.length,
      }),
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
}

function useRecapShare({
  stats,
  year,
  yearSessions,
}: {
  stats: MyStats;
  year: number;
  yearSessions: { date: number }[];
}) {
  const t = useT();
  const [sharing, setSharing] = useState(false);

  async function onShare() {
    setSharing(true);
    try {
      const fav = stats.favouriteSpot;
      const result = await shareRecapCard({
        year,
        appName: t("app.name"),
        title: t("recap.share.title"),
        big: {
          value: String(yearSessions.length),
          label:
            yearSessions.length === 1
              ? t("recap.intro.label_one")
              : t("recap.intro.label_many"),
        },
        rows: [
          {
            emoji: "🏆",
            value: String(stats.totalPoints),
            label: t("recap.points.label"),
          },
          {
            emoji: "📍",
            value: String(stats.uniquePlaces),
            label: t("recap.spots.label"),
          },
          {
            emoji: "❄️",
            value: String(stats.winterSwims),
            label:
              stats.winterSwims === 1
                ? t("recap.winter.label_one")
                : t("recap.winter.label_many"),
          },
          {
            emoji: "🔥",
            value: String(stats.streak.longest),
            label: t("recap.share.streak_label"),
          },
          ...(fav
            ? [
                {
                  emoji: "⭐",
                  value: String(fav.count),
                  label:
                    fav.name.length > 24
                      ? `${fav.name.slice(0, 23)}…`
                      : fav.name,
                },
              ]
            : []),
        ],
        footer: t("app.tagline"),
      });
      if (result === "downloaded") toast.success(t("recap.share.downloaded"));
      else if (result === "failed") toast.error(t("recap.share.error"));
    } catch {
      toast.error(t("recap.share.error"));
    }
    setSharing(false);
  }

  return { sharing, onShare };
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
      <m.div
        initial={{ scale: 0.6, rotate: -10 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{
          type: "spring",
          stiffness: 300,
          damping: 16,
          delay: 0.05,
        }}
        className="text-7xl drop-shadow"
      >
        {slide.accent}
      </m.div>
      <div className="text-[11px] font-semibold tracking-widest text-wave-700 uppercase">
        {slide.title}
      </div>

      {slide.kind !== "achievements" ? (
        <>
          {slide.big ? (
            <m.div
              initial={{ y: 10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.18 }}
              className="font-display text-6xl font-black text-wave-900"
            >
              {slide.big}
            </m.div>
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
            <m.div
              key={id}
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.05, type: "spring", stiffness: 240 }}
              className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-2xl shadow ring-2 ring-amber-300"
              title={t(`achievement.${id}.name`)}
            >
              {a.emoji}
            </m.div>
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

const CONFETTI_EMOJIS = ["🌊", "💧", "❄️", "✨", "⭐", "🐬"];

function ConfettiBackdrop() {
  // Generate positions/timing once per mount so slide navigation cannot
  // reshuffle the animation, while keeping render deterministic.
  const [pieces] = useState(() =>
    Array.from({ length: 30 }, (_, i) => ({
      key: i,
      left: Math.random() * 100,
      delay: Math.random() * 4,
      duration: 5 + Math.random() * 4,
    })),
  );
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {pieces.map(({ key, left, delay, duration }) => (
        <m.span
          key={key}
          initial={{ y: -40, opacity: 0 }}
          animate={{ y: "100dvh", opacity: [0, 1, 0.7, 0] }}
          transition={{
            duration,
            delay,
            repeat: Infinity,
            ease: "linear",
          }}
          className="absolute text-lg select-none"
          style={{ left: `${left}%` }}
        >
          {CONFETTI_EMOJIS[key % CONFETTI_EMOJIS.length]}
        </m.span>
      ))}
    </div>
  );
}
