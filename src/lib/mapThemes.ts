// Map tile themes. Only the first entry (Voyager) is currently rendered;
// the rest are kept here for the theme picker that lives commented-out in
// SwimMap.tsx — easy to flip back on without re-researching tile URLs.

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
  {
    id: "satellite",
    label: "Satellit",
    swatch: "linear-gradient(135deg,#2d4a2d,#1a2d1a)",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution:
      'Tiles &copy; <a href="https://www.esri.com/">Esri</a> &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
    maxZoom: 20,
  },
];
