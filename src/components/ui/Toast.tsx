import type * as React from "react";
import { AnimatePresence, m } from "framer-motion";
import { CheckCircle2, AlertTriangle, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToastStore, type ToastKind } from "@/components/ui/toastStore";

const iconFor: Record<ToastKind, React.ReactElement> = {
  success: <CheckCircle2 className="h-4 w-4 text-emerald-600" />,
  error: <AlertTriangle className="h-4 w-4 text-rose-600" />,
  info: <Info className="h-4 w-4 text-wave-600" />,
};

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[max(env(safe-area-inset-top),0.5rem)] z-[2000] flex flex-col items-center gap-2 px-3">
      <AnimatePresence>
        {toasts.map((t) => (
          <m.div
            key={t.id}
            initial={{ opacity: 0, y: -16, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -16, scale: 0.95 }}
            transition={{ type: "spring", stiffness: 400, damping: 28 }}
            className={cn(
              "pointer-events-auto flex items-center gap-2 rounded-full bg-white/95 px-4 py-2 text-sm shadow-lg ring-1 ring-black/5",
            )}
          >
            {iconFor[t.kind]}
            <span>{t.message}</span>
          </m.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
