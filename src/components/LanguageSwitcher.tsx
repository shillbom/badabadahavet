import { useLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function LanguageSwitcher({ className }: { className?: string }) {
  const locale = useLocale((s) => s.locale);
  const setLocale = useLocale((s) => s.setLocale);
  return (
    <div
      className={cn(
        "flex rounded-full bg-white/80 p-0.5 text-[11px] font-bold tracking-wide uppercase shadow-sm ring-1 ring-white/70",
        className,
      )}
      role="group"
      aria-label="Language"
    >
      <button
        type="button"
        onClick={() => setLocale("sv")}
        data-active={locale === "sv"}
        className="rounded-full px-2.5 py-1 text-slate-500 transition data-[active=true]:bg-wave-600 data-[active=true]:text-white"
        aria-pressed={locale === "sv"}
      >
        SV
      </button>
      <button
        type="button"
        onClick={() => setLocale("en")}
        data-active={locale === "en"}
        className="rounded-full px-2.5 py-1 text-slate-500 transition data-[active=true]:bg-wave-600 data-[active=true]:text-white"
        aria-pressed={locale === "en"}
      >
        EN
      </button>
    </div>
  );
}
