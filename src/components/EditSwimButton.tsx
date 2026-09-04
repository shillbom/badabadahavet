"use client";

import Link from "next/link";
import { Pencil } from "lucide-react";
import type { SessionDoc } from "@/lib/types";
import { currentYear, swimYear } from "@/lib/scoring";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * The pencil that opens a swim in the edit page. Rendered wherever swims are
 * listed so a swim of mine is always editable — it hides itself for other
 * people's swims and for locked past seasons (which `updateSession` rejects
 * anyway). Sheets pass `onNavigate` to close themselves before the route
 * change.
 */
export default function EditSwimButton({
  session,
  myUid,
  onNavigate,
  className,
}: {
  session: Pick<SessionDoc, "id" | "uid" | "date">;
  myUid?: string;
  onNavigate?: () => void;
  className?: string;
}) {
  const t = useT();
  if (!myUid || session.uid !== myUid) return null;
  if (swimYear(session.date) < currentYear()) return null;
  return (
    <Link
      href={`/swim/${session.id}/edit`}
      onClick={onNavigate}
      className={cn(
        "rounded-full bg-white/80 p-1.5 text-wave-700 ring-1 ring-slate-200 hover:bg-white",
        className,
      )}
      aria-label={t("swim.edit")}
      title={t("swim.edit")}
    >
      <Pencil className="h-3.5 w-3.5" />
    </Link>
  );
}
