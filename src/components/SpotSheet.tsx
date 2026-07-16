import { lazy, Suspense, useState } from "react";
import BottomSheet from "@/components/BottomSheet";

const SpotView = lazy(() =>
  import("@/pages/SpotPage").then((m) => ({ default: m.SpotView })),
);

/**
 * Opens a spot's detail UI ({@link SpotView}) inside a {@link BottomSheet}
 * instead of navigating to `/spot/:id`. Pass the place id to open; `null`
 * closes the sheet.
 *
 * The last id is retained in a ref so the spot content stays rendered while the
 * sheet animates closed (see BottomSheet's note on exit animations).
 */
export default function SpotSheet({
  placeId,
  onClose,
}: {
  placeId: string | null;
  onClose: () => void;
}) {
  // Retain the last non-null id so the spot content stays rendered while the
  // sheet animates closed. Kept in state (not a ref) because it feeds render;
  // updated during render via React's "storing info from previous renders"
  // pattern, so the compiler can track it and no ref is read while rendering.
  const [shown, setShown] = useState<string | null>(placeId);
  if (placeId && placeId !== shown) setShown(placeId);

  return (
    <BottomSheet open={!!placeId} onClose={onClose} size="large">
      {shown ? (
        <Suspense
          fallback={
            <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" />
          }
        >
          <SpotView placeId={shown} variant="sheet" onClose={onClose} />
        </Suspense>
      ) : null}
    </BottomSheet>
  );
}
