import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useT } from "@/lib/i18n";

/** The standard round page-header back button. Pops history unless `onClick`
 *  overrides (e.g. sheet variants that close instead of navigating). */
export default function BackButton({ onClick }: { onClick?: () => void }) {
  const navigate = useNavigate();
  const t = useT();
  return (
    <button
      onClick={onClick ?? (() => navigate(-1))}
      className="rounded-full bg-white/70 p-2 ring-1 ring-slate-200"
      aria-label={t("common.back")}
    >
      <ArrowLeft className="h-4 w-4" />
    </button>
  );
}
