/**
 * Renders a Wrapped-style year-recap image on a canvas and hands it to the
 * native share sheet (with a plain download as the desktop fallback).
 *
 * Deliberately no remote images: session photos live in Cloud Storage and
 * would taint the canvas without a CORS round-trip. Emoji + gradients look
 * great and always work offline.
 */

export type RecapCardData = {
  year: number;
  appName: string;
  /** Card headline, e.g. "Mitt badår". */
  title: string;
  /** The hero stat: swim count + label. */
  big: { value: string; label: string };
  rows: { emoji: string; value: string; label: string }[];
  footer: string;
};

const W = 1080;
const H = 1920;

export async function shareRecapCard(
  data: RecapCardData,
): Promise<"shared" | "downloaded" | "failed"> {
  const blob = await renderRecapCard(data);
  if (!blob) return "failed";

  const file = new File([blob], `badligan-${data.year}.png`, {
    type: "image/png",
  });
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  if (nav?.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: data.title });
      return "shared";
    } catch (err) {
      // Dismissing the share sheet is a no-op, not a failure.
      if ((err as { name?: string })?.name === "AbortError") return "shared";
      // Otherwise fall through to download.
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  a.click();
  URL.revokeObjectURL(url);
  return "downloaded";
}

/** Draw the card and return it as a PNG blob (exported for previewing). */
export async function renderRecapCard(
  data: RecapCardData,
): Promise<Blob | null> {
  // Make sure the display font is usable on the canvas before drawing.
  try {
    await document.fonts.load('900 200px "Caveat Brush"');
    await document.fonts.load('700 44px "Bricolage Grotesque"');
  } catch {
    // Fonts unavailable → system fallbacks still render fine.
  }

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const display = (size: number) =>
    `900 ${size}px "Caveat Brush", "Bricolage Grotesque", sans-serif`;
  const sans = (size: number, weight = 600) =>
    `${weight} ${size}px "Bricolage Grotesque", system-ui, sans-serif`;

  // ── Background: the app's wave-blue sky ──────────────────────────────
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#def1ff");
  bg.addColorStop(0.45, "#eff9ff");
  bg.addColorStop(1, "#b6e4ff");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Soft radial highlight top-left, like the app shell.
  const glow = ctx.createRadialGradient(220, 0, 0, 220, 0, 900);
  glow.addColorStop(0, "rgba(255,255,255,0.9)");
  glow.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Rolling waves along the bottom.
  wave(ctx, H - 260, 70, "rgba(1,158,234,0.25)");
  wave(ctx, H - 180, 55, "rgba(2,100,160,0.35)");
  wave(ctx, H - 100, 45, "rgba(11,72,109,0.5)");

  // ── Header ────────────────────────────────────────────────────────────
  ctx.textAlign = "center";
  ctx.fillStyle = "#0b486d";
  ctx.font = display(88);
  ctx.fillText(`🌊 ${data.appName}`, W / 2, 170);

  ctx.font = sans(40, 600);
  ctx.fillStyle = "#0264a0";
  ctx.fillText(data.title, W / 2, 240);

  ctx.font = display(300);
  ctx.fillStyle = "#0b486d";
  ctx.fillText(String(data.year), W / 2, 510);

  // ── Hero stat ─────────────────────────────────────────────────────────
  ctx.font = display(220);
  ctx.fillStyle = "#019eea";
  ctx.fillText(data.big.value, W / 2, 780);
  ctx.font = sans(44, 700);
  ctx.fillStyle = "#0264a0";
  ctx.fillText(data.big.label, W / 2, 850);

  // ── Stat rows: glass-ish cards ────────────────────────────────────────
  const rowW = W - 160;
  const rowH = 130;
  const gap = 26;
  let y = 950;
  for (const row of data.rows) {
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.beginPath();
    ctx.roundRect(80, y, rowW, rowH, 32);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.textAlign = "left";
    ctx.font = sans(56, 600);
    ctx.fillStyle = "#0b486d";
    ctx.fillText(row.emoji, 120, y + rowH / 2 + 20);

    ctx.font = display(72);
    ctx.fillText(row.value, 230, y + rowH / 2 + 26);

    ctx.textAlign = "right";
    ctx.font = sans(36, 600);
    ctx.fillStyle = "#526e85";
    ctx.fillText(row.label, 80 + rowW - 44, y + rowH / 2 + 14);

    ctx.textAlign = "center";
    y += rowH + gap;
  }

  // ── Footer ────────────────────────────────────────────────────────────
  ctx.font = sans(36, 600);
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.fillText(data.footer, W / 2, H - 70);

  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

/** One horizontal sine wave band filled to the bottom of the canvas. */
function wave(
  ctx: CanvasRenderingContext2D,
  baseY: number,
  amplitude: number,
  color: string,
) {
  ctx.beginPath();
  ctx.moveTo(0, baseY);
  for (let x = 0; x <= W; x += 8) {
    ctx.lineTo(x, baseY + Math.sin((x / W) * Math.PI * 3) * amplitude);
  }
  ctx.lineTo(W, H);
  ctx.lineTo(0, H);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}
