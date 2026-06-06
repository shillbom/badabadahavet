<script lang="ts">
  import { ArrowLeft } from "@lucide/svelte";
  import type { Snippet } from "svelte";
  import { t } from "@/lib/i18n";
</script>

{#snippet section(title: string, body: Snippet)}
  <section class="mt-6">
    <h3
      class="mb-2 text-xs font-semibold tracking-wide text-wave-700 uppercase"
    >
      {title}
    </h3>
    <div
      class="rounded-2xl bg-white/70 p-3 text-sm leading-relaxed text-slate-700 ring-1 ring-white/60"
    >
      {@render body()}
    </div>
  </section>
{/snippet}

<div class="px-4 pt-2 pb-12">
  <div class="mb-4 flex items-center gap-2">
    <button
      onclick={() => history.back()}
      class="rounded-full bg-white/70 p-2 ring-1 ring-slate-200"
      aria-label={t("common.back")}
    >
      <ArrowLeft class="h-4 w-4" />
    </button>
    <h2 class="font-display text-2xl font-black text-wave-900">
      {t("about.title")}
    </h2>
  </div>

  <div class="flex flex-col items-center gap-2">
    <img
      src="/web-app-manifest-192x192.png"
      alt="Badligan"
      width="64"
      height="64"
      class="h-16 w-16 rounded-2xl shadow-md"
    />
    <h3 class="font-display text-xl font-black text-wave-900">
      {t("app.name")}
    </h3>
    <p class="text-center text-sm text-slate-600">{t("about.tagline")}</p>
  </div>

  {#snippet whatBody()}
    <p>{t("about.what.body")}</p>
  {/snippet}
  {@render section(t("about.what.title"), whatBody)}

  {#snippet scoringBody()}
    <ul class="list-disc space-y-1.5 pl-5">
      <li>{t("about.scoring.bracket")}</li>
      <li>{t("about.scoring.new_place")}</li>
      <li>{t("about.scoring.xmas")}</li>
      <li>{t("about.scoring.abroad")}</li>
      <li>{t("about.scoring.streak")}</li>
    </ul>
  {/snippet}
  {@render section(t("about.scoring.title"), scoringBody)}

  {#snippet dataBody()}
    <p>
      {t("about.data.body")}
      <a
        href="https://badplatsen.havochvatten.se/"
        target="_blank"
        rel="noopener noreferrer"
        class="font-semibold text-wave-700 underline hover:text-wave-800"
      >
        badplatsen.havochvatten.se
      </a>.
    </p>
  {/snippet}
  {@render section(t("about.data.title"), dataBody)}

  {#snippet privacyBody()}
    <p>{t("about.privacy.body")}</p>
  {/snippet}
  {@render section(t("about.privacy.title"), privacyBody)}

  {#snippet techBody()}
    <p>{t("about.tech.body")}</p>
    <p class="mt-2">
      {t("about.tech.source")}
      <a
        href="https://github.com/shillbom/badabadahavet"
        target="_blank"
        rel="noopener noreferrer"
        class="font-semibold text-wave-700 underline hover:text-wave-800"
      >
        GitHub
      </a>.
    </p>
  {/snippet}
  {@render section(t("about.tech.title"), techBody)}

  <div class="mt-8 text-center text-xs text-slate-500">
    <p>
      {t("about.created_by")}
      <a
        href="https://www.linkedin.com/in/simon-hillbom/"
        target="_blank"
        rel="noopener noreferrer"
        class="font-semibold text-wave-700 underline hover:text-wave-800"
      >
        Simon Hillbom
      </a>
    </p>
  </div>
  <div class="mt-3 text-center text-xs text-slate-500">
    <a href="/profile" class="hover:underline">← {t("profile.title")}</a>
  </div>
</div>
