import { useState } from "react";
import { MoreVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MapMenuToggle } from "../types";

/**
 * The ⋯ button + dropdown panel of on/off filter rows. An invisible
 * fixed backdrop closes it on any outside tap (cheaper and more reliable
 * on the map than document-level listeners fighting Leaflet's handlers).
 */
export default function MapFilterMenu({
  toggles,
  ariaLabel,
}: {
  toggles: MapMenuToggle[];
  ariaLabel: string;
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
                <div
                  key={tg.label}
                  className="rounded-xl px-2.5 py-2 text-sm font-medium text-slate-700"
                >
                  <span className="flex items-center gap-2">
                    {tg.icon}
                    {tg.label}
                  </span>
                  <div className="mt-1.5 flex rounded-full bg-slate-100 p-0.5">
                    {tg.options.map((o) => (
                      <button
                        key={o.value}
                        type="button"
                        onClick={() => tg.onSelect(o.value)}
                        className={cn(
                          "flex-1 rounded-full px-2 py-1 text-[11px] font-semibold transition",
                          tg.value === o.value
                            ? "bg-white text-wave-800 shadow-sm ring-1 ring-slate-200"
                            : "text-slate-500 hover:text-slate-700",
                        )}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <label
                  key={tg.label}
                  className="flex cursor-pointer items-center justify-between gap-3 rounded-xl px-2.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  <span className="flex items-center gap-2">
                    {tg.icon}
                    {tg.label}
                  </span>
                  <input
                    type="checkbox"
                    checked={tg.checked}
                    onChange={(e) => tg.onChange(e.target.checked)}
                    className="h-4 w-4 flex-none rounded border-slate-300 text-wave-600 focus:ring-wave-400"
                  />
                </label>
              ),
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
