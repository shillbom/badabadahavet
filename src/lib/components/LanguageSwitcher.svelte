<script lang="ts">
  import { localeStore } from "@/lib/stores/locale.svelte";
  import { cn } from "@/lib/utils";

  let { class: className = "" }: { class?: string } = $props();
</script>

<div
  class={cn(
    "flex rounded-full bg-white/80 p-0.5 text-[11px] font-bold tracking-wide uppercase shadow-sm ring-1 ring-white/70",
    className,
  )}
  role="group"
  aria-label="Language"
>
  <button
    type="button"
    onclick={() => localeStore.set("sv")}
    data-active={localeStore.current === "sv"}
    class="rounded-full px-2.5 py-1 text-slate-500 transition data-[active=true]:bg-wave-600 data-[active=true]:text-white"
    aria-pressed={localeStore.current === "sv"}
  >
    SV
  </button>
  <button
    type="button"
    onclick={() => localeStore.set("en")}
    data-active={localeStore.current === "en"}
    class="rounded-full px-2.5 py-1 text-slate-500 transition data-[active=true]:bg-wave-600 data-[active=true]:text-white"
    aria-pressed={localeStore.current === "en"}
  >
    EN
  </button>
</div>
