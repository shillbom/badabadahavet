import { useState } from "react";
import Photo from "@/components/Photo";
import Lightbox from "@/components/Lightbox";
import type { SessionDoc } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";

/**
 * A swim photo that handles the whole pattern in one place: the blurred LQIP
 * preload (via {@link Photo}), and tapping it to open the full-screen
 * {@link Lightbox}. Drop it in anywhere a swim photo is shown so call sites
 * don't each re-wire a button + lightbox state + <Lightbox>.
 *
 * Assumes `session.photoUrl` is set — callers render their own placeholder for
 * photo-less swims. `className` sizes/rounds the tappable box.
 */
export default function SwimPhoto({
  session,
  className,
  imgClassName,
}: {
  session: SessionDoc;
  className?: string;
  imgClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const t = useT();
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn("block overflow-hidden", className)}
        aria-label={t("common.view_photo")}
      >
        <Photo
          src={session.photoUrl!}
          thumb={session.photoThumb}
          className="h-full w-full"
          imgClassName={cn(
            "transition-transform hover:scale-110",
            imgClassName,
          )}
        />
      </button>
      <Lightbox
        session={open ? session : null}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
