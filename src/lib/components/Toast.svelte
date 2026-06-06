<script lang="ts">
  import { toastStore } from "@/lib/stores/toast.svelte";
  import { CheckCircle2, AlertTriangle, Info } from "@lucide/svelte";
  import { fly } from "svelte/transition";
</script>

<div
  class="pointer-events-none fixed inset-x-0 top-[max(env(safe-area-inset-top),0.5rem)] z-[2000] flex flex-col items-center gap-2 px-3"
>
  {#each toastStore.toasts as toast (toast.id)}
    <div
      transition:fly={{ y: -16, duration: 220 }}
      class="pointer-events-auto flex items-center gap-2 rounded-full bg-white/95 px-4 py-2 text-sm shadow-lg ring-1 ring-black/5"
    >
      {#if toast.kind === "success"}
        <CheckCircle2 class="h-4 w-4 text-emerald-600" />
      {:else if toast.kind === "error"}
        <AlertTriangle class="h-4 w-4 text-rose-600" />
      {:else}
        <Info class="h-4 w-4 text-wave-600" />
      {/if}
      <span>{toast.message}</span>
    </div>
  {/each}
</div>
