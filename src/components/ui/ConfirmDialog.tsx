import { useEffect, useRef, useState } from "react";
import { AnimatePresence, m } from "framer-motion";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import {
  useConfirmStore,
  type ConfirmRequest,
} from "@/components/ui/confirmStore";
import { useT } from "@/lib/i18n";

/**
 * The single in-app dialog behind `confirm()` / `promptText()`. Mounted once
 * in App, above every bottom sheet but below the toasts.
 */
export default function ConfirmDialog() {
  const request = useConfirmStore((s) => s.request);
  const settle = useConfirmStore((s) => s.settle);
  const t = useT();
  const [value, setValue] = useState("");

  // Keep the last request around so the exit animation still has content to
  // render after the store clears it (same trick as BottomSheet callers).
  const last = useRef<ConfirmRequest | null>(null);
  if (request) last.current = request;
  const shown = request ?? last.current;
  const isPrompt = shown?.kind === "prompt";

  useEffect(() => {
    if (request) setValue(request.defaultValue ?? "");
  }, [request]);

  useEffect(() => {
    if (!request) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") settle(request.kind === "prompt" ? null : false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [request, settle]);

  const cancel = () => settle(isPrompt ? null : false);

  return (
    <AnimatePresence>
      {request && shown ? (
        <>
          <m.div
            key="confirm-backdrop"
            aria-hidden="true"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={cancel}
            className="fixed inset-0 z-[1900] bg-black/40 backdrop-blur-sm"
          />
          <m.div
            key="confirm-panel"
            role="dialog"
            aria-modal="true"
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 360, damping: 28 }}
            className="fixed inset-x-4 top-1/2 z-[1901] mx-auto max-w-sm -translate-y-1/2 rounded-2xl bg-white p-5 shadow-xl ring-1 ring-black/5"
          >
            <form
              onSubmit={(e) => {
                e.preventDefault();
                settle(isPrompt ? value.trim() : true);
              }}
            >
              {shown.title ? (
                <h2 className="font-display text-lg font-black text-wave-900">
                  {shown.title}
                </h2>
              ) : null}
              {shown.message ? (
                <p className="mt-1 text-sm text-slate-600">{shown.message}</p>
              ) : null}
              {isPrompt ? (
                <Input
                  autoFocus
                  className="mt-3"
                  value={value}
                  placeholder={shown.placeholder}
                  onChange={(e) => setValue(e.target.value)}
                />
              ) : null}
              <div className="mt-5 flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={cancel}>
                  {shown.cancelLabel ?? t("common.cancel")}
                </Button>
                <Button
                  type="submit"
                  variant={shown.danger ? "danger" : "primary"}
                  disabled={isPrompt && !value.trim()}
                >
                  {shown.confirmLabel ?? t("common.confirm")}
                </Button>
              </div>
            </form>
          </m.div>
        </>
      ) : null}
    </AnimatePresence>
  );
}
