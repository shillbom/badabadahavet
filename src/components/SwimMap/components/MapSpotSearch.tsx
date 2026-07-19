import { MapPin, Search, X } from "lucide-react";
import type { RefObject } from "react";
import type { PlaceWithTemp, SessionDoc } from "@/lib/types";
import { useT } from "@/lib/i18n";
import { hasFreshTemp } from "../pinUtils";

/**
 * The fullscreen-only spot search: a pinned search box across the top plus
 * the results dropdown. Picking a result focuses that place via the same
 * machinery as the `focusPlaceId` prop.
 */
export default function MapSpotSearch({
  query,
  setQuery,
  searchResults,
  pickSearchResult,
  searchInputRef,
  sessionsByPlace,
}: {
  query: string;
  setQuery: React.Dispatch<React.SetStateAction<string>>;
  searchResults: PlaceWithTemp[];
  pickSearchResult: (p: PlaceWithTemp) => void;
  searchInputRef: RefObject<HTMLInputElement | null>;
  sessionsByPlace: Map<string, SessionDoc[]>;
}) {
  const t = useT();
  return (
    // left-14 keeps clear of Leaflet's zoom control (top-left, ~44px).
    <div className="absolute top-[max(env(safe-area-inset-top),0.75rem)] right-3 left-14 z-[650]">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          ref={searchInputRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && searchResults[0])
              pickSearchResult(searchResults[0]);
          }}
          placeholder={t("map.search.placeholder")}
          aria-label={t("map.search.placeholder")}
          className="w-full rounded-full bg-white/95 py-2.5 pr-9 pl-9 text-sm text-wave-900 shadow-md ring-1 ring-slate-200 outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-wave-400 [&::-webkit-search-cancel-button]:hidden"
        />
        {query ? (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label={t("common.close")}
            className="absolute top-1/2 right-2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      {query.trim() ? (
        <ul className="mt-2 max-h-64 overflow-y-auto rounded-2xl bg-white/95 shadow-lg ring-1 ring-slate-200 backdrop-blur">
          {searchResults.length === 0 ? (
            <li className="px-3 py-2.5 text-sm text-slate-500">
              {t("map.search.no_results")}
            </li>
          ) : (
            searchResults.map((p) => {
              const swims = sessionsByPlace.get(p.id)?.length ?? 0;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    // pickSearchResult only touches refs inside the click
                    // handler (allowed) — the compiler just can't prove it.
                    // react-doctor-disable-next-line react-hooks-js/refs
                    onClick={() => pickSearchResult(p)}
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition hover:bg-wave-50"
                  >
                    <MapPin className="h-3.5 w-3.5 flex-none text-wave-600" />
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-wave-900">
                      {p.name}
                    </span>
                    <span className="flex-none text-[11px] text-slate-500">
                      {swims === 1
                        ? t("map.popup.swims_one")
                        : swims > 0
                          ? t("map.popup.swims_many", { n: swims })
                          : t("map.popup.no_swims_yet")}
                      {hasFreshTemp(p)
                        ? ` · 💧 ${Math.round(p.waterTemp)}°`
                        : ""}
                    </span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      ) : null}
    </div>
  );
}
