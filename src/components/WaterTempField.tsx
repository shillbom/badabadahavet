import { Thermometer } from "lucide-react";

import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import { Input, Label } from "./ui/Input";

type WaterTempFieldProps = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** Quick-pick temperatures shown as toggleable chips below the input. */
  presets?: number[];
  /** Whether to show the explanatory hint under the field. */
  hint?: boolean;
};

/**
 * Shared water-temperature input used by both the log and edit swim forms.
 * Keeps the two forms in visual sync and keeps each page component small.
 */
export function WaterTempField({
  value,
  onChange,
  disabled,
  presets,
  hint,
}: WaterTempFieldProps) {
  const t = useT();

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <Thermometer className="h-4 w-4 text-teal-600" />
        <Label htmlFor="waterTemp">{t("log.field.water_temp")}</Label>
      </div>
      <div className="relative">
        <Input
          id="waterTemp"
          type="number"
          step="0.1"
          min="-5"
          max="40"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t("log.field.water_temp.placeholder")}
          className="pr-10"
        />
        <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm font-semibold text-slate-400">
          °C
        </span>
      </div>
      {presets && presets.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {presets.map((deg) => (
            <button
              key={deg}
              type="button"
              onClick={() => onChange(value === String(deg) ? "" : String(deg))}
              className={cn(
                "rounded-full px-2.5 py-1 text-xs font-semibold ring-1 transition active:scale-95",
                value === String(deg)
                  ? "bg-wave-600 text-white ring-wave-600"
                  : "bg-white/80 text-slate-700 ring-slate-200 hover:bg-slate-100",
              )}
            >
              {deg}°C
            </button>
          ))}
        </div>
      )}
      {hint && (
        <p className="text-[11px] text-slate-500">
          {t("log.field.water_temp.hint")}
        </p>
      )}
    </div>
  );
}
