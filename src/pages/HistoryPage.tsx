import { useMemo } from "react";
import { motion } from "framer-motion";
import { Link, useSearchParams } from "react-router-dom";
import { ChevronRight, MapPin, Snowflake, Sparkles } from "lucide-react";
import { useStore } from "@/store/sessions";
import { formatDateTime } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import Photo from "@/components/Photo";
import type { SessionDoc } from "@/lib/types";

const DAY_MS = 24 * 60 * 60 * 1000;

function dayStartMs(ts: number): number {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function streakSessions(sessions: SessionDoc[]): SessionDoc[] {
  const days = new Set(sessions.map((s) => dayStartMs(s.date)));
  let cursor = dayStartMs(Date.now());
  if (!days.has(cursor)) cursor -= DAY_MS;
  const streakDays = new Set<number>();
  while (days.has(cursor)) {
    streakDays.add(cursor);
    cursor -= DAY_MS;
  }
  return sessions.filter((s) => streakDays.has(dayStartMs(s.date)));
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
            <motion.li
              key={p.placeId}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i, 8) * 0.03 }}
              className="glass overflow-hidden p-0"
            >
              <Link to={`/spot/${p.placeId}`} className="flex">
                {p.photoUrl ? (
                  <Photo
                    src={p.photoUrl}
                    thumb={p.photoThumb}
                    className="h-20 w-20 flex-none"
                  />
                ) : (
                  <div className="flex h-20 w-20 flex-none items-center justify-center bg-wave-100 text-3xl">
                    📍
                  </div>
                )}
                <div className="min-w-0 flex-1 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1 truncate font-display text-base font-bold text-wave-900">
                        {p.placeName}
                        <ChevronRight className="h-3.5 w-3.5 flex-none text-slate-400" />
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {p.count === 1
                          ? t("history.spots.count_one")
                          : t("history.spots.count_many", { n: p.count })}
                      </div>
                    </div>
                  </div>
                </div>
              </Link>
            </motion.li>
          ))}
        </ul>
      ) : filtered.length === 0 ? (
        <p className="rounded-2xl bg-white/70 px-4 py-6 text-center text-sm text-slate-500 ring-1 ring-slate-200/60">
          {t("history.streak.empty")}
        </p>
      ) : (
        <ul className="space-y-2">
          {filtered.map((s, i) => (
            <motion.li
              key={s.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i, 8) * 0.03 }}
              className="glass overflow-hidden p-0"
            >
              <Link to={`/spot/${s.placeId}`} className="flex">
                {s.photoUrl ? (
                  <Photo
                    src={s.photoUrl}
                    thumb={s.photoThumb}
                    className="m-2 h-20 w-20 flex-none rounded-lg"
                  />
                ) : (
                  <div className="flex h-20 w-20 flex-none items-center justify-center bg-wave-100 text-3xl">
                    🌊
                  </div>
                )}
                <div className="min-w-0 flex-1 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1 truncate font-display text-base font-bold text-wave-900">
                        {s.placeName}
                        <ChevronRight className="h-3.5 w-3.5 flex-none text-slate-400" />
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {formatDateTime(s.date)}
                      </div>
                    </div>
                    <div className="flex flex-col items-end">
                      <div className="font-display text-lg font-black text-wave-700">
                        +{s.points}
                      </div>
                    </div>
                  </div>
                  {s.note ? (
                    <p className="mt-1 line-clamp-2 text-xs text-slate-600">
                      {s.note}
                    </p>
                  ) : null}
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
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
                  </div>
                </div>
              </Link>
            </motion.li>
          ))}
        </ul>
      )}
    </div>
  );
}
