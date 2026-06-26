import { useState } from "react";
import { cn } from "@/lib/utils";

type PhotoProps = {
  /** Full-resolution image URL. */
  src: string;
  /** Tiny inline base64 LQIP placeholder (optional, older swims lack it). */
  thumb?: string;
  alt?: string;
  /** Classes for the wrapper — sizing/rounding live here (e.g. h-20 w-20). */
  className?: string;
  /** Extra classes merged onto the <img> (defaults to object-cover). */
  imgClassName?: string;
};

/**
 * Renders a swim photo with an instant blurred LQIP placeholder that
 * sharpens into the full image once it loads. The tiny base64 thumb is
 * shown immediately (no network), the full `src` fades in on top, and
 * both fill the wrapper so there's no layout shift. Swims logged before
 * thumbnails existed simply have no `thumb` and show the full image.
 */
export default function Photo({
  src,
  thumb,
  alt = "",
  className,
  imgClassName,
}: PhotoProps) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div className={cn("relative overflow-hidden bg-wave-100", className)}>
      {thumb ? (
        <img
          src={thumb}
          alt=""
          aria-hidden
          className={cn(
            "absolute inset-0 h-full w-full scale-110 object-cover blur-md transition-opacity duration-500",
            loaded ? "opacity-0" : "opacity-100",
          )}
        />
      ) : null}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        onLoad={() => setLoaded(true)}
        className={cn(
          "h-full w-full object-cover transition-opacity duration-500",
          loaded || !thumb ? "opacity-100" : "opacity-0",
          imgClassName,
        )}
      />
    </div>
  );
}
