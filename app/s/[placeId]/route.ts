import { permanentRedirect } from "next/navigation";
import type { NextRequest } from "next/server";

/**
 * `/s/:placeId` is the share entrypoint that goes out in copied links (see
 * `shareOrCopy` call sites in SpotPage), and it's what the retired
 * `spotPreview` Cloud Function used to intercept. Keep it working forever as
 * a permanent redirect to the canonical `/spot/:placeId`, query string
 * included — `?session=<id>` deep-links a specific swim.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ placeId: string }> },
) {
  const { placeId } = await ctx.params;
  const search = req.nextUrl.search;
  permanentRedirect(`/spot/${encodeURIComponent(placeId)}${search}`);
}
