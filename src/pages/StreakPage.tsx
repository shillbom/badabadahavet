import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Flame,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useStore } from "@/store/sessions";
import { useT, useLocale, localeBcp, monthLong } from "@/lib/i18n";
import { dayStartMs, type StreakInfo } from "@/lib/streak";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { cn } from "@/lib/utils";

const DAY_MS = 86_400_000;

type DayState = "swim" | "skip" | "missed" | "today" | "none";

/** What a given calendar day should look like. `firstDay` mutes everything
 *  before the user's very first swim — those aren't "missed", just history. */
function dayState(
  day: number,
  streak: StreakInfo,
  today: number,
  firstDay: number | null,
): DayState {
  const type = streak.dayTypes.get(day);
  if (type) return type;
  if (day === today) return "today";
  if (firstDay !== null && day > firstDay && day < today) return "missed";
  return "none";
}

export default function StreakPage() {
  const navigate = useNavigate();
  const t = useT();
  const locale = useLocale((s) => s.locale);
  const bcp = localeBcp(locale);
  const sessions = useStore((s) => s.mySessions);
  const streak = useStore((s) => s.myStats.streak);

  const today = dayStartMs(Date.now());
  const [rulesOpen, setRulesOpen] = useState(false);

  const firstDay = useMemo(() => {
    if (sessions.length === 0) return null;
    return dayStartMs(Math.min(...sessions.map((s) => s.date)));
  }, [sessions]);

  // Nextory-style "9 of the last 10 days" habit meter.
  const last10 = useMemo(() => {
    const days: { day: number; state: DayState; label: string }[] = [];
    for (let i = 9; i >= 0; i--) {
      const day = dayStartMs(today - i * DAY_MS + DAY_MS / 2);
      days.push({
        day,
        state: dayState(day, streak, today, firstDay),
        label: new Date(day)
          .toLocaleString(bcp, { weekday: "short" })
          .slice(0, 2),
      });
    }
    return days;
  }, [streak, today, firstDay, bcp]);

  const recentSwims = last10.filter((d) => d.state === "swim").length;

  const helper = !streak.current
    ? t("streak.helper.none")
    : streak.atRisk
      ? t("streak.helper.at_risk")
      : streak.onBuoy
        ? t("streak.helper.on_buoy")
        : t("streak.helper.active");

  return (
    <div className="px-4 pt-2 pb-12">
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
            {recentSwims >= 5
              ? t("streak.header.regular")
              : t("streak.header.start")}
          </h2>
          <p className="text-xs text-slate-500">
            {t("streak.header.recent", { n: recentSwims })}
          </p>
        </div>
      </div>

      {/* Hero card — big count, last-10-days row, buoy balance + rules. */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass overflow-hidden"
      >
        <div className="p-4">
          <div className="flex items-center gap-2">
            <Flame
              className={cn(
                "h-6 w-6",
                streak.current > 0 ? "text-orange-500" : "text-slate-300",
              )}
            />
            <AnimatedNumber
              value={streak.current}
              className="font-display text-4xl font-black text-wave-900"
            />
            <span className="font-display text-xl font-bold text-wave-700">
              {streak.current === 1
                ? t("streak.days.suffix_one")
                : t("streak.days.suffix_many")}
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500">{helper}</p>

          <div className="mt-4 flex justify-between">
            {last10.map(({ day, state, label }) => (
              <div key={day} className="flex flex-col items-center gap-1">
                <div
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-full text-[13px]",
                    state === "swim" &&
                      "bg-gradient-to-br from-wave-400 to-wave-600 text-white",
                    state === "skip" && "bg-sky-100 ring-1 ring-sky-300",
                    state === "missed" && "ring-1 ring-slate-200",
                    state === "today" &&
                      "ring-2 ring-wave-400 ring-offset-1 ring-offset-white/50",
                    state === "none" && "ring-1 ring-slate-100",
                  )}
                >
                  {state === "swim" ? (
                    <Check className="h-4 w-4" strokeWidth={3} />
                  ) : state === "skip" ? (
                    "🛟"
                  ) : null}
                </div>
                <span className="text-[10px] text-slate-500">{label}</span>
                {state === "today" ? (
                  <span className="-mt-0.5 h-1 w-1 rounded-full bg-wave-500" />
                ) : null}
              </div>
            ))}
          </div>
        </div>

        {/* Buoy balance — tap to reveal the rules, like Nextory's expander. */}
        <button
          type="button"
          onClick={() => setRulesOpen((v) => !v)}
          className="flex w-full items-center gap-2 bg-white/50 px-4 py-3 text-left"
        >
          <span className="text-base">🛟</span>
          <span className="flex-1 text-sm font-semibold text-wave-900">
            {streak.skipsAvailable === 0
              ? t("streak.buoys.left_none")
              : streak.skipsAvailable === 1
                ? t("streak.buoys.left_one")
                : t("streak.buoys.left_many", { n: streak.skipsAvailable })}
          </span>
          <ChevronDown
            className={cn(
              "h-4 w-4 text-slate-400 transition-transform",
              rulesOpen && "rotate-180",
            )}
          />
        </button>
        <AnimatePresence initial={false}>
          {rulesOpen ? (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden bg-white/50"
            >
              <div className="space-y-2 px-4 pb-4 text-xs text-slate-600">
                <div className="font-semibold text-wave-900">
                  {t("streak.rules.title")}
                </div>
                <p>1. {t("streak.rules.1")}</p>
                <p>2. {t("streak.rules.2")}</p>
                <p>3. {t("streak.rules.3")}</p>
                <p>4. {t("streak.rules.4")}</p>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </motion.div>

      {/* Quick stats. */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <MiniStat label={t("streak.stat.longest")} value={streak.longest} />
        <MiniStat
          label={t("streak.stat.buoys_used")}
          value={streak.skipsUsed}
        />
      </div>

      <Calendar streak={streak} today={today} firstDay={firstDay} />
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass flex flex-col items-start gap-0.5 px-3 py-2.5"
    >
      <span className="font-display text-xl font-black text-wave-900">
        {value}
      </span>
      <span className="text-[10px] leading-tight text-slate-500">{label}</span>
    </motion.div>
  );
}

function Calendar({
  streak,
  today,
  firstDay,
}: {
  streak: StreakInfo;
  today: number;
  firstDay: number | null;
}) {
  const t = useT();
  const locale = useLocale((s) => s.locale);
  const bcp = localeBcp(locale);
  const now = new Date(today);
  const [view, setView] = useState({
    year: now.getFullYear(),
    month: now.getMonth(),
  });

  const first = firstDay === null ? now : new Date(firstDay);
  const atMin =
    view.year === first.getFullYear() && view.month === first.getMonth();
  const atMax =
    view.year === now.getFullYear() && view.month === now.getMonth();

  const shift = (by: number) =>
    setView(({ year, month }) => {
      const d = new Date(year, month + by, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });

  // Monday-first weekday headers (2024-01-01 is a Monday).
  const weekdays = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) =>
        new Date(2024, 0, 1 + i)
          .toLocaleString(bcp, { weekday: "short" })
          .slice(0, 2),
      ),
    [bcp],
  );

  const cells = useMemo(() => {
    const firstOfMonth = new Date(view.year, view.month, 1);
    const lead = (firstOfMonth.getDay() + 6) % 7; // Monday-start offset
    const count = new Date(view.year, view.month + 1, 0).getDate();
    return [
      ...Array.from({ length: lead }, () => null),
      ...Array.from({ length: count }, (_, i) =>
        new Date(view.year, view.month, i + 1).getTime(),
      ),
    ];
  }, [view]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass mt-3 p-4"
    >
      <div className="mb-3 flex items-center justify-between">
        <button
          onClick={() => shift(-1)}
          disabled={atMin}
          className="rounded-full bg-white/70 p-1.5 ring-1 ring-slate-200 disabled:opacity-30"
          aria-label="‹"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="font-display text-lg font-bold text-wave-900 capitalize">
          {monthLong(view.month)} {view.year}
        </div>
        <button
          onClick={() => shift(1)}
          disabled={atMax}
          className="rounded-full bg-white/70 p-1.5 ring-1 ring-slate-200 disabled:opacity-30"
          aria-label="›"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center">
        {weekdays.map((w) => (
          <div key={w} className="text-[10px] font-semibold text-slate-400">
            {w}
          </div>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <div key={`pad-${i}`} />;
          const state = dayState(day, streak, today, firstDay);
          return (
            <div
              key={day}
              className={cn(
                "mx-auto flex h-8 w-8 items-center justify-center rounded-full text-xs",
                state === "swim" &&
                  "bg-gradient-to-br from-wave-400 to-wave-600 font-bold text-white",
                state === "skip" && "bg-sky-100 ring-1 ring-sky-300",
                state === "missed" && "text-slate-300",
                state === "today" && "font-bold ring-2 ring-wave-400",
                state === "none" &&
                  (day > today ? "text-slate-300/60" : "text-slate-500"),
              )}
            >
              {state === "skip" ? "🛟" : new Date(day).getDate()}
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-500">
        <span className="flex items-center gap-1">
          <span className="h-3 w-3 rounded-full bg-gradient-to-br from-wave-400 to-wave-600" />
          {t("streak.legend.swim")}
        </span>
        <span className="flex items-center gap-1">
          <span className="flex h-3 w-3 items-center justify-center rounded-full bg-sky-100 text-[8px] ring-1 ring-sky-300">
            🛟
          </span>
          {t("streak.legend.skip")}
        </span>
        <span className="flex items-center gap-1">
          <span className="h-3 w-3 rounded-full ring-1 ring-slate-300" />
          {t("streak.legend.missed")}
        </span>
        <span className="flex items-center gap-1">
          <span className="h-3 w-3 rounded-full ring-2 ring-wave-400" />
          {t("streak.legend.today")}
        </span>
      </div>
    </motion.div>
  );
}
