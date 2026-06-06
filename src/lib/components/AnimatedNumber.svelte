<script lang="ts">
  import { untrack } from "svelte";
  import { Tween } from "svelte/motion";
  import { cubicOut } from "svelte/easing";

  let {
    value,
    duration = 700,
    format,
    class: className = "",
  }: {
    value: number;
    duration?: number;
    format?: (n: number) => string;
    class?: string;
  } = $props();

  // framer-motion's per-digit odometer is replaced by a smooth eased
  // count-up via Svelte's Tween — same effect, far less code. `untrack`
  // makes it explicit that only the initial value/duration seed the Tween;
  // later updates flow through the effect below.
  const tween = new Tween(
    untrack(() => value),
    {
      duration: untrack(() => duration),
      easing: cubicOut,
    },
  );

  $effect(() => {
    tween.target = value;
  });

  let display = $derived(
    format ? format(tween.current) : Math.round(tween.current).toString(),
  );
</script>

<span class={`inline-flex ${className}`}>{display}</span>
