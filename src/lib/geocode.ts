/**
 * Reverse-geocode a coordinate to an ISO 3166-1 alpha-2 country code.
 *
 * Uses BigDataCloud's free client-side endpoint — no key, no rate limits
 * for typical use, returns ISO codes directly. Resolves to null on any
 * failure so callers can fall through gracefully.
 */
export async function reverseGeocodeCountry(
  lat: number,
  lng: number,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`;
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    const data = (await res.json()) as { countryCode?: string };
    const code = data.countryCode?.toUpperCase();
    return code && /^[A-Z]{2}$/.test(code) ? code : null;
  } catch {
    return null;
  }
}
