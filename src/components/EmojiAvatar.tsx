import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const SIZES = {
  sm: "h-8 w-8 text-lg",
  md: "h-10 w-10 text-xl",
  lg: "h-12 w-12 text-2xl",
  xl: "h-16 w-16 text-4xl",
} as const;

/**
 * A user/group emoji in the standard wave-tinted circle. `ring` adds the
 * subtle wave outline used on standalone avatars; row avatars skip it.
 * `children` renders inside the (relative) circle for overlays like the
 * leader crown.
 */
export default function EmojiAvatar({
  emoji,
  size = "md",
  ring,
  className,
  children,
}: {
  emoji?: string | null;
  size?: keyof typeof SIZES;
  ring?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "relative flex flex-none items-center justify-center rounded-full bg-wave-100",
        SIZES[size],
        ring && "ring-1 ring-wave-200",
        className,
      )}
    >
      {emoji ?? "🌊"}
      {children}
    </div>
  );
}
