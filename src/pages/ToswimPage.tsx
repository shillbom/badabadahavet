import { useState } from "react";
import { Link } from "react-router";
import { m } from "framer-motion";
import {
  Check,
  ChevronRight,
  ListChecks,
  MapPin,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { useStore } from "@/store/sessions";
import { addToSwim, removeFromSwim } from "@/lib/data";
import { useT } from "@/lib/i18n";
import { formatDate } from "@/lib/utils";
import { toast } from "@/components/ui/toastStore";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import SegmentedControl from "@/components/ui/SegmentedControl";
import type { PlacePin, ToswimEntry } from "@/lib/types";

type View = "todo" | "done";

export default function ToswimPage() {
  const t = useT();
  const { user, profile } = useAuth();
  const places = useStore((s) => s.places);
  const mySessions = useStore((s) => s.mySessions);
  const [view, setView] = useState<View>("todo");
  const [search, setSearch] = useState("");

  const placesById = new Map<string, PlacePin>();
  for (const p of places) placesById.set(p.id, p);

  // First swim date per place — undefined means I haven't swum there yet.
  const firstSwimAt = new Map<string, number>();
  for (const s of mySessions) {
    const cur = firstSwimAt.get(s.placeId);
    if (cur === undefined || s.date < cur) firstSwimAt.set(s.placeId, s.date);
  }

  const entries: Array<{
    placeId: string;
    place: PlacePin | null;
    entry: ToswimEntry;
    doneAt: number | undefined;
  }> = [];
  const toswim = profile?.toswim ?? {};
  for (const [placeId, entry] of Object.entries(toswim)) {
    entries.push({
      placeId,
      place: placesById.get(placeId) ?? null,
      entry,
      doneAt: firstSwimAt.get(placeId),
    });
  }
  entries.sort((a, b) => b.entry.addedAt - a.entry.addedAt);

  const todo = entries.filter((e) => e.doneAt === undefined);
  const done = entries.filter((e) => e.doneAt !== undefined);
  const visible = view === "todo" ? todo : done;

  const onMyList = new Set(Object.keys(profile?.toswim ?? {}));

  const searchResults = (() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return places.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 12);
  })();

  async function onAdd(placeId: string, name: string) {
    if (!user) return;
    try {
      await addToSwim(user.uid, placeId);
      toast.success(t("toswim.added", { name }));
    } catch {
      toast.error(t("toswim.add_error"));
    }
  }

  async function onRemove(placeId: string, name: string) {
    if (!user) return;
    try {
      await removeFromSwim(user.uid, placeId);
      toast.success(t("toswim.removed", { name }));
    } catch {
      toast.error(t("toswim.remove_error"));
    }
  }

  return (
    <div className="px-4 pt-2">
      <div className="mb-3 flex items-center gap-2">
        <ListChecks className="h-5 w-5 text-wave-700" />
        <h2 className="font-display text-2xl font-black text-wave-900">
          {t("toswim.title")}
        </h2>
      </div>

      <div className="glass mb-4 p-3">
        <label
          htmlFor="toswim-search"
          className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-wave-700 uppercase"
        >
          <Search className="h-3 w-3" /> {t("toswim.search.label")}
        </label>
        <Input
          id="toswim-search"
          type="search"
          autoComplete="off"
          placeholder={t("toswim.search.placeholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search.trim() ? (
          <ul className="mt-2.5 max-h-64 space-y-1.5 overflow-y-auto">
            {searchResults.length === 0 ? (
              <li className="rounded-xl bg-white/60 p-3 text-center text-xs text-slate-500 ring-1 ring-slate-200/60">
                {t("toswim.search.empty")}
              </li>
            ) : (
              searchResults.map((p) => {
                const already = onMyList.has(p.id);
                return (
                  <li
                    key={p.id}
                    className="flex items-center justify-between gap-2 rounded-xl bg-white/70 px-3 py-2.5 shadow-sm ring-1 ring-white/60"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-wave-900">
                        {p.name}
                      </div>
                      <div className="flex items-center gap-1 text-[10px] text-slate-500">
                        <MapPin className="h-2.5 w-2.5" />
                        {p.lat.toFixed(3)}, {p.lng.toFixed(3)}
                      </div>
                    </div>
                    {already ? (
                      <span className="inline-flex flex-none items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold text-emerald-800 ring-1 ring-emerald-200">
                        <Check className="h-3 w-3" />
                        {t("toswim.on_list")}
                      </span>
                    ) : (
                      <Button
                        size="xs"
                        className="flex-none"
                        icon={<Plus className="h-3 w-3" />}
                        onClick={() => onAdd(p.id, p.name)}
                      >
                        {t("toswim.add")}
                      </Button>
                    )}
                  </li>
                );
              })
            )}
          </ul>
        ) : null}
      </div>

      <SegmentedControl
        className="mb-3"
        value={view}
        onChange={setView}
        options={[
          { value: "todo", label: t("toswim.tab.todo", { n: todo.length }) },
          { value: "done", label: t("toswim.tab.done", { n: done.length }) },
        ]}
      />

      {visible.length === 0 ? (
        <div className="rounded-2xl bg-white/60 p-8 text-center text-sm text-slate-500 ring-1 ring-slate-200/60">
          {view === "todo" ? t("toswim.empty.todo") : t("toswim.empty.done")}
        </div>
      ) : (
        <ul className="mb-4 space-y-2">
          {visible.map((e, i) => (
            <m.li
              key={e.placeId}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i, 8) * 0.03 }}
              className="glass overflow-hidden p-0"
            >
              <div className="flex items-stretch">
                {e.place ? (
                  <Link
                    to={`/spot/${e.place.id}`}
                    className="flex flex-1 items-center gap-3 p-3"
                  >
                    <div
                      className={`flex h-12 w-12 flex-none items-center justify-center rounded-xl text-2xl ${
                        e.doneAt !== undefined
                          ? "bg-emerald-100 ring-1 ring-emerald-200"
                          : "bg-wave-100 ring-1 ring-wave-200"
                      }`}
                    >
                      {e.doneAt !== undefined ? "🏆" : "📍"}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1 truncate font-display text-base font-bold text-wave-900">
                        {e.place.name}
                        <ChevronRight className="h-3.5 w-3.5 flex-none text-slate-400" />
                      </div>
                      <div className="flex items-center gap-1 text-[11px] text-slate-500">
                        <MapPin className="h-3 w-3" />
                        {e.place.lat.toFixed(3)}, {e.place.lng.toFixed(3)}
                      </div>
                      {e.doneAt !== undefined ? (
                        <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800 ring-1 ring-emerald-200">
                          <Check className="h-2.5 w-2.5" />
                          {t("toswim.done_on", {
                            date: formatDate(e.doneAt),
                          })}
                        </div>
                      ) : (
                        <div className="mt-0.5 text-[11px] text-slate-400">
                          {t("toswim.added_on", {
                            date: formatDate(e.entry.addedAt),
                          })}
                        </div>
                      )}
                    </div>
                  </Link>
                ) : (
                  <div className="flex flex-1 items-center gap-3 p-3 opacity-60">
                    <div className="flex h-12 w-12 flex-none items-center justify-center rounded-xl bg-slate-100 text-2xl ring-1 ring-slate-200">
                      ❓
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-display text-base font-bold text-slate-600">
                        {t("toswim.missing_place")}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        {t("toswim.added_on", {
                          date: formatDate(e.entry.addedAt),
                        })}
                      </div>
                    </div>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() =>
                    onRemove(e.placeId, e.place?.name ?? t("toswim.this_spot"))
                  }
                  className="flex w-12 flex-none items-center justify-center border-l border-white/60 text-rose-400 transition-colors hover:bg-rose-50 hover:text-rose-600"
                  aria-label={t("toswim.remove")}
                  title={t("toswim.remove")}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </m.li>
          ))}
        </ul>
      )}
    </div>
  );
}
