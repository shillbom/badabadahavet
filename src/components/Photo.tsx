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
  /** Extra classes merged onto the full <img>. */
  imgClassName?: string;
  /**
   * "cover" (default) crops to fill a fixed-size wrapper (thumbnails, strips).
   * "contain" shows the whole image at its natural aspect for a full-screen
   * viewer — size it via `imgClassName` (e.g. `max-h-[80dvh] max-w-full`).
   */
  fit?: "cover" | "contain";
};

/**
 * Renders a swim photo with an instant blurred LQIP placeholder that sharpens
 * into the full image once it loads. The tiny base64 `thumb` shows immediately
 * (no network), with the full `src` on top. Shared by the thumbnail strips,
 * the lists, and the full-screen Lightbox so the loading behaviour lives in
 * one place. Swims logged before thumbnails existed simply have no `thumb`.
 */
export default function Photo({
  src,
  thumb,
  alt = "",
  className,
  imgClassName,
  fit = "cover",
}: PhotoProps) {
  const [loaded, setLoaded] = useState(false);

  if (fit === "contain") {
    // The full image is the in-flow sizer (sized via `imgClassName`); the
    // blurred thumb sits behind it as a placeholder until the pixels arrive.
    return (
      <div className={cn("relative inline-block overflow-hidden", className)}>
        {thumb ? (
          <img
            src={thumb}
            alt=""
            aria-hidden
            className="pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover blur-md"
          />
        ) : null}
        <img
          src={src}
          alt={alt}
          decoding="async"
          onLoad={() => setLoaded(true)}
          className={cn(
            "relative block object-contain transition-opacity duration-500",
            loaded || !thumb ? "opacity-100" : "opacity-0",
            imgClassName,
          )}
        />
      </div>
    );
  }

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
