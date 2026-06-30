import { useRef } from "react";
import BottomSheet from "@/components/BottomSheet";
import { SpotView } from "@/pages/SpotPage";

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
  const lastRef = useRef<string | null>(placeId);
  if (placeId) lastRef.current = placeId;
  const shown = placeId ?? lastRef.current;

  return (
    <BottomSheet open={!!placeId} onClose={onClose} size="large">
      {shown ? (
        <SpotView placeId={shown} variant="sheet" onClose={onClose} />
      ) : null}
    </BottomSheet>
  );
}
