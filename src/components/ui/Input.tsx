import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "h-11 w-full rounded-xl border border-slate-200 bg-white/90 px-3.5 text-sm shadow-sm",
      "placeholder:text-slate-400",
      "focus:border-wave-500 focus:outline-none focus:ring-2 focus:ring-wave-200",
      "disabled:cursor-not-allowed disabled:opacity-60",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "w-full rounded-xl border border-slate-200 bg-white/90 px-3.5 py-2.5 text-sm shadow-sm",
      "placeholder:text-slate-400",
      "focus:border-wave-500 focus:outline-none focus:ring-2 focus:ring-wave-200",
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";

export function Label({
  className,
  children,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn(
        "text-xs font-medium uppercase tracking-wide text-slate-500",
        className,
      )}
      {...props}
    >
      {children}
    </label>
  );
}
