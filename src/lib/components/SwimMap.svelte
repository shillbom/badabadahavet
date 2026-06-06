<script lang="ts" module>
  // Persisted view state survives unmounts (e.g. tab navigation) — same
  // module-level approach the React version used.
  type SavedView = { center: [number, number]; zoom: number };
  const savedViews = new Map<string, SavedView>();
  const fittedKeys = new Set<string>();

  export type MapAction = {
    label: string;
    onClick: () => void;
    ariaLabel?: string;
  };
</script>

<script lang="ts">
  import { onMount, tick } from "svelte";
  import { goto } from "$app/navigation";
  import type { Map as LeafletMap, DivIcon, Marker, TileLayer } from "leaflet";
  import "leaflet/dist/leaflet.css";
  import "leaflet.markercluster/dist/MarkerCluster.css";
  import "leaflet.markercluster/dist/MarkerCluster.Default.css";
  import { Layers, LocateFixed } from "@lucide/svelte";
  import { MAP_THEMES } from "@/lib/mapThemes";
  import { maybeRefreshPlaceTemp } from "@/lib/refreshTemp";
  import type { PlaceDoc, SessionDoc } from "@/lib/types";
  import { formatDate, cn } from "@/lib/utils";
  import { t } from "@/lib/i18n";

  let {
    places,
    sessionsByPlace,
    userLocation = null,
    center,
    zoom = 5,
    linkToSpot = true,
    fitToken,
    fitBoundsToPlaces = false,
    viewKey = "default",
    topRightActions = [],
    class: className = "",
  }: {
    places: PlaceDoc[];
    sessionsByPlace: Map<string, SessionDoc[]>;
    userLocation?: { lat: number; lng: number } | null;
    center?: [number, number];
    zoom?: number;
    linkToSpot?: boolean;
    fitToken?: number;
    fitBoundsToPlaces?: boolean;
    viewKey?: string;
    topRightActions?: MapAction[];
    class?: string;
  } = $props();

  const PIN_SIZE = 28;
  const PIN_TAIL = 12;
  const PIN_TOTAL = PIN_SIZE + PIN_TAIL;
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

  let mapEl: HTMLDivElement;
  let satellite = $state(false);
  let ready = $state(false);

  // Leaflet objects (created in onMount — leaflet touches `window`).
  let L: typeof import("leaflet");
  let map: LeafletMap | null = null;
  let cluster: import("leaflet").MarkerClusterGroup | null = null;
  let baseLayer: TileLayer | null = null;
  let labelsLayer: TileLayer | null = null;
  let userMarker: Marker | null = null;
  let dropletIcon: DivIcon;
  let userLocationIcon: DivIcon;
  const tempIconCache = new Map<number, DivIcon>();

  function pinHtml(opts: {
    size: number;
    bg: string;
    tail: string;
    shadow: string;
    border: number;
    content?: string;
    tailHeight?: number;
  }): string {
    const tailH = opts.tailHeight ?? 12;
    const total = opts.size + tailH;
    return `<div style="position:relative;width:${opts.size}px;height:${total}px;">
      <div style="position:absolute;left:0;top:0;width:${opts.size}px;height:${opts.size}px;border-radius:50%;background:${opts.bg};border:${opts.border}px solid white;box-shadow:0 4px 12px ${opts.shadow};display:flex;align-items:center;justify-content:center;color:white;font-weight:900;font-size:${Math.round(opts.size * 0.55)}px;line-height:1;">${opts.content ?? ""}</div>
      <div style="position:absolute;left:50%;bottom:0;transform:translateX(-50%);width:0;height:0;border-left:${Math.round(tailH * 0.45)}px solid transparent;border-right:${Math.round(tailH * 0.45)}px solid transparent;border-top:${tailH}px solid ${opts.tail};filter:drop-shadow(0 2px 3px ${opts.shadow});"></div>
    </div>`;
  }

  function tempIcon(temp: number): DivIcon {
    const rounded = Math.round(temp);
    const cached = tempIconCache.get(rounded);
    if (cached) return cached;
    const icon = L.divIcon({
      className: "swim-pin-temp",
      iconSize: [PIN_SIZE, PIN_TOTAL],
      iconAnchor: [PIN_SIZE / 2, PIN_TOTAL],
      popupAnchor: [0, -PIN_SIZE],
      html: pinHtml({
        size: PIN_SIZE,
        bg: "linear-gradient(135deg,#0284c7,#075985)",
        tail: "#075985",
        shadow: "rgba(2,100,160,0.45)",
        border: 2,
        content: `<span style="font-size:11px;line-height:1;">${rounded}°</span>`,
      }),
    });
    tempIconCache.set(rounded, icon);
    return icon;
  }

  function hasFreshTemp(
    p: PlaceDoc,
  ): p is PlaceDoc & { waterTemp: number; waterTempAt: number } {
    if (typeof p.waterTemp !== "number") return false;
    if (!p.waterTempAt) return false;
    return Date.now() - p.waterTempAt <= WEEK_MS;
  }

  function formatAge(ts: number): string {
    const diff = Date.now() - ts;
    const mins = Math.round(diff / 60_000);
    if (mins < 60) return t("map.popup.age.mins", { n: Math.max(0, mins) });
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return t("map.popup.age.hrs", { n: hrs });
    const days = Math.round(hrs / 24);
    return t("map.popup.age.days", { n: days });
  }

  /** Build popup DOM. The "see full history" link is wired to client-side
   *  navigation so it doesn't trigger a full page reload. */
  function buildPopup(p: PlaceDoc, sessions: SessionDoc[]): HTMLElement {
    const el = document.createElement("div");
    el.className = "text-sm";
    const photos = sessions.filter((s) => s.photoUrl).slice(0, 6);
    const count =
      sessions.length === 1
        ? t("map.popup.swims_one")
        : sessions.length > 0
          ? t("map.popup.swims_many", { n: sessions.length })
          : t("map.popup.no_swims_yet");

    let html = `<div class="font-semibold text-wave-900">${p.name}</div>
      <div class="text-[11px] text-slate-500">${count}</div>`;
    if (hasFreshTemp(p)) {
      html += `<div class="mt-1 inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-800 ring-1 ring-sky-200">💧 ${p.waterTemp.toFixed(1)} °C <span class="font-normal text-sky-600">· ${formatAge(p.waterTempAt)}</span></div>`;
    }
    if (photos.length) {
      html += `<div class="mt-1.5 flex gap-1 overflow-x-auto">${photos
        .map(
          (s) =>
            `<img src="${s.photoUrl}" alt="" loading="lazy" class="h-12 w-12 flex-none rounded-md object-cover ring-1 ring-slate-200" />`,
        )
        .join("")}</div>`;
    }
    html += `<ul class="mt-1 max-h-32 space-y-1 overflow-y-auto">${sessions
      .slice(0, 5)
      .map(
        (s) =>
          `<li class="text-[11px]">${formatDate(s.date)} — ${s.displayName}${s.isWinter ? " ❄️" : ""}</li>`,
      )
      .join("")}</ul>`;
    el.innerHTML = html;

    if (linkToSpot) {
      const wrap = document.createElement("div");
      wrap.className = "mt-1.5";
      const a = document.createElement("a");
      a.href = `/spot/${p.id}`;
      a.className = "text-[11px] font-semibold text-wave-700 hover:underline";
      a.textContent = t("map.popup.see_full_history");
      a.addEventListener("click", (e) => {
        e.preventDefault();
        goto(`/spot/${p.id}`);
      });
      wrap.appendChild(a);
      el.appendChild(wrap);
    }
    return el;
  }

  function fallbackCenter(): [number, number] {
    if (userLocation) return [userLocation.lat, userLocation.lng];
    if (places.length) return [places[0].lat, places[0].lng];
    return [59.32, 18.06]; // Stockholm — a wholesome default
  }

  function renderMarkers() {
    if (!map || !cluster) return;
    cluster.clearLayers();
    for (const p of places) {
      const sessions = sessionsByPlace.get(p.id) ?? [];
      const marker = L.marker([p.lat, p.lng], {
        icon: hasFreshTemp(p) ? tempIcon(p.waterTemp) : dropletIcon,
      });
      if (hasFreshTemp(p)) {
        marker.bindTooltip(
          `<div class="text-[11px]"><span class="font-semibold text-wave-900">💧 ${p.waterTemp.toFixed(1)} °C</span> <span class="text-slate-500">· ${formatAge(p.waterTempAt)}</span></div>`,
          { direction: "top", offset: [0, -PIN_TOTAL + 4] },
        );
      }
      marker.bindPopup(() => buildPopup(p, sessions));
      marker.on("mouseover", () => maybeRefreshPlaceTemp(p));
      marker.on("click", () => maybeRefreshPlaceTemp(p));
      cluster.addLayer(marker);
    }
  }

  function applyTheme() {
    if (!map) return;
    const base = MAP_THEMES[0];
    const sat = MAP_THEMES.find((th) => th.id === "satellite")!;
    const theme = satellite ? sat : base;
    if (baseLayer) baseLayer.remove();
    baseLayer = L.tileLayer(theme.url, {
      attribution: theme.attribution,
      subdomains: theme.subdomains ?? "abc",
      maxZoom: theme.maxZoom ?? 19,
    }).addTo(map);
    if (labelsLayer) {
      labelsLayer.remove();
      labelsLayer = null;
    }
    if (satellite) {
      labelsLayer = L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
        { maxZoom: 20, opacity: 1 },
      ).addTo(map);
    }
  }

  function fit() {
    if (!map) return;
    if (fitBoundsToPlaces && places.length) {
      const pts: [number, number][] = places.map((p) => [p.lat, p.lng]);
      if (userLocation) pts.push([userLocation.lat, userLocation.lng]);
      map.fitBounds(L.latLngBounds(pts).pad(0.25), {
        animate: true,
        maxZoom: 13,
      });
    } else if (userLocation) {
      map.setView([userLocation.lat, userLocation.lng], 11, { animate: true });
    }
    fittedKeys.add(viewKey);
  }

  function updateUserMarker() {
    if (!map) return;
    if (userMarker) {
      userMarker.remove();
      userMarker = null;
    }
    if (userLocation) {
      userMarker = L.marker([userLocation.lat, userLocation.lng], {
        icon: userLocationIcon,
      }).addTo(map);
    }
  }

  function locateMe() {
    if (map && userLocation)
      map.setView([userLocation.lat, userLocation.lng], 13, { animate: true });
  }

  onMount(() => {
    let disposed = false;
    let cleanupFns: Array<() => void> = [];

    (async () => {
      const leaflet = await import("leaflet");
      await import("leaflet.markercluster");
      if (disposed) return;
      L = leaflet.default ?? leaflet;

      // Leaflet's default marker icons are broken under bundlers.
      delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })
        ._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl:
          "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        shadowUrl:
          "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      });

      dropletIcon = L.divIcon({
        className: "swim-pin",
        iconSize: [PIN_SIZE, PIN_TOTAL],
        iconAnchor: [PIN_SIZE / 2, PIN_TOTAL],
        popupAnchor: [0, -PIN_SIZE],
        html: pinHtml({
          size: PIN_SIZE,
          bg: "linear-gradient(135deg,#019eea,#065684)",
          tail: "#065684",
          shadow: "rgba(2,100,160,0.45)",
          border: 2,
        }),
      });
      userLocationIcon = L.divIcon({
        className: "swim-me",
        iconSize: [18, 18],
        iconAnchor: [9, 9],
        html: `<div style="position:relative;width:18px;height:18px;"><div style="position:absolute;inset:0;border-radius:50%;background:#2563eb;border:3px solid white;box-shadow:0 0 0 2px rgba(37,99,235,0.35),0 4px 10px rgba(37,99,235,0.4);"></div></div>`,
      });

      const saved = savedViews.get(viewKey);
      map = L.map(mapEl, { scrollWheelZoom: true }).setView(
        saved?.center ?? center ?? fallbackCenter(),
        saved?.zoom ?? zoom,
      );

      applyTheme();
      cluster = L.markerClusterGroup({
        chunkedLoading: true,
        maxClusterRadius: 50,
        showCoverageOnHover: false,
        spiderfyOnMaxZoom: true,
      });
      map.addLayer(cluster);

      renderMarkers();
      updateUserMarker();
      if (!saved) fit();

      const save = () => {
        const c = map!.getCenter();
        savedViews.set(viewKey, {
          center: [c.lat, c.lng],
          zoom: map!.getZoom(),
        });
      };
      const startSaving = () => map!.on("moveend zoomend", save);
      if (saved) startSaving();
      else {
        const id = window.setTimeout(startSaving, 800);
        cleanupFns.push(() => window.clearTimeout(id));
      }
      cleanupFns.push(() => map?.off("moveend zoomend", save));

      ready = true;
    })();

    return () => {
      disposed = true;
      cleanupFns.forEach((fn) => fn());
      map?.remove();
      map = null;
    };
  });

  // Re-render markers when data changes.
  $effect(() => {
    void places;
    void sessionsByPlace;
    if (ready) renderMarkers();
  });

  // Track the user position marker.
  $effect(() => {
    void userLocation;
    if (ready) updateUserMarker();
  });

  // Swap tiles on satellite toggle.
  $effect(() => {
    void satellite;
    if (ready) applyTheme();
  });

  // Re-fit when the caller bumps fitToken.
  let lastFitToken = $state<number | undefined>(undefined);
  $effect(() => {
    if (ready && fitToken !== lastFitToken) {
      lastFitToken = fitToken;
      // Skip the very first run (initial fit already happened in onMount).
      tick().then(() => fit());
    }
  });

  const actions = $derived<MapAction[]>([
    ...topRightActions,
    {
      label: satellite ? t("map.toggle_terrain") : t("map.toggle_satellite"),
      onClick: () => (satellite = !satellite),
    },
  ]);
</script>

<div class={cn("relative h-full w-full", className)}>
  <div bind:this={mapEl} class="h-full w-full rounded-2xl"></div>

  <!-- Stacked action buttons — caller-supplied on top, satellite toggle last. -->
  <div class="absolute top-3 right-3 z-[600] flex flex-col items-end gap-2">
    {#each actions as action (action.label)}
      <button
        type="button"
        onclick={action.onClick}
        aria-label={action.ariaLabel ?? action.label}
        class="flex items-center gap-1.5 rounded-full bg-white/95 px-3 py-1.5 text-xs font-semibold text-wave-800 shadow-md ring-1 ring-slate-200 transition hover:bg-white active:scale-95"
      >
        {#if action.label === t("map.toggle_satellite") || action.label === t("map.toggle_terrain")}
          <Layers class="h-3.5 w-3.5" />
        {/if}
        {action.label}
      </button>
    {/each}
  </div>

  {#if userLocation}
    <button
      type="button"
      onclick={locateMe}
      class="absolute right-3 bottom-5 z-[600] flex h-10 w-10 items-center justify-center rounded-full bg-white/95 text-wave-700 shadow-md ring-1 ring-slate-200 transition hover:bg-white active:scale-95"
      aria-label={t("map.center_on_me")}
      title={t("map.center_on_me")}
    >
      <LocateFixed class="h-5 w-5" />
    </button>
  {/if}
</div>
