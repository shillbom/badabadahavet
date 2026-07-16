import { useEffect, useRef, useState } from "react";
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
 *
 * Cover-mode photos don't fetch the full image until the element is actually
 * near the viewport (IntersectionObserver, 800px margin — works for both
 * vertical lists and horizontal strips). Native loading="lazy" alone isn't
 * enough: its prefetch distance is thousands of pixels, so a photo-heavy spot
 * page would still download nearly everything up front. 800px keeps roughly
 * a screenful of lookahead so normal scrolling doesn't catch images popping
 * in; until the pixels arrive a pulsing ghost covers the box (thumb-less
 * swims would otherwise sit as a flat block and then flash to the photo).
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
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [nearView, setNearView] = useState(
    () => typeof IntersectionObserver === "undefined",
  );
  useEffect(() => {
    if (fit === "contain") return; // lightbox: always eager
    const el = boxRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNearView(true);
          io.disconnect();
        }
      },
      { rootMargin: "800px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [fit]);

  if (fit === "contain") {
    // Full-screen viewer: the full image is the in-flow sizer (capped to the
    // viewport so it's always fully visible and centred); the blurred thumb
    // sits behind as a placeholder until the pixels arrive. The full image is
    // always rendered (no opacity gated on onLoad — cached images can skip
    // that event and would otherwise stay invisible behind the blur).
    return (
      <div className={cn("relative inline-block overflow-hidden", className)}>
        {thumb ? (
          <img
            src={thumb}
            alt=""
            aria-hidden
            className="pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover blur-lg"
          />
        ) : null}
        <img
          src={src}
          alt={alt}
          decoding="async"
          className={cn(
            "relative block max-h-[85dvh] max-w-[92vw] object-contain",
            imgClassName,
          )}
        />
      </div>
    );
  }

  return (
    <div
      ref={boxRef}
      className={cn("relative overflow-hidden bg-wave-100", className)}
    >
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
      ) : !loaded ? (
        <div className="absolute inset-0 animate-pulse bg-wave-200/70" />
      ) : null}
      {nearView ? (
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
      ) : null}
    </div>
  );
}
