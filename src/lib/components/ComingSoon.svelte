<script lang="ts">
  import { ArrowLeft } from "@lucide/svelte";
  import { t } from "@/lib/i18n";

  // Placeholder for routes not yet ported in this migration pass. Keeps the
  // nav coherent so links don't 404 while Phase 3 is finished incrementally.
  let { title }: { title: string } = $props();
</script>

<div
  class="flex min-h-[60dvh] flex-col items-center justify-center gap-3 px-6 text-center"
>
  <button
    onclick={() => history.back()}
    class="absolute top-16 left-4 rounded-full bg-white/70 p-2 ring-1 ring-slate-200"
    aria-label={t("common.back")}
  >
    <ArrowLeft class="h-4 w-4" />
  </button>
  <span class="text-4xl">🚧</span>
  <h2 class="font-display text-2xl font-black text-wave-900">{title}</h2>
  <p class="max-w-xs text-sm text-slate-500">
    This screen hasn't been migrated to SvelteKit yet. The foundation (auth,
    state, map, routing) is in place — remaining pages port incrementally.
  </p>
</div>
