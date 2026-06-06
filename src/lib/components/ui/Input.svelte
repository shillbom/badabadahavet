<script lang="ts">
  import { cn } from "@/lib/utils";
  import type { HTMLInputAttributes } from "svelte/elements";

  type Props = HTMLInputAttributes & { class?: string; value?: string };

  let {
    class: className = "",
    value = $bindable(""),
    ...rest
  }: Props = $props();
</script>

<input
  bind:value
  class={cn(
    "h-11 w-full rounded-xl border border-slate-200 bg-white/90 px-3.5 text-sm shadow-sm",
    "placeholder:text-slate-400",
    "focus:border-wave-500 focus:ring-2 focus:ring-wave-200 focus:outline-none",
    "disabled:cursor-not-allowed disabled:opacity-60",
    className,
  )}
  {...rest}
/>
