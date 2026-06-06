<script lang="ts">
  import { cn } from "@/lib/utils";
  import type { Snippet } from "svelte";
  import type { HTMLLabelAttributes } from "svelte/elements";

  let {
    class: className = "",
    children,
    ...rest
  }: HTMLLabelAttributes & { class?: string; children?: Snippet } = $props();
</script>

<label
  class={cn(
    "text-xs font-medium tracking-wide text-slate-500 uppercase",
    className,
  )}
  {...rest}
>
  {@render children?.()}
</label>
