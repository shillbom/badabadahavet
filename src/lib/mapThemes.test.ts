import { afterEach, expect, it, vi } from "vitest";

// The key is read once at module init, so each case re-imports the module with
// a stubbed env instead of mutating a captured constant.
async function loadThemes(key?: string) {
  vi.resetModules();
  if (key === undefined) vi.stubEnv("VITE_CARTO_API_KEY", "");
  else vi.stubEnv("VITE_CARTO_API_KEY", key);
  return import("./mapThemes");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it("leaves tile URLs untouched when no key is configured", async () => {
  const { withCartoKey, MAP_THEMES } = await loadThemes();
  expect(withCartoKey("https://x.cartocdn.com/{z}/{x}/{y}.png")).toBe(
    "https://x.cartocdn.com/{z}/{x}/{y}.png",
  );
  expect(MAP_THEMES[0].url).not.toContain("key=");
});

it("appends the key to every CARTO theme", async () => {
  const { MAP_THEMES } = await loadThemes("abc123");
  const carto = MAP_THEMES.filter((t) => t.url.includes("cartocdn.com"));
  expect(carto.length).toBe(3);
  for (const theme of carto) expect(theme.url).toContain("?key=abc123");
});

it("does not touch non-CARTO themes", async () => {
  const { MAP_THEMES } = await loadThemes("abc123");
  const osm = MAP_THEMES.find((t) => t.id === "classic")!;
  expect(osm.url).not.toContain("key=");
});

it("keeps placeholders intact and escapes the key", async () => {
  const { withCartoKey } = await loadThemes("a b&c");
  expect(withCartoKey("https://x/{z}/{x}/{y}{r}.png")).toBe(
    "https://x/{z}/{x}/{y}{r}.png?key=a%20b%26c",
  );
  expect(withCartoKey("https://x/{z}.png?foo=1")).toBe(
    "https://x/{z}.png?foo=1&key=a%20b%26c",
  );
});
