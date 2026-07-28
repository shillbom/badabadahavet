import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type Ref,
} from "react";
import { Thermometer, Minus, Plus, Check } from "lucide-react";

import { useT } from "@/lib/i18n";
import { formatTemp } from "@/lib/temps";
import { cn } from "@/lib/utils";

import BottomSheet from "./BottomSheet";
import { AnimatedNumber } from "./AnimatedNumber";
import { Button } from "./ui/Button";
import { Label } from "./ui/Input";

const MIN = 0;
const MAX = 35;
const STEP = 0.5;
/** Thermometer geometry (px, drawn 1:1 in an SVG). The shaft and the bulb are
 *  two overlapping shapes painted with the same fill and the mercury is
 *  clipped to their union, so the two blend into one silhouette with no seam.
 *  TUBE is the draggable range; the shaft continues past it into the bulb. */
const TUBE = 200;
const TUBE_W = 28;
const BULB_R = 23;
const SVG_W = 52;
const BULB_CY = TUBE + 6;
const SVG_H = BULB_CY + BULB_R + 1;
/** Scale labels drawn alongside the tube (°C). */
const TICKS = [35, 30, 25, 20, 15, 10, 5, 0];

/** Warm water bubbles, cold water snows. */
const WARM_AT = 22;
const COLD_AT = 8;
/** Hand-picked (not random) so the particles keep their positions across
 *  re-renders while dragging. dx is the offset from the tube's centre line. */
const PARTICLES = [
  { dx: -7, size: 3, dur: 2.6, delay: 0, sway: 5 },
  { dx: 5, size: 2, dur: 3.4, delay: 0.8, sway: -6 },
  { dx: -2, size: 2.5, dur: 2.1, delay: 1.5, sway: 4 },
  { dx: 8, size: 1.5, dur: 3.9, delay: 0.3, sway: -3 },
  { dx: -8, size: 2, dur: 3.1, delay: 2.2, sway: 6 },
  { dx: 2, size: 3.5, dur: 2.4, delay: 1.1, sway: -5 },
] as const;

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
        {shown != null
          ? `${formatTemp(shown)}°C`
          : t("log.field.water_temp.add")}
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
  const level = (1 - frac(draft)) * TUBE;

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
            {t("log.field.water_temp.current", {
              temp: formatTemp(currentTemp),
            })}
          </p>
        )}

        {/* Big live readout — odometer roll makes drags feel tactile */}
        <div className="flex items-baseline" style={{ color }}>
          <AnimatedNumber
            value={draft}
            format={formatTemp}
            duration={0.25}
            className="font-display text-6xl leading-none font-black tabular-nums"
          />
          <span className="ml-1 text-2xl font-black">°C</span>
        </div>

        {/* The three columns are top-aligned and the side columns share a
         *  fixed width, so the ticks line up with the tube (not the bulb) and
         *  the tube stays centred under the readout. */}
        <div className="mt-5 flex items-start justify-center gap-3">
          {/* Scale labels */}
          <div className="relative w-12 shrink-0" style={{ height: TUBE }}>
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
            aria-valuetext={`${formatTemp(draft)}°C`}
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
            <ThermometerGauge
              level={level}
              color={color}
              draft={draft}
              trackRef={trackRef}
            />
          </div>

          {/* Stepper — centred against the tube */}
          <div
            className="flex w-12 shrink-0 flex-col items-center justify-center gap-2"
            style={{ height: TUBE }}
          >
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
              onChange(formatTemp(draft));
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

/**
 * The thermometer itself: shaft and bulb are two overlapping shapes sharing
 * one clip path, so the mercury flows between them without a seam. Warm water
 * bubbles, cold water snows — those particles get a second clip to the filled
 * region so they can never escape the coloured part.
 */
function ThermometerGauge({
  level,
  color,
  draft,
  trackRef,
}: {
  level: number;
  color: string;
  draft: number;
  trackRef: Ref<HTMLDivElement>;
}) {
  // useId's raw output contains characters that aren't safe inside url(#…),
  // so strip everything but word characters.
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const clipId = `therm-${uid}`;
  const fillId = `therm-fill-${uid}`;

  const warm = draft >= WARM_AT;
  const cold = draft <= COLD_AT;
  // Particles start just outside the mercury (below the bulb / above the
  // level) so they're already clipped away when a cycle restarts — otherwise
  // every particle pops into existence on the same line.
  const bubbleStart = SVG_H + 10;
  const bubbleTravel = bubbleStart - level + 10;
  const snowStart = level - 12;
  const snowTravel = Math.max(40, BULB_CY + BULB_R - snowStart);

  return (
    <div className="relative" style={{ width: SVG_W, height: SVG_H }}>
      <svg
        width={SVG_W}
        height={SVG_H}
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        aria-hidden
        className="block drop-shadow-sm"
      >
        <defs>
          <clipPath id={clipId}>
            <rect
              x={(SVG_W - TUBE_W) / 2}
              y={0}
              width={TUBE_W}
              height={BULB_CY}
              rx={TUBE_W / 2}
            />
            <circle cx={SVG_W / 2} cy={BULB_CY} r={BULB_R} />
          </clipPath>
          {/* Keeps the bubbles/snow inside the coloured mercury */}
          <clipPath id={fillId}>
            <rect x={0} y={level} width={SVG_W} height={SVG_H - level} />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          {/* Empty glass */}
          <rect
            x={0}
            y={0}
            width={SVG_W}
            height={SVG_H}
            fill="rgb(241 245 249)"
          />
          {/* Mercury — runs from the level all the way into the bulb */}
          <rect
            x={0}
            y={level}
            width={SVG_W}
            height={SVG_H - level}
            fill={color}
          />
          <g clipPath={`url(#${fillId})`}>
            {warm &&
              PARTICLES.map((p) => (
                <circle
                  key={`${p.dx}-${p.delay}`}
                  className="temp-bubble"
                  cx={SVG_W / 2 + p.dx}
                  cy={bubbleStart}
                  r={p.size}
                  fill="rgba(255,255,255,0.75)"
                  style={
                    {
                      "--travel": `${bubbleTravel}px`,
                      "--dur": `${p.dur}s`,
                      "--delay": `${p.delay}s`,
                    } as CSSProperties
                  }
                />
              ))}
            {cold &&
              PARTICLES.map((p) => (
                // The outer <g> places the flake; the inner one is animated,
                // because a CSS transform would otherwise overwrite the
                // positioning transform attribute.
                <g
                  key={`${p.dx}-${p.delay}`}
                  transform={`translate(${SVG_W / 2 + p.dx} ${snowStart})`}
                >
                  <g
                    className="temp-snow"
                    style={
                      {
                        "--travel": `${snowTravel}px`,
                        "--sway": `${p.sway}px`,
                        "--dur": `${p.dur * 1.6}s`,
                        "--delay": `${p.delay}s`,
                      } as CSSProperties
                    }
                  >
                    <path
                      d="M0,-4 V4 M-3.5,-2 L3.5,2 M-3.5,2 L3.5,-2"
                      stroke="rgba(255,255,255,0.9)"
                      strokeWidth={1.2}
                      strokeLinecap="round"
                      fill="none"
                    />
                  </g>
                </g>
              ))}
          </g>
        </g>
        {/* Level marker */}
        <rect
          x={(SVG_W - TUBE_W) / 2 - 4}
          y={level - 3}
          width={TUBE_W + 8}
          height={6}
          rx={3}
          fill="rgba(255,255,255,0.92)"
          stroke="rgba(0,0,0,0.06)"
        />
      </svg>
      {/* Measures the draggable range only (the shaft above the bulb) */}
      <div
        ref={trackRef}
        className="pointer-events-none absolute inset-x-0 top-0"
        style={{ height: TUBE }}
      />
    </div>
  );
}
