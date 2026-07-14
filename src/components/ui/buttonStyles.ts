import { cn } from "@/lib/utils";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "xs" | "sm" | "md" | "lg" | "icon" | "icon-sm";

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    "bg-wave-600 text-white hover:bg-wave-700 active:bg-wave-800 shadow-sm shadow-wave-700/30",
  secondary:
    "bg-white text-wave-800 ring-1 ring-wave-200 hover:bg-wave-50 active:bg-wave-100",
  ghost: "bg-transparent text-slate-700 hover:bg-slate-100",
  danger: "bg-rose-600 text-white hover:bg-rose-700",
};

const sizeStyles: Record<ButtonSize, string> = {
  xs: "h-7 px-3 text-xs",
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-6 text-base",
  icon: "h-10 w-10 p-0",
  "icon-sm": "h-8 w-8 p-0",
};

export function buttonClasses(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
  className?: string,
): string {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-full font-medium transition-colors",
    "focus-visible:ring-2 focus-visible:ring-wave-500 focus-visible:ring-offset-2 focus-visible:outline-none",
    "disabled:cursor-not-allowed disabled:opacity-60",
    variantStyles[variant],
    sizeStyles[size],
    className,
  );
}
