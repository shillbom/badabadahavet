import { useMemo } from "react";
import { motion } from "framer-motion";
import { Link, useSearchParams } from "react-router";
import { ChevronRight, MapPin, Snowflake, Sparkles } from "lucide-react";
import { useStore } from "@/store/sessions";
import { formatDateTime } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import { computeStreak } from "@/lib/streak";
import { dayStartMs } from "@/lib/date";
import Photo from "@/components/Photo";
import type { SessionDoc } from "@/lib/types";

function streakSessions(sessions: SessionDoc[]): SessionDoc[] {
  const start = computeStreak(sessions.map((s) => s.date)).currentStart;
  if (start === null) return [];
  return sessions.filter((s) => dayStartMs(s.date) >= start);
}

export default function HistoryPage() {
  const sessions = useStore((s) => s.mySessions);
  const t = useT();
  const [params] = useSearchParams();
  const view = params.get("view");

  const filtered = useMemo(() => {
    if (view === "streak") return streakSessions(sessions);
    return sessions;
  }, [sessions, view]);

  const spots = useMemo(() => {
    if (view !== "spots") return [];
    const m = new Map<
      string,
      {
        placeId: string;
        placeName: string;
        count: number;
        lastDate: number;
        photoUrl?: string;
        photoThumb?: string;
      }
    >();
    for (const s of sessions) {
      const cur = m.get(s.placeId);
      if (cur) {
        cur.count += 1;
        if (s.date > cur.lastDate) {
          cur.lastDate = s.date;
          if (s.photoUrl) {
            cur.photoUrl = s.photoUrl;
            cur.photoThumb = s.photoThumb;
          }
        }
      } else {
        m.set(s.placeId, {
          placeId: s.placeId,
          placeName: s.placeName,
          count: 1,
          lastDate: s.date,
          photoUrl: s.photoUrl,
          photoThumb: s.photoThumb,
        });
      }
    }
    return [...m.values()].sort(
      (a, b) => b.count - a.count || b.lastDate - a.lastDate,
    );
  }, [sessions, view]);

  const title =
    view === "streak"
      ? t("history.title.streak")
      : view === "spots"
        ? t("history.title.spots")
        : t("history.title");

  if (sessions.length === 0) {
    return (
      <div className="px-6 pt-16 text-center">
        <motion.div
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 220, damping: 18 }}
          className="relative mx-auto mb-4 h-20 w-20"
        >
          {[0, 1].map((i) => (
            <motion.span
              key={i}
              initial={{ scale: 0.6, opacity: 0.5 }}
              animate={{ scale: 1.6, opacity: 0 }}
              transition={{
                duration: 1.8,
                delay: i * 0.6,
                repeat: Infinity,
                ease: "easeOut",
              }}
              className="absolute inset-0 rounded-full border-2 border-wave-300"
            />
          ))}
          <motion.div
            animate={{ y: [0, -4, 0] }}
            transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
            className="absolute inset-0 flex items-center justify-center rounded-full bg-wave-100 text-3xl"
          >
            🐬
          </motion.div>
        </motion.div>
        <motion.p
          initial={{ y: 6, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.1 }}
          className="font-display text-xl font-bold text-wave-900"
        >
          {t("history.empty.title")}
        </motion.p>
        <motion.p
          initial={{ y: 6, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.18 }}
          className="mt-1 text-sm text-slate-500"
        >
          {t("history.empty.helper")}
        </motion.p>
      </div>
    );
  }

  return (
    <div className="px-4 pt-2">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-2xl font-black text-wave-900">
          {title}
        </h2>
        {view ? (
          <Link
            to="/history"
            className="text-xs font-semibold text-wave-700 hover:underline"
          >
            {t("history.back")}
          </Link>
        ) : null}
      </div>

      {view === "spots" ? (
        <ul className="space-y-2">
          {spots.map((p, i) => (
            <HistoryRow
              key={p.placeId}
              index={i}
              to={`/spot/${p.placeId}`}
              photoUrl={p.photoUrl}
              photoThumb={p.photoThumb}
              emoji="📍"
              title={p.placeName}
              meta={
                p.count === 1
                  ? t("history.spots.count_one")
                  : t("history.spots.count_many", { n: p.count })
              }
            />
          ))}
        </ul>
      ) : filtered.length === 0 ? (
        <p className="rounded-2xl bg-white/70 px-4 py-6 text-center text-sm text-slate-500 ring-1 ring-slate-200/60">
          {t("history.streak.empty")}
        </p>
      ) : (
        <ul className="space-y-2">
          {filtered.map((s, i) => (
            <HistoryRow
              key={s.id}
              index={i}
              to={`/spot/${s.placeId}`}
              photoUrl={s.photoUrl}
              photoThumb={s.photoThumb}
              photoRounded
              emoji="🌊"
              title={s.placeName}
              meta={formatDateTime(s.date)}
              points={s.points}
              note={s.note}
              chips={
                <>
                  {s.isUniqueForUser ? (
                    <span className="chip">
                      <Sparkles className="h-3 w-3" />{" "}
                      {t("history.chip.new_spot")}
                    </span>
                  ) : null}
                  {s.isWinter ? (
                    <span className="chip bg-sky-100 text-sky-800 ring-sky-200">
                      <Snowflake className="h-3 w-3" />{" "}
                      {t("history.chip.winter")}
                    </span>
                  ) : null}
                  <span className="chip">
                    <MapPin className="h-3 w-3" />
                    {s.lat.toFixed(3)}, {s.lng.toFixed(3)}
                  </span>
                </>
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/** One tappable history row: photo/emoji square, name + meta, and for swim
 *  rows a points badge, note, and chips. Shared by the spots and swims views. */
function HistoryRow({
  index,
  to,
  photoUrl,
  photoThumb,
  photoRounded,
  emoji,
  title,
  meta,
  points,
  note,
  chips,
}: {
  index: number;
  to: string;
  photoUrl?: string;
  photoThumb?: string;
  /** Swim photos float with a margin + rounded corners; spot photos sit flush. */
  photoRounded?: boolean;
  emoji: string;
  title: string;
  meta: string;
  points?: number;
  note?: string | null;
  chips?: React.ReactNode;
}) {
  return (
    <motion.li
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 8) * 0.03 }}
      className="glass overflow-hidden p-0"
    >
      <Link to={to} className="flex">
        {photoUrl ? (
          <Photo
            src={photoUrl}
            thumb={photoThumb}
            className={
              photoRounded
                ? "m-2 h-20 w-20 flex-none rounded-lg"
                : "h-20 w-20 flex-none"
            }
          />
        ) : (
          <div className="flex h-20 w-20 flex-none items-center justify-center bg-wave-100 text-3xl">
            {emoji}
          </div>
        )}
        <div className="min-w-0 flex-1 p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1 truncate font-display text-base font-bold text-wave-900">
                {title}
                <ChevronRight className="h-3.5 w-3.5 flex-none text-slate-400" />
              </div>
              <div className="text-[11px] text-slate-500">{meta}</div>
            </div>
            {points != null ? (
              <div className="flex flex-col items-end">
                <div className="font-display text-lg font-black text-wave-700">
                  +{points}
                </div>
              </div>
            ) : null}
          </div>
          {note ? (
            <p className="mt-1 line-clamp-2 text-xs text-slate-600">{note}</p>
          ) : null}
          {chips ? (
            <div className="mt-1.5 flex flex-wrap gap-1.5">{chips}</div>
          ) : null}
        </div>
      </Link>
    </motion.li>
  );
}
