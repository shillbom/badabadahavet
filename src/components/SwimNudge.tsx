import { useMemo } from "react";
import { Link } from "react-router";
import { MapPin, Thermometer } from "lucide-react";
import { useAllSessionsFeed, useStore } from "@/store/sessions";
import { useAuth } from "@/auth/AuthContext";
import { useT } from "@/lib/i18n";
import { haversineMeters } from "@/lib/utils";
import BottomSheet from "@/components/BottomSheet";
import { buttonClasses } from "@/components/ui/Button";

/**
 * "Where should I swim?" — recommends the closest place the user has never
 * swum at, with distance and a nudge to go. Opened manually from the map's
 * 🎲 action, and automatically (once per day, from MapPage) when today is
 * the streak's last chance.
 */
export default function SwimNudge({
  open,
  onClose,
  atRisk,
  streakDays,
}: {
  open: boolean;
  onClose: () => void;
  /** True when the streak dies unless the user swims today. */
  atRisk: boolean;
  streakDays: number;
}) {
  const t = useT();
  const { profile } = useAuth();
  const places = useStore((s) => s.places);
  const myPlaceIds = useStore((s) => s.myPlaceIds);
  const allSessions = useStore((s) => s.allSessions);
  const groups = useStore((s) => s.groups);
  const myUid = useStore((s) => s.myUid);
  const currentLocation = useStore((s) => s.currentLocation);
  // The "a friend swam here" social proof reads the community feed — only
  // worth subscribing while the sheet is actually open.
  useAllSessionsFeed(open && !!myUid);

  const suggestion = useMemo(() => {
    if (!open) return null;
    const origin = currentLocation ?? profile?.lastLocation ?? null;
    const candidates = places.filter((p) => !myPlaceIds.has(p.id));
    if (candidates.length === 0) return null;

    let place = candidates[0];
    let distM = 2 * 10 * 1000; // 20 km, arbitrary "far away" default
    if (origin) {
      for (const p of candidates) {
        const d = haversineMeters(origin, p);
        if (d < distM) {
          distM = d;
          place = p;
        }
      }
    }

    // Someone from one of my groups who swam here — social proof.
    const friendUids = new Set(
      groups.flatMap((g) => g.members).filter((uid) => uid !== myUid),
    );
    const friendSwim =
      allSessions
        .filter((s) => s.placeId === place.id && friendUids.has(s.uid))
        .sort((a, b) => b.date - a.date)[0] ?? null;

    return { place, distM, friendName: friendSwim?.displayName ?? null };
  }, [
    open,
    places,
    myPlaceIds,
    allSessions,
    groups,
    myUid,
    currentLocation,
    profile,
  ]);

  const title = (
    <h3 className="font-display text-xl font-black text-wave-900">
      {atRisk ? t("nudge.title.at_risk") : t("nudge.title")}
    </h3>
  );

  return (
    <BottomSheet open={open} onClose={onClose} size="small" title={title}>
      {suggestion ? (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            {atRisk
              ? t("nudge.body.at_risk", { n: streakDays })
              : t("nudge.body")}
          </p>

          <div className="glass flex items-center gap-3 p-3">
            <div className="flex h-12 w-12 flex-none items-center justify-center rounded-xl bg-wave-100 text-2xl">
              🏖️
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate font-display text-lg font-bold text-wave-900">
                {suggestion.place.name}
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
                {suggestion.distM !== null ? (
                  <span className="flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    {t("nudge.distance", {
                      dist: formatDist(suggestion.distM),
                    })}
                  </span>
                ) : null}
                {suggestion.place.waterTemp != null ? (
                  <span className="flex items-center gap-1">
                    <Thermometer className="h-3 w-3" />
                    {Math.round(suggestion.place.waterTemp)}°
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          {suggestion.friendName ? (
            <p className="text-xs font-semibold text-wave-700">
              {t("nudge.friend", { name: suggestion.friendName })}
            </p>
          ) : null}

          <Link
            to={`/spot/${suggestion.place.id}`}
            onClick={onClose}
            className={buttonClasses("primary", "md", "w-full")}
          >
            {t("nudge.cta")}
          </Link>
        </div>
      ) : (
        <p className="py-4 text-center text-sm text-slate-600">
          {t("nudge.empty")}
        </p>
      )}
    </BottomSheet>
  );
}

function formatDist(m: number): string {
  if (m < 950) return `${Math.max(50, Math.round(m / 50) * 50)} m`;
  const km = m / 1000;
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}
