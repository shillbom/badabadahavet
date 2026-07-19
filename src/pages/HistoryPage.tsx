import { m } from "framer-motion";
import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import {
  ChevronRight,
  MapPin,
  Pencil,
  Snowflake,
  Sparkles,
} from "lucide-react";
import { useStore } from "@/store/sessions";
import { useT } from "@/lib/i18n";
import { currentYear, swimYear } from "@/lib/scoring";
import { computeStreak } from "@/lib/streak";
import { dayStartMs } from "@/lib/date";
import Photo from "@/components/Photo";
import SwimPhoto from "@/components/SwimPhoto";
import SwimListItem from "@/components/SwimListItem";
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
  const [showOlder, setShowOlder] = useState(false);

  // The default list only shows the current season; older swims (from past,
  // now-locked years) stay hidden behind a "show older" button.
  const cy = currentYear();
  const currentSeasonSessions = sessions.filter((s) => swimYear(s.date) === cy);
  const hasOlder = sessions.length > currentSeasonSessions.length;
  const defaultList = showOlder ? sessions : currentSeasonSessions;

  const filtered = view === "streak" ? streakSessions(sessions) : defaultList;

  const spots = (() => {
    if (view !== "spots") return [];
    const spotsByPlace = new Map<
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
      const cur = spotsByPlace.get(s.placeId);
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
        spotsByPlace.set(s.placeId, {
          placeId: s.placeId,
          placeName: s.placeName,
          count: 1,
          lastDate: s.date,
          photoUrl: s.photoUrl,
          photoThumb: s.photoThumb,
        });
      }
    }
    return [...spotsByPlace.values()].toSorted(
      (a, b) => b.count - a.count || b.lastDate - a.lastDate,
    );
  })();

  const title =
    view === "streak"
      ? t("history.title.streak")
      : view === "spots"
        ? t("history.title.spots")
        : t("history.title");

  if (sessions.length === 0) {
    return (
      <div className="px-6 pt-16 text-center">
        <m.div
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 220, damping: 18 }}
          className="relative mx-auto mb-4 h-20 w-20"
        >
          {[0, 1].map((i) => (
            <m.span
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
          <m.div
            animate={{ y: [0, -4, 0] }}
            transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
            className="absolute inset-0 flex items-center justify-center rounded-full bg-wave-100 text-3xl"
          >
            🐬
          </m.div>
        </m.div>
        <m.p
          initial={{ y: 6, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.1 }}
          className="font-display text-xl font-bold text-wave-900"
        >
          {t("history.empty.title")}
        </m.p>
        <m.p
          initial={{ y: 6, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.18 }}
          className="mt-1 text-sm text-slate-500"
        >
          {t("history.empty.helper")}
        </m.p>
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
          {view === "streak"
            ? t("history.streak.empty")
            : t("history.season.empty")}
        </p>
      ) : (
        <ul className="space-y-2">
          {filtered.map((s, i) => (
            <SwimListItem
              key={s.id}
              index={i}
              seed={s.id}
              thumb={
                s.photoUrl ? (
                  <SwimPhoto
                    session={s}
                    sessions={filtered}
                    className="h-14 w-14 flex-none rounded-lg ring-1 ring-wave-200 ring-inset"
                  />
                ) : undefined
              }
              title={
                <Link
                  to={`/spot/${s.placeId}`}
                  className="flex items-center gap-1 font-display text-base font-bold text-wave-900"
                >
                  <span className="truncate">{s.placeName}</span>
                  <ChevronRight className="h-3.5 w-3.5 flex-none text-slate-400" />
                </Link>
              }
              points={s.points}
              aside={
                swimYear(s.date) === cy ? (
                  <Link
                    to={`/swim/${s.id}/edit`}
                    className="rounded-full bg-white/80 p-1.5 text-wave-700 ring-1 ring-slate-200 hover:bg-white"
                    aria-label={t("swim.edit")}
                    title={t("swim.edit")}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Link>
                ) : undefined
              }
              date={s.date}
              note={s.note}
            >
              {/* Winter/unique stay as labelled chips here (not the compact
                  inline ❄️/✨ markers) so the history page keeps its richer
                  per-swim context, plus the coordinates chip. */}
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {s.isUniqueForUser ? (
                  <span className="chip">
                    <Sparkles className="h-3 w-3" />{" "}
                    {t("history.chip.new_spot")}
                  </span>
                ) : null}
                {s.isWinter ? (
                  <span className="chip bg-sky-100 text-sky-800 ring-sky-200">
                    <Snowflake className="h-3 w-3" /> {t("history.chip.winter")}
                  </span>
                ) : null}
                <span className="chip">
                  <MapPin className="h-3 w-3" />
                  {s.lat.toFixed(3)}, {s.lng.toFixed(3)}
                </span>
              </div>
            </SwimListItem>
          ))}
        </ul>
      )}

      {!view && hasOlder && !showOlder ? (
        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={() => setShowOlder(true)}
            className="rounded-full bg-white/80 px-4 py-2 text-sm font-semibold text-wave-700 ring-1 ring-slate-200 hover:bg-white"
          >
            {t("history.load_more")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** One tappable spot row in the "spots" history view: a flush square cover
 *  photo (or a water-tinted placeholder), the place name, and the swim count.
 *  Swims use {@link SwimListItem} instead — this row is place-shaped. */
function HistoryRow({
  index,
  to,
  photoUrl,
  photoThumb,
  emoji,
  title,
  meta,
}: {
  index: number;
  to: string;
  photoUrl?: string;
  photoThumb?: string;
  emoji: string;
  title: string;
  meta: string;
}) {
  return (
    <m.li
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
            className="h-20 w-20 flex-none"
          />
        ) : (
          <div className="flex h-20 w-20 flex-none items-center justify-center bg-gradient-to-br from-wave-50 to-wave-200 text-3xl">
            <span className="drop-shadow-sm">{emoji}</span>
          </div>
        )}
        <div className="min-w-0 flex-1 p-3">
          <div className="flex items-center gap-1 font-display text-base font-bold text-wave-900">
            <span className="truncate">{title}</span>
            <ChevronRight className="h-3.5 w-3.5 flex-none text-slate-400" />
          </div>
          <div className="text-[11px] text-slate-500">{meta}</div>
        </div>
      </Link>
    </m.li>
  );
}
