import { useState } from "react";
import { MoreVertical } from "lucide-react";
import type { MapMenuToggle } from "../types";

type MapMenuOptions = Extract<MapMenuToggle, { options: unknown }>;
type MapMenuBoolean = Extract<MapMenuToggle, { checked: boolean }>;

const valueClassName =
  "rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-wave-800 ring-1 ring-slate-200";

function MapBooleanToggle({
  toggle,
  onLabel,
  offLabel,
}: {
  toggle: MapMenuBoolean;
  onLabel: string;
  offLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={() => toggle.onChange(!toggle.checked)}
      aria-pressed={toggle.checked}
      className="flex w-full items-center justify-between gap-3 rounded-xl px-2.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
    >
      <span className="flex items-center gap-2">
        {toggle.icon}
        {toggle.label}
      </span>
      <span className={valueClassName}>
        {toggle.checked ? onLabel : offLabel}
      </span>
    </button>
  );
}

function MapOptionToggle({ toggle }: { toggle: MapMenuOptions }) {
  const currentIndex = toggle.options.findIndex(
    (option) => option.value === toggle.value,
  );
  const currentOption = toggle.options[currentIndex] ?? toggle.options[0];

  function selectNextOption() {
    const nextIndex = (currentIndex + 1) % toggle.options.length;
    toggle.onSelect(toggle.options[nextIndex].value);
  }

  return (
    <button
      type="button"
      onClick={selectNextOption}
      disabled={!currentOption}
      className="flex w-full items-center justify-between gap-3 rounded-xl px-2.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span className="flex items-center gap-2">
        {toggle.icon}
        {toggle.label}
      </span>
      {currentOption ? (
        <span className={valueClassName}>{currentOption.label}</span>
      ) : null}
    </button>
  );
}

/**
 * The ⋯ button + dropdown panel of cycling filter rows. An invisible
 * fixed backdrop closes it on any outside tap (cheaper and more reliable
 * on the map than document-level listeners fighting Leaflet's handlers).
 */
export default function MapFilterMenu({
  toggles,
  ariaLabel,
  onLabel,
  offLabel,
}: {
  toggles: MapMenuToggle[];
  ariaLabel: string;
  onLabel: string;
  offLabel: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={ariaLabel}
        title={ariaLabel}
        aria-expanded={open}
        className="flex h-10 w-10 items-center justify-center rounded-full bg-white/95 text-wave-700 shadow-md ring-1 ring-slate-200 transition hover:bg-white active:scale-95"
      >
        <MoreVertical className="h-5 w-5" />
      </button>
      {open ? (
        <>
          {/* Decorative click-away layer for the menu; the ⋮ trigger stays
              keyboard-accessible, so hide this from assistive tech. */}
          <div
            aria-hidden="true"
            className="fixed inset-0"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 mt-2 w-64 rounded-2xl bg-white/95 p-1.5 shadow-lg ring-1 ring-slate-200">
            {toggles.map((tg) =>
              "options" in tg ? (
                <MapOptionToggle key={tg.label} toggle={tg} />
              ) : (
                <MapBooleanToggle
                  key={tg.label}
                  toggle={tg}
                  onLabel={onLabel}
                  offLabel={offLabel}
                />
              ),
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
