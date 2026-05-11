import { create } from "zustand";

export type MapTheme = {
  id: string;
  label: string;
  /** Small swatch shown in the picker (gradient or solid color). */
  swatch: string;
  url: string;
  attribution: string;
  subdomains?: string;
  maxZoom?: number;
};

export const MAP_THEMES: MapTheme[] = [
  {
    id: "voyager",
    label: "Mjuk",
    swatch: "linear-gradient(135deg,#e6f0f5,#c5dde7)",
    url: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: "abcd",
    maxZoom: 20,
  },
  {
    id: "positron",
    label: "Ljus",
    swatch: "linear-gradient(135deg,#f4f4f3,#dadbd8)",
    url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: "abcd",
    maxZoom: 20,
  },
  {
    id: "dark",
    label: "Mörk",
    swatch: "linear-gradient(135deg,#1f2730,#0d1117)",
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: "abcd",
    maxZoom: 20,
  },
  {
    id: "ocean",
    label: "Hav",
    swatch: "linear-gradient(135deg,#bcdfe7,#5da3b7)",
    url: "https://services.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}",
    attribution:
      'Tiles &copy; <a href="https://www.esri.com/">Esri</a> &mdash; Sources: GEBCO, NOAA, CHS, OSU, UNH, CSUMB, National Geographic, DeLorme, NAVTEQ, and Esri',
    maxZoom: 13,
  },
  {
    id: "classic",
    label: "Klassisk",
    swatch: "linear-gradient(135deg,#dceeb3,#a4c285)",
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    subdomains: "abc",
    maxZoom: 19,
  },
];

const STORAGE_KEY = "badligan.mapTheme";

function loadInitial(): string {
  if (typeof window === "undefined") return "voyager";
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved && MAP_THEMES.some((t) => t.id === saved)) return saved;
  return "voyager";
}

type State = {
  themeId: string;
  setTheme: (id: string) => void;
};

export const useMapTheme = create<State>((set) => ({
  themeId: loadInitial(),
  setTheme: (id) => {
    if (typeof window !== "undefined") localStorage.setItem(STORAGE_KEY, id);
    set({ themeId: id });
  },
}));

export function currentTheme(): MapTheme {
  const id = useMapTheme.getState().themeId;
  return MAP_THEMES.find((t) => t.id === id) ?? MAP_THEMES[0];
}
