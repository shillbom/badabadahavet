import { useEffect, useRef, useState } from "react";
import { Thermometer, Minus, Plus, Check } from "lucide-react";

import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import BottomSheet from "./BottomSheet";
import { AnimatedNumber } from "./AnimatedNumber";
import { Button } from "./ui/Button";
import { Label } from "./ui/Input";

const MIN = 0;
const MAX = 35;
const STEP = 0.5;
const TUBE = 200;
/** Scale labels drawn alongside the tube (°C). */
const TICKS = [35, 30, 25, 20, 15, 10, 5, 0];

const clamp = (n: number) => Math.min(MAX, Math.max(MIN, n));
const snap = (n: number) => Math.round(clamp(n) / STEP) * STEP;
const frac = (deg: number) => (clamp(deg) - MIN) / (MAX - MIN);

type RGB = readonly [number, number, number];
/** Ice-blue → blue → red. Interpolated in RGB so it never passes through
 *  green/teal — a colder reading always looks icy, a warmer one hot. */
const COLOR_STOPS: readonly { at: number; rgb: RGB }[] = [
  { at: 0, rgb: [56, 189, 248] }, // ice blue (sky-400)
  { at: 0.5, rgb: [37, 99, 235] }, // blue (blue-600)
  { at: 1, rgb: [220, 38, 38] }, // red (red-600)
];
const tempColor = (deg: number) => {
  const f = frac(deg);
  let lo = COLOR_STOPS[0];
  let hi = COLOR_STOPS[COLOR_STOPS.length - 1];
  for (let i = 0; i < COLOR_STOPS.length - 1; i++) {
    if (f >= COLOR_STOPS[i].at && f <= COLOR_STOPS[i + 1].at) {
      lo = COLOR_STOPS[i];
      hi = COLOR_STOPS[i + 1];
      break;
    }
  }
  const p = (f - lo.at) / (hi.at - lo.at || 1);
  const mix = (i: number) =>
    Math.round(lo.rgb[i] + (hi.rgb[i] - lo.rgb[i]) * p);
  return `rgb(${mix(0)}, ${mix(1)}, ${mix(2)})`;
};

/** Trim a trailing ".0" so whole degrees read "18°C", halves read "18.5°C". */
const fmt = (deg: number) => String(Math.round(deg * 10) / 10);

type WaterTempFieldProps = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** Latest measured temperature for the picked spot — used as the default
   *  when the field is still empty. */
  currentTemp?: number;
  /** Whether to show the explanatory hint under the badge. */
  hint?: boolean;
};

/**
 * Shared water-temperature control used by both the log and edit swim forms.
 * Renders a compact badge that opens a thermometer-style picker instead of a
 * bare number input, keeping the two forms in visual sync.
 */
export function WaterTempField({
  value,
  onChange,
  disabled,
  currentTemp,
  hint,
}: WaterTempFieldProps) {
  const t = useT();
  const [open, setOpen] = useState(false);

  const parsed = value.trim() ? parseFloat(value.replace(",", ".")) : NaN;
  const hasValue = Number.isFinite(parsed);
  // Preset the badge to the spot's current reading when nothing's been
  // entered yet, so tapping it opens the picker already on that value.
  const shown = hasValue ? parsed : (currentTemp ?? null);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <Thermometer className="h-4 w-4 text-teal-600" />
        <Label>{t("log.field.water_temp")}</Label>
      </div>

      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className={cn(
          "inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-bold shadow-sm ring-1 transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-60",
          shown != null
            ? "text-white ring-transparent"
            : "bg-white/80 text-slate-600 ring-slate-200 hover:bg-slate-100",
        )}
        style={
          shown != null ? { backgroundColor: tempColor(shown) } : undefined
        }
      >
        <Thermometer className="h-4 w-4" />
        {shown != null ? `${fmt(shown)}°C` : t("log.field.water_temp.add")}
      </button>

      {hint && (
        <p className="text-[11px] text-slate-500">
          {t("log.field.water_temp.hint")}
        </p>
      )}

      <TempSheet
        open={open}
        onClose={() => setOpen(false)}
        value={value}
        currentTemp={currentTemp}
        onChange={onChange}
      />
    </div>
  );
}

function TempSheet({
  open,
  onClose,
  value,
  currentTemp,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  value: string;
  currentTemp?: number;
  onChange: (value: string) => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState(15);
  const trackRef = useRef<HTMLDivElement>(null);
  const sliderRef = useRef<HTMLDivElement>(null);

  // Seed the draft each time the sheet opens: the existing reading if set,
  // otherwise the spot's current temperature, otherwise a mild default.
  useEffect(() => {
    if (!open) return;
    const parsed = value.trim() ? parseFloat(value.replace(",", ".")) : NaN;
    const base = Number.isFinite(parsed) ? parsed : (currentTemp ?? 15);
    setDraft(snap(base));
  }, [open, value, currentTemp]);

  // Drive the slider from native pointer events, tracking on the window while
  // dragging so the value keeps updating even if the finger leaves the tube.
  // stopPropagation on pointerdown keeps the gesture from reaching the bottom
  // sheet's framer-motion drag handler (which would otherwise drag the sheet).
  useEffect(() => {
    const el = sliderRef.current;
    if (!el || !open) return;
    let active = false;
    const setFrom = (clientY: number) => {
      const tube = trackRef.current;
      if (!tube) return;
      const rect = tube.getBoundingClientRect();
      const f = 1 - (clientY - rect.top) / rect.height;
      setDraft(snap(MIN + Math.min(1, Math.max(0, f)) * (MAX - MIN)));
    };
    const move = (e: PointerEvent) => {
      if (!active) return;
      e.preventDefault();
      setFrom(e.clientY);
    };
    const end = () => {
      active = false;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
    const down = (e: PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();
      active = true;
      setFrom(e.clientY);
      window.addEventListener("pointermove", move, { passive: false });
      window.addEventListener("pointerup", end);
      window.addEventListener("pointercancel", end);
    };
    el.addEventListener("pointerdown", down);
    return () => {
      el.removeEventListener("pointerdown", down);
      end();
    };
  }, [open]);

  const nudge = (delta: number) => setDraft((d) => snap(d + delta));

  const color = tempColor(draft);
  const fillPct = frac(draft) * 100;

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      size="small"
      title={t("log.field.water_temp")}
    >
      <div className="flex flex-col items-center px-4 pt-1 pb-2">
        {currentTemp != null && (
          <p className="mb-2 text-xs font-medium text-slate-500">
            {t("log.field.water_temp.current", { temp: fmt(currentTemp) })}
          </p>
        )}

        {/* Big live readout — odometer roll makes drags feel tactile */}
        <div className="flex items-baseline" style={{ color }}>
          <AnimatedNumber
            value={draft}
            format={(n) => n.toFixed(1)}
            duration={0.25}
            className="font-display text-6xl leading-none font-black tabular-nums"
          />
          <span className="ml-1 text-2xl font-black">°C</span>
        </div>

        <div className="mt-5 flex items-end gap-3">
          {/* Scale labels */}
          <div className="relative" style={{ height: TUBE }}>
            {TICKS.map((v) => (
              <div
                key={v}
                className="absolute right-0 flex -translate-y-1/2 items-center gap-1"
                style={{ top: `${(1 - frac(v)) * 100}%` }}
              >
                <span className="text-[10px] text-slate-400 tabular-nums">
                  {v}
                </span>
                <span className="block h-px w-2 bg-slate-300" />
              </div>
            ))}
          </div>

          {/* Thermometer (drag target) */}
          <div
            ref={sliderRef}
            role="slider"
            tabIndex={0}
            aria-label={t("log.field.water_temp")}
            aria-valuemin={MIN}
            aria-valuemax={MAX}
            aria-valuenow={draft}
            aria-valuetext={`${fmt(draft)}°C`}
            onKeyDown={(e) => {
              if (e.key === "ArrowUp" || e.key === "ArrowRight") {
                e.preventDefault();
                nudge(STEP);
              } else if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
                e.preventDefault();
                nudge(-STEP);
              }
            }}
            className="relative flex cursor-pointer touch-none flex-col items-center outline-none select-none"
          >
            {/* Tube */}
            <div
              ref={trackRef}
              className="relative w-7 overflow-hidden rounded-full bg-slate-100 ring-1 ring-slate-200 ring-inset"
              style={{ height: TUBE }}
            >
              <div
                className="absolute inset-x-0 bottom-0"
                style={{ height: `${fillPct}%`, backgroundColor: color }}
              />
              {/* Level marker */}
              <div
                className="pointer-events-none absolute inset-x-0 -translate-y-1/2"
                style={{ top: `${100 - fillPct}%` }}
              >
                <div className="mx-auto h-1.5 w-9 rounded-full border border-black/5 bg-white/90 shadow" />
              </div>
            </div>
            {/* Bulb — overlaps the tube so the mercury reads as continuous */}
            <div
              className="-mt-2 h-11 w-11 rounded-full shadow-lg ring-[3px] ring-white"
              style={{ backgroundColor: color }}
            />
          </div>

          {/* Stepper */}
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => nudge(STEP)}
              aria-label="+0.5"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-200 active:scale-90"
            >
              <Plus className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => nudge(-STEP)}
              aria-label="-0.5"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-200 active:scale-90"
            >
              <Minus className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Actions */}
        <div className="mt-6 flex w-full gap-2">
          {value.trim() && (
            <Button
              type="button"
              variant="ghost"
              className="flex-1"
              onClick={() => {
                onChange("");
                onClose();
              }}
            >
              {t("log.field.water_temp.clear")}
            </Button>
          )}
          <Button
            type="button"
            className="flex-1"
            icon={<Check className="h-4 w-4" />}
            onClick={() => {
              onChange(fmt(draft));
              onClose();
            }}
          >
            {t("log.field.water_temp.set")}
          </Button>
        </div>
      </div>
    </BottomSheet>
  );
}
