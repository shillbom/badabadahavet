/** Escape text for XML element content. */
function xmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function isoDate(ms) {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return null;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/** Read placesSummary/current entries from either packed or legacy shape. */
export function entriesFromPlacesSummaryDoc(summary) {
  const packed = summary?.packed;
  if (typeof packed === "string" && packed) {
    const parsed = JSON.parse(packed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
    throw new Error("placesSummary/current.packed is not an object");
  }
  const entries = summary?.entries;
  if (entries && typeof entries === "object" && !Array.isArray(entries)) {
    return entries;
  }
  return {};
}

/** Build sitemap XML for the landing page plus all place share pages. */
export function buildSitemapXml({
  origin,
  placeEntries,
  builtAt,
  generatedAt,
}) {
  const base = String(origin ?? "").replace(/\/+$/, "");
  if (!/^https?:\/\//.test(base)) {
    throw new Error("origin must be an absolute http(s) URL");
  }

  const nowDate = isoDate(generatedAt ?? Date.now()) ?? "1970-01-01";
  const placeDate = isoDate(builtAt) ?? nowDate;
  const ids = Object.keys(placeEntries ?? {}).toSorted();
  const rows = [
    "  <url>",
    `    <loc>${xmlEscape(`${base}/`)}</loc>`,
    `    <lastmod>${nowDate}</lastmod>`,
    "    <changefreq>weekly</changefreq>",
    "    <priority>1.0</priority>",
    "  </url>",
  ];

  for (const id of ids) {
    if (!id) continue;
    const entry = placeEntries[id];
    if (!entry || typeof entry.n !== "string" || entry.n.length === 0) continue;
    rows.push(
      "  <url>",
      `    <loc>${xmlEscape(`${base}/s/${encodeURIComponent(id)}`)}</loc>`,
      `    <lastmod>${placeDate}</lastmod>`,
      "    <changefreq>weekly</changefreq>",
      "    <priority>0.8</priority>",
      "  </url>",
    );
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...rows,
    "</urlset>",
    "",
  ].join("\n");
}
