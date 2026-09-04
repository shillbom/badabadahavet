// Upstream water-temperature feeds for the on-demand refresh
// (app/api/refreshPlaceTemp). Moved verbatim out of the old
// functions/index.js — network shape and validation bounds unchanged.
//
// Nothing here touches Firestore; the caller decides what to store, and it
// only ever stores to placeTemps/{placeId} (never onto the place doc — the
// always-on places listener would fan every reading out to every client).

/** A validated reading from one upstream: °C, sample time, provider id. */
export type UpstreamReading = {
  temp: number;
  stamp: number;
  source: "havochvatten" | "open-meteo" | "smhi";
};

const DETAIL_URL = (nutsCode: string) =>
  `https://badplatsen.havochvatten.se/badplatsen/api/detail/${encodeURIComponent(nutsCode)}`;

/** Plausible water temperature — anything outside this is a parse artefact. */
const plausible = (t: unknown): t is number =>
  typeof t === "number" && !Number.isNaN(t) && t >= -5 && t <= 40;

export async function fetchHavochvattenTemp(
  nutsCode: string,
): Promise<UpstreamReading | null> {
  const res = await fetch(DETAIL_URL(nutsCode), {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) return null;
  const data = await res.json();
  const raw =
    data?.sampleTemperature ??
    data?.value ??
    data?.temperature ??
    data?.celsius;
  const temp = typeof raw === "string" ? Number(raw) : raw;
  const stampRaw =
    data?.sampleDate ?? data?.date ?? data?.timestamp ?? data?.measuredAt;
  const stamp =
    typeof stampRaw === "number" ? stampRaw : Date.parse(stampRaw ?? "");
  if (!plausible(temp) || !stamp || Number.isNaN(stamp)) return null;
  return { temp, stamp, source: "havochvatten" };
}

// Open-Meteo's marine model is sea/ocean-only — its grid has no values
// over inland lakes, so a lake coordinate returns null sea_surface_temperature.
// That's expected: lake spots without an official reading just show no temp.
const OPEN_METEO_URL = (lat: number, lng: number) =>
  `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lng}&current=sea_surface_temperature`;

export async function fetchOpenMeteoTemp(
  lat: number,
  lng: number,
): Promise<UpstreamReading | null> {
  const res = await fetch(OPEN_METEO_URL(lat, lng), {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) return null;
  const data = await res.json();
  const temp = data?.current?.sea_surface_temperature;
  const timeStr = data?.current?.time;
  if (!plausible(temp)) return null;
  const stamp = timeStr ? Date.parse(timeStr) : null;
  if (!stamp || Number.isNaN(stamp)) return null;
  return { temp, stamp, source: "open-meteo" };
}

// SMHI's open oceanographic data has a "Havstemperatur" (sea water
// temperature) parameter, but we resolve its numeric id dynamically
// instead of hardcoding one — SMHI's ids aren't documented as stable, and
// getting it wrong silently returns *some other* quantity that can still
// look like a plausible temperature (this bit us once: a hardcoded wrong
// id quietly reported a winter reading in July). There's also no
// per-place station id, so the nearest active station to a place's
// coordinates is resolved on the fly too.
const SMHI_PARAMETER_LIST_URL =
  "https://opendata-download-ocobs.smhi.se/api/version/1.0.json";
const SMHI_STATIONS_URL = (parameterId: string) =>
  `https://opendata-download-ocobs.smhi.se/api/version/1.0/parameter/${parameterId}.json`;
const SMHI_DATA_URL = (parameterId: string, stationId: string | number) =>
  `https://opendata-download-ocobs.smhi.se/api/version/1.0/parameter/${parameterId}/station/${stationId}/period/latest-hour/data.json`;

// Don't match a place to a station further away than this — a spot with no
// nearby sensor should just get no SMHI reading rather than a bogus one.
const MAX_SMHI_STATION_DISTANCE_M = 40_000;

// Parameter ids and station lists barely change; cache them at module scope
// instead of re-fetching on every single refresh call. (Under `onCall` this
// was per-function-instance; on App Hosting it is per server instance —
// same lifetime, same intent.)
const SMHI_METADATA_CACHE_MS = 6 * 60 * 60 * 1000;
type Station = { id: string | number; lat: number; lng: number };
let smhiParameterIdCache: { at: number; id: string | null } | null = null;
let smhiStationsCache: { at: number; stations: Station[] } | null = null;

const toRad = (x: number) => (x * Math.PI) / 180;

function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

async function findSmhiTempParameterId(): Promise<string | null> {
  const now = Date.now();
  if (
    smhiParameterIdCache &&
    now - smhiParameterIdCache.at < SMHI_METADATA_CACHE_MS
  ) {
    return smhiParameterIdCache.id;
  }
  const res = await fetch(SMHI_PARAMETER_LIST_URL, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) return smhiParameterIdCache?.id ?? null;
  const data = await res.json();
  const match = (data?.resource ?? []).find((r: { title?: unknown }) =>
    String(r.title ?? "")
      .toLowerCase()
      .includes("havstemperatur"),
  );
  const id = match?.key ?? null;
  smhiParameterIdCache = { at: now, id };
  return id;
}

async function fetchSmhiStations(parameterId: string): Promise<Station[]> {
  const now = Date.now();
  if (
    smhiStationsCache &&
    now - smhiStationsCache.at < SMHI_METADATA_CACHE_MS
  ) {
    return smhiStationsCache.stations;
  }
  const res = await fetch(SMHI_STATIONS_URL(parameterId), {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) return smhiStationsCache?.stations ?? [];
  const data = await res.json();
  // Single pass: skip inactive stations and ones missing an id/coords,
  // mapping the rest — avoids three separate traversals of the station list.
  const stations: Station[] = [];
  for (const s of data?.station ?? []) {
    if (s.active === false) continue;
    if (
      s.id == null ||
      typeof s.latitude !== "number" ||
      typeof s.longitude !== "number"
    ) {
      continue;
    }
    stations.push({ id: s.id, lat: s.latitude, lng: s.longitude });
  }
  smhiStationsCache = { at: now, stations };
  return stations;
}

async function findNearestSmhiStation(
  parameterId: string,
  lat: number,
  lng: number,
): Promise<string | number | null> {
  const stations = await fetchSmhiStations(parameterId);
  let best: Station | null = null;
  let bestDist = Infinity;
  for (const s of stations) {
    const dist = haversineMeters({ lat, lng }, s);
    if (dist < bestDist) {
      best = s;
      bestDist = dist;
    }
  }
  return best && bestDist <= MAX_SMHI_STATION_DISTANCE_M ? best.id : null;
}

export async function fetchSmhiTemp(
  lat: number,
  lng: number,
): Promise<UpstreamReading | null> {
  const parameterId = await findSmhiTempParameterId();
  if (parameterId == null) return null;
  const stationId = await findNearestSmhiStation(parameterId, lat, lng);
  if (stationId == null) return null;
  const res = await fetch(SMHI_DATA_URL(parameterId, stationId), {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) return null;
  const data = await res.json();
  const values = Array.isArray(data?.value) ? data.value : [];
  if (!values.length) return null;
  // Don't assume ordering — take the most recent sample's own timestamp,
  // never "now" (the fetch time).
  const latest = values.reduce((a: { date: number }, b: { date: number }) =>
    b.date > a.date ? b : a,
  );
  const raw = latest.value;
  const temp = typeof raw === "string" ? Number(raw) : raw;
  const stamp = latest.date;
  if (!plausible(temp) || typeof stamp !== "number" || Number.isNaN(stamp)) {
    return null;
  }
  return { temp, stamp, source: "smhi" };
}
