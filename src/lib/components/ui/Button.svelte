<script lang="ts">
  import { cn } from "@/lib/utils";
  import type { Snippet } from "svelte";
  import type { HTMLButtonAttributes } from "svelte/elements";

  type Variant = "primary" | "secondary" | "ghost" | "danger";
  type Size = "sm" | "md" | "lg" | "icon";

  type Props = HTMLButtonAttributes & {
    variant?: Variant;
    size?: Size;
    loading?: boolean;
    class?: string;
    children?: Snippet;
  };

  let {
    variant = "primary",
    size = "md",
    loading = false,
    disabled = false,
    class: className = "",
    children,
    ...rest
  }: Props = $props();

  const variantStyles: Record<Variant, string> = {
    primary:
      "bg-wave-600 text-white hover:bg-wave-700 active:bg-wave-800 shadow-sm shadow-wave-700/30",
    secondary:
      "bg-white text-wave-800 ring-1 ring-wave-200 hover:bg-wave-50 active:bg-wave-100",
    ghost: "bg-transparent text-slate-700 hover:bg-slate-100",
    danger: "bg-rose-600 text-white hover:bg-rose-700",
  };

  const sizeStyles: Record<Size, string> = {
    sm: "h-8 px-3 text-sm",
    md: "h-10 px-4 text-sm",
    lg: "h-12 px-6 text-base",
    icon: "h-10 w-10 p-0",
  };
</script>

<button
  disabled={disabled || loading}
  class={cn(
    "inline-flex items-center justify-center gap-2 rounded-full font-medium transition-colors",
    "focus-visible:ring-2 focus-visible:ring-wave-500 focus-visible:ring-offset-2 focus-visible:outline-none",
    "disabled:cursor-not-allowed disabled:opacity-60",
    variantStyles[variant],
    sizeStyles[size],
    className,
  )}
  {...rest}
>
  {#if loading}
    <span
      class="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent"
    ></span>
  {/if}
  {@render children?.()}
</button>
