import type { MapAction } from "../types";

export default function MapActionButton({ action }: { action: MapAction }) {
  return (
    <button
      type="button"
      onClick={action.onClick}
      aria-label={action.ariaLabel ?? action.label}
      className="flex items-center gap-1.5 rounded-full bg-white/95 px-3 py-1.5 text-xs font-semibold text-wave-800 shadow-md ring-1 ring-slate-200 transition hover:bg-white active:scale-95"
    >
      {action.icon}
      {action.label}
    </button>
  );
}
