import { Popup } from "react-leaflet";
import { Link } from "react-router";
import Photo from "@/components/Photo";
import { buttonClasses } from "@/components/ui/buttonStyles";
import { useT } from "@/lib/i18n";
import type { PlaceWithTemp, SessionDoc } from "@/lib/types";
import { cn, formatDate } from "@/lib/utils";
import { hasFreshTemp } from "../pinUtils";

const POPUP_AUTO_PAN_TOP_LEFT: [number, number] = [24, 56];
const POPUP_AUTO_PAN_BOTTOM_RIGHT: [number, number] = [24, 56];
const POPUP_MAX_PHOTOS = 4;

export default function PlacePopup({
  place,
  sessions,
  linkToSpot,
}: {
  place: PlaceWithTemp;
  sessions: SessionDoc[];
  linkToSpot: boolean;
}) {
  const t = useT();
  const sorted = [...sessions].toSorted((a, b) => b.date - a.date);
  const photoSessions = sorted.filter((s) => s.photoUrl);
  const shown =
    photoSessions.length > POPUP_MAX_PHOTOS
      ? photoSessions.slice(0, POPUP_MAX_PHOTOS - 1)
      : photoSessions;
  const overflow = photoSessions.length - shown.length;
  const lastSession = sorted[0] ?? null;
  const moreTileClasses =
    "flex h-12 w-12 flex-none items-center justify-center rounded-md bg-wave-50 text-xs font-bold text-wave-700 ring-1 ring-slate-200";

  return (
    <Popup
      autoPanPaddingTopLeft={POPUP_AUTO_PAN_TOP_LEFT}
      autoPanPaddingBottomRight={POPUP_AUTO_PAN_BOTTOM_RIGHT}
    >
      <div className="text-sm">
        <div className="font-semibold text-wave-900">{place.name}</div>
        <div className="text-[11px] text-slate-500">
          {sorted.length === 1
            ? t("map.popup.swims_one")
            : sorted.length > 0
              ? t("map.popup.swims_many", { n: sorted.length })
              : t("map.popup.no_swims_yet")}
        </div>
        {hasFreshTemp(place) ? (
          <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-800 ring-1 ring-sky-200">
            💧 {place.waterTemp.toFixed(1)} °C
            {place.waterTempAt ? (
              <span className="font-normal text-sky-600">
                · {formatAge(place.waterTempAt, t)}
              </span>
            ) : null}
          </div>
        ) : null}
        {shown.length ? (
          <div className="mt-1.5 flex gap-1 overflow-x-auto">
            {shown.map((s) => (
              <Photo
                key={s.id}
                src={s.photoUrl!}
                thumb={s.photoThumb}
                className="h-12 w-12 flex-none rounded-md ring-1 ring-slate-200"
              />
            ))}
            {overflow > 0 ? (
              linkToSpot ? (
                <Link
                  to={`/spot/${place.id}`}
                  aria-label={t("map.popup.view_spot")}
                  className={cn(moreTileClasses, "no-underline")}
                >
                  {t("map.popup.more_photos", { n: overflow })}
                </Link>
              ) : (
                <div className={moreTileClasses}>
                  {t("map.popup.more_photos", { n: overflow })}
                </div>
              )
            ) : null}
          </div>
        ) : null}
        {lastSession ? (
          <div className="mt-1 text-[11px]">
            {formatDate(lastSession.date)} — {lastSession.displayName}
            {lastSession.isWinter ? " ❄️" : ""}
          </div>
        ) : null}
        {linkToSpot ? (
          <Link
            to={`/spot/${place.id}`}
            className={buttonClasses(
              "primary",
              "xs",
              "mt-2 w-full !text-white no-underline hover:!text-white",
            )}
          >
            {t("map.popup.view_spot")}
          </Link>
        ) : null}
      </div>
    </Popup>
  );
}

function formatAge(
  ts: number,
  t: (k: string, vars?: Record<string, string | number>) => string,
): string {
  const diff = Date.now() - ts;
  const mins = Math.round(diff / 60_000);
  if (mins < 60) return t("map.popup.age.mins", { n: Math.max(0, mins) });
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return t("map.popup.age.hrs", { n: hrs });
  const days = Math.round(hrs / 24);
  return t("map.popup.age.days", { n: days });
}
