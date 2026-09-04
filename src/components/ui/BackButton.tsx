"use client";

import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n";

/** The standard round page-header back button. Pops history unless `onClick`
 *  overrides (e.g. sheet variants that close instead of navigating). */
export default function BackButton({ onClick }: { onClick?: () => void }) {
  const router = useRouter();
  const t = useT();
  return (
    <button
      // Without an explicit type, a button inside a <form> is type="submit" —
      // on LogSessionPage that made "back" log the swim instead of leaving.
      type="button"
      onClick={onClick ?? (() => router.back())}
      className="rounded-full bg-white/70 p-2 ring-1 ring-slate-200"
      aria-label={t("common.back")}
    >
      <ArrowLeft className="h-4 w-4" />
    </button>
  );
}
