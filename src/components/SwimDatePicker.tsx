import { useEffect, useRef, useState } from "react";
import { m, AnimatePresence } from "framer-motion";
import { DayPicker } from "react-day-picker";
import { sv as svLocale, enGB } from "react-day-picker/locale";
import "react-day-picker/style.css";
import { CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { useT } from "@/lib/i18n";
import { toLocalInput } from "@/lib/date";
import { currentSeasonStart } from "@/lib/scoring";

// Intl formatters are expensive to build, so cache one per locale at module
// scope instead of constructing them during render.
const dateTimeFormatCache = new Map<string, Intl.DateTimeFormat>();
function dateTimeFormat(locale: string): Intl.DateTimeFormat {
  let f = dateTimeFormatCache.get(locale);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
    });
    dateTimeFormatCache.set(locale, f);
  }
  return f;
}

type WhenFieldProps = {
  date: string;
  inputLang: string;
  mode: "now" | "pick";
  isNewSpot: boolean;
  isWinterSwim: boolean;
  pointsPreview: number;
  dateValid: boolean;
  updateLocation: (patch: { date: string }) => void;
};

/**
 * The "when did you swim?" field. In "now" mode it shows a read-only stamp of
 * the current time; in "pick" mode it's a compact trigger that opens a
 * react-day-picker calendar in an animated popover (centered modal + backdrop
 * on mobile, popover below the trigger on desktop).
 */
export function WhenField({
  date,
  inputLang,
  mode,
  isNewSpot,
  isWinterSwim,
  pointsPreview,
  dateValid,
  updateLocation,
}: WhenFieldProps) {
  const t = useT();
  // datetime-local strings (YYYY-MM-DDTHH:mm) sort lexicographically, so we can
  // clamp the composed value with plain string comparison — a safety net on top
  // of react-day-picker's disabled range and the parent's dateValid check.
  const seasonStart = new Date(currentSeasonStart());
  const now = new Date();
  const minStr = toLocalInput(seasonStart);
  const maxStr = toLocalInput(now);
  const dpLocale = inputLang === "sv-SE" ? svLocale : enGB;

  const selectedDay = date ? new Date(date) : undefined;
  const timePart = date.length >= 16 ? date.slice(11, 16) : "12:00";

  // Compose a datetime-local string from a chosen day + time, clamped to the
  // valid season window so an out-of-range time snaps back into range.
  const applyDate = (day: Date, time: string) => {
    const [hh, mm] = time.split(":");
    const d = new Date(day);
    d.setHours(Number(hh) || 0, Number(mm) || 0, 0, 0);
    let v = toLocalInput(d);
    if (v < minStr) v = minStr;
    else if (v > maxStr) v = maxStr;
    updateLocation({ date: v });
  };

  // Tint react-day-picker with the app's wave palette.
  const dpStyle = {
    "--rdp-accent-color": "#019eea",
    "--rdp-accent-background-color": "#def1ff",
    "--rdp-today-color": "#007ec6",
  } as React.CSSProperties;

  // Building an Intl formatter is slow, so reuse a module-level cache keyed by
  // locale rather than constructing one on every render.
  const fmt = dateTimeFormat(inputLang);
  const nowLabel = fmt.format(now);
  const selectedLabel = selectedDay ? fmt.format(selectedDay) : "";

  // Keep the compact input as the resting state; reveal the calendar in a
  // popover on tap. Close it when tapping outside.
  const [open, setOpen] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  return (
    <div className="space-y-1.5">
      <Label htmlFor="date">{t("log.field.when")}</Label>
      {mode === "now" ? (
        <div className="rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-500">
          {nowLabel}
        </div>
      ) : (
        <div className="relative" ref={popRef}>
          <button
            type="button"
            id="date"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-describedby={dateValid ? undefined : "date-error"}
            className={`flex w-full items-center gap-2 rounded-xl border bg-white px-3 py-2 text-left text-sm ring-wave-200 transition focus:ring-2 focus:outline-none ${
              dateValid ? "border-wave-200" : "border-rose-400"
            }`}
          >
            <CalendarDays className="size-4 shrink-0 text-wave-600" />
            <span
              className={selectedLabel ? "text-slate-800" : "text-slate-400"}
            >
              {selectedLabel || t("log.date.placeholder")}
            </span>
          </button>
          <AnimatePresence>
            {open ? (
              <>
                <m.div
                  key="backdrop"
                  className="fixed inset-0 z-[1200] bg-slate-900/40 sm:hidden"
                  onClick={() => setOpen(false)}
                  aria-hidden
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                />
                <m.div
                  key="panel"
                  className="fixed top-1/2 left-1/2 z-[1210] max-h-[calc(100dvh-2rem)] w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-wave-200 bg-white p-2 shadow-xl ring-1 ring-wave-100 sm:absolute sm:top-full sm:left-0 sm:mt-1 sm:max-h-none sm:translate-x-0 sm:translate-y-0"
                  initial={{ opacity: 0, scale: 0.96, y: 4 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96, y: 4 }}
                  transition={{ duration: 0.16, ease: "easeOut" }}
                >
                  <div className="flex justify-center">
                    <DayPicker
                      mode="single"
                      required
                      locale={dpLocale}
                      selected={selectedDay}
                      onSelect={(day) => applyDate(day, timePart)}
                      defaultMonth={selectedDay ?? now}
                      startMonth={seasonStart}
                      endMonth={now}
                      disabled={{ before: seasonStart, after: now }}
                      style={dpStyle}
                      className="rdp-badligan"
                    />
                  </div>
                  <div className="mt-1 flex items-center gap-2 border-t border-wave-100 px-1 pt-2">
                    <Label
                      htmlFor="swim-time"
                      className="mb-0 shrink-0 text-slate-500"
                    >
                      {t("log.field.time")}
                    </Label>
                    <Input
                      id="swim-time"
                      type="time"
                      lang={inputLang}
                      value={timePart}
                      onChange={(e) =>
                        applyDate(selectedDay ?? now, e.target.value)
                      }
                      aria-invalid={!dateValid}
                      className="w-auto"
                    />
                    <Button
                      type="button"
                      size="sm"
                      className="ml-auto"
                      onClick={() => setOpen(false)}
                    >
                      {t("log.date.done")}
                    </Button>
                  </div>
                </m.div>
              </>
            ) : null}
          </AnimatePresence>
        </div>
      )}
      {mode === "now" ? (
        <div className="text-[11px] text-slate-500">
          {t("log.field.when.now_hint")}
        </div>
      ) : !dateValid ? (
        <div id="date-error" className="text-[11px] font-medium text-rose-600">
          {t("log.error.date_range")}
        </div>
      ) : null}
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <div className="chip bg-wave-100 text-wave-800 ring-wave-200">
          💧 {t("log.points.swim")}
        </div>
        {isNewSpot ? (
          <div className="chip bg-emerald-100 text-emerald-800 ring-emerald-200">
            ✨ {t("log.points.new_spot")}
          </div>
        ) : null}
        {isWinterSwim ? (
          <div className="chip bg-sky-100 text-sky-800 ring-sky-200">
            ❄️ {t("log.points.winter")}
          </div>
        ) : null}
        <span className="ml-auto font-display text-sm font-black text-wave-700">
          {t("log.points.total", { n: pointsPreview })}
        </span>
      </div>
    </div>
  );
}
