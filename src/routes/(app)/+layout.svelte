<script lang="ts">
  import { page } from "$app/state";
  import { goto } from "$app/navigation";
  import {
    Map as MapIcon,
    Trophy,
    Plus,
    ListChecks,
    LogIn,
  } from "@lucide/svelte";
  import { authStore } from "@/lib/stores/auth.svelte";
  import { appStore } from "@/lib/stores/app.svelte";
  import { cn, rememberReturnPath } from "@/lib/utils";
  import { t } from "@/lib/i18n";

  let { children } = $props();

  const PROTECTED = [
    "/history",
    "/groups",
    "/log",
    "/achievements",
    "/recap",
    "/profile",
    "/toswim",
  ];

  const pathname = $derived(page.url.pathname);
  const isGuest = $derived(!authStore.user);
  // Full-screen story routes hide the bottom nav + FAB.
  const hideChrome = $derived(
    pathname.startsWith("/recap") || pathname.startsWith("/log"),
  );
  // The map page is non-scrolling — the map fills available space.
  const isMapPage = $derived(pathname === "/");

  // Route guard: bounce guests off protected routes, and force Google
  // onboarding users back to the login screen to finish signup.
  $effect(() => {
    if (authStore.loading) return;
    const isProtected = PROTECTED.some((p) => pathname.startsWith(p));
    if (authStore.googleOnboarding) {
      goto("/login");
    } else if (!authStore.user && isProtected) {
      rememberReturnPath();
      goto("/login");
    }
  });

  const groupSubtitle = $derived(
    appStore.groups.length === 0
      ? t("layout.solo_swimmer")
      : appStore.groups.length === 1
        ? t("layout.groups_one")
        : t("layout.groups_many", { n: appStore.groups.length }),
  );

  const tabs = $derived(
    [
      { to: "/", label: t("nav.map"), guestOk: true },
      { to: "/toswim", label: t("nav.toswim"), guestOk: false },
      { to: "/leaderboard", label: t("nav.top"), guestOk: true },
      { to: "/groups", label: t("nav.groups"), guestOk: false },
    ].filter((tab) => tab.guestOk || !isGuest),
  );

  function isActive(to: string): boolean {
    return to === "/" ? pathname === "/" : pathname.startsWith(to);
  }
</script>

<div
  class="relative mx-auto flex h-[100dvh] w-full max-w-md flex-col overflow-hidden md:border-x md:border-white/60 md:bg-white/30 md:shadow-[0_0_40px_-10px_rgba(2,100,160,0.18)] md:backdrop-blur-sm"
>
  <header
    class="sticky top-0 z-[1000] flex items-center justify-between bg-gradient-to-b from-white/80 to-transparent px-4 pt-[max(env(safe-area-inset-top),0.75rem)] pb-2 backdrop-blur-sm"
  >
    {#if isGuest}
      <a
        href="/login"
        onclick={rememberReturnPath}
        class="flex items-center gap-2"
      >
        <span class="text-2xl">🌊</span>
        <div>
          <div
            class="font-display text-base leading-none font-bold text-wave-900"
          >
            {t("layout.guest")}
          </div>
          <div class="text-[11px] text-wave-700/70">
            {t("layout.guest.subtitle")}
          </div>
        </div>
      </a>
      <a
        href="/login"
        onclick={rememberReturnPath}
        class="inline-flex items-center gap-1.5 rounded-full bg-wave-600 px-3 py-1.5 text-xs font-semibold text-white shadow hover:bg-wave-700"
      >
        <LogIn class="h-3.5 w-3.5" />
        {t("layout.sign_in")}
      </a>
    {:else}
      <a href="/profile" class="flex items-center gap-2">
        <span class="text-2xl">{authStore.profile?.emoji ?? "🌊"}</span>
        <div>
          <div class="flex items-center gap-1.5">
            <div
              class="font-display text-base leading-none font-bold text-wave-900"
            >
              {authStore.profile?.displayName ?? t("layout.swimmer")}
            </div>
            {#if authStore.profile?.isAdmin}
              <span
                class="rounded-full bg-amber-500 px-1.5 py-0.5 text-[9px] font-bold tracking-widest text-white uppercase shadow"
                title={t("admin.label")}
              >
                {t("admin.label")}
              </span>
            {/if}
          </div>
          <div class="text-[11px] text-wave-700/70">{groupSubtitle}</div>
        </div>
      </a>
      <div class="w-8" aria-hidden="true"></div>
    {/if}
  </header>

  <main
    class={cn(
      "relative flex flex-1 flex-col overflow-x-hidden",
      isMapPage
        ? "overflow-hidden"
        : hideChrome
          ? "overflow-y-auto pb-4"
          : "overflow-y-auto pb-32",
    )}
  >
    <div class={isMapPage ? "flex min-h-0 flex-1 flex-col" : undefined}>
      {@render children()}
    </div>
  </main>

  {#if !hideChrome && !isGuest}
    <div
      class="pointer-events-none fixed inset-x-0 bottom-[max(env(safe-area-inset-bottom),1.5rem)] z-[1010] mx-auto flex max-w-md justify-center"
    >
      <button
        onclick={() => goto("/log")}
        class="pointer-events-auto flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-wave-500 to-wave-700 text-white shadow-xl ring-4 shadow-wave-800/40 ring-white/70 transition active:scale-95"
        aria-label={t("layout.log_a_swim")}
      >
        <Plus class="relative h-6 w-6" />
      </button>
    </div>
  {/if}

  {#if !hideChrome}
    <nav
      class="fixed inset-x-0 bottom-0 z-[1000] mx-auto flex max-w-md justify-around border-t border-white/70 bg-white/85 px-4 pt-2 pb-[max(env(safe-area-inset-bottom),0.5rem)] backdrop-blur"
    >
      {#each tabs as tab (tab.to)}
        <a
          href={tab.to}
          class={cn(
            "relative flex w-12 flex-col items-center gap-0.5 rounded-2xl px-1 py-1 text-[10px] font-medium transition-colors",
            isActive(tab.to)
              ? "text-wave-700"
              : "text-slate-400 hover:text-slate-600",
          )}
        >
          {#if isActive(tab.to)}
            <span
              class="absolute inset-0 -z-10 rounded-2xl bg-wave-100/80 ring-1 ring-wave-200"
            ></span>
          {/if}
          {#if tab.to === "/"}
            <MapIcon class="h-5 w-5" />
          {:else if tab.to === "/toswim"}
            <ListChecks class="h-5 w-5" />
          {:else if tab.to === "/leaderboard"}
            <Trophy class="h-5 w-5" />
          {:else}
            <span class="text-base">👥</span>
          {/if}
          <span>{tab.label}</span>
        </a>
      {/each}
    </nav>
  {/if}
</div>
