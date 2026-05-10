import { motion } from "framer-motion";
import { MapPin, Snowflake, Sparkles } from "lucide-react";
import { useStore } from "@/store/sessions";
import { formatDateTime } from "@/lib/utils";

export default function HistoryPage() {
  const sessions = useStore((s) => s.mySessions);

  if (sessions.length === 0) {
    return (
      <div className="px-6 pt-12 text-center">
        <div className="mx-auto mb-3 h-16 w-16 rounded-full bg-wave-100 text-3xl leading-[4rem]">
          🐬
        </div>
        <p className="font-display text-xl font-bold text-wave-900">
          No swims yet
        </p>
        <p className="mt-1 text-sm text-slate-500">
          Tap the + button to log your first dip.
        </p>
      </div>
    );
  }

  return (
    <div className="px-4 pt-2">
      <h2 className="mb-3 font-display text-2xl font-black text-wave-900">
        History
      </h2>
      <ul className="space-y-2">
        {sessions.map((s, i) => (
          <motion.li
            key={s.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(i, 8) * 0.03 }}
            className="glass overflow-hidden p-0"
          >
            <div className="flex">
              {s.photoUrl ? (
                <img
                  src={s.photoUrl}
                  alt=""
                  className="h-20 w-20 flex-none object-cover"
                />
              ) : (
                <div className="flex h-20 w-20 flex-none items-center justify-center bg-wave-100 text-3xl">
                  🌊
                </div>
              )}
              <div className="min-w-0 flex-1 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-display text-base font-bold text-wave-900">
                      {s.placeName}
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
                      <Sparkles className="h-3 w-3" /> new spot
                    </span>
                  ) : null}
                  {s.isWinter ? (
                    <span className="chip bg-sky-100 text-sky-800 ring-sky-200">
                      <Snowflake className="h-3 w-3" /> winter
                    </span>
                  ) : null}
                  <span className="chip">
                    <MapPin className="h-3 w-3" />
                    {s.lat.toFixed(3)}, {s.lng.toFixed(3)}
                  </span>
                </div>
              </div>
            </div>
          </motion.li>
        ))}
      </ul>
    </div>
  );
}
