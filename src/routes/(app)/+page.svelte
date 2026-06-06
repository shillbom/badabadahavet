<script lang="ts">
  import { Flame, MapPin, Trophy } from "@lucide/svelte";
  import { authStore } from "@/lib/stores/auth.svelte";
  import { appStore } from "@/lib/stores/app.svelte";
  import SwimMap, { type MapAction } from "@/lib/components/SwimMap.svelte";
  import { t, getTimeGreeting } from "@/lib/i18n";
  import AnimatedNumber from "@/lib/components/AnimatedNumber.svelte";

  const isGuest = $derived(!authStore.user);

  let fitToken = $state(0);
  let showAll = $state(true);
  let prevShowAll = $state(true);

  // Re-fit whenever the toggle flips (switching to "mine" zooms to fit them,
  // "all" re-centres on the user).
  $effect(() => {
    if (showAll !== prevShowAll) {
      prevShowAll = showAll;
      fitToken += 1;
    }
  });

  // Seed from Firestore so the map opens at the right place without GPS.
  const myLocation = $derived(
    appStore.currentLocation ?? authStore.profile?.lastLocation ?? null,
  );

  // Hold the map until we have a real position when permission is granted
  // (prevents Stockholm → real-location ping-pong on first load).
  const mapReady = $derived(
    appStore.locationPermission !== "checking" &&
      (appStore.locationPermission !== "granted" || myLocation !== null),
  );

  const totalPoints = $derived(
    appStore.myStats.totalPoints + appStore.achievementBonusPoints,
  );

  // Stable random seed picked once per mount — getTimeGreeting reads the
  // locale internally so the greeting re-derives when language changes.
  const greetingSeed = Math.floor(Math.random() * 1000);
  const greetingName = $derived(
    authStore.profile?.displayName ?? t("layout.swimmer"),
  );
  const greeting = $derived(getTimeGreeting(greetingName, greetingSeed));

  const subtitle = $derived(
    appStore.myStats.totalSwims === 0
      ? t("map.empty.subtitle")
      : appStore.myStats.daysSinceLast === 0
        ? t("map.last.today")
        : appStore.myStats.daysSinceLast === 1
          ? t("map.last.yesterday")
          : t("map.last.days", { n: appStore.myStats.daysSinceLast ?? 0 }),
  );

  const mapActions = $derived<MapAction[]>(
    isGuest
      ? []
      : [
          {
            label: showAll ? t("map.show.mine") : t("map.show.all"),
            onClick: () => (showAll = !showAll),
          },
        ],
  );
</script>

<div
  class="flex min-h-0 flex-1 flex-col gap-3 px-4 pt-2 pb-[calc(max(env(safe-area-inset-bottom),0.5rem)+6rem)]"
>
  {#if isGuest}
    <div class="glass flex items-center justify-between gap-3 p-3">
      <div class="min-w-0">
        <div class="font-display text-base font-bold text-wave-900">
          {t("map.guest.title")}
        </div>
        <div class="text-[11px] text-slate-500">{t("map.guest.subtitle")}</div>
      </div>
    </div>
  {:else}
    <div>
      <h2 class="font-display text-2xl font-black text-wave-900">{greeting}</h2>
      <p class="text-sm text-slate-500">{subtitle}</p>
    </div>
  {/if}

  {#if !isGuest}
    {@const stats = appStore.myStats}
    <div class="grid grid-cols-3 gap-2">
      <a
        href="/history"
        class="glass flex flex-col items-start gap-1 px-3 py-2.5"
      >
        <div
          class="flex items-center gap-1 text-[10px] font-semibold tracking-wide text-wave-700 uppercase"
        >
          <Trophy class="h-4 w-4" />
          {t("map.stat.points")}
        </div>
        <AnimatedNumber
          value={totalPoints}
          class="font-display text-2xl font-black text-wave-900"
        />
        {#if appStore.achievementBonusPoints > 0}
          <div class="text-[10px] text-amber-700">
            {t("map.bonus.subtitle", { n: appStore.achievementBonusPoints })}
          </div>
        {/if}
      </a>

      <button
        type="button"
        onclick={() => (fitToken += 1)}
        class="glass flex w-full flex-col items-start gap-1 px-3 py-2.5 text-left"
      >
        <div
          class="flex items-center gap-1 text-[10px] font-semibold tracking-wide text-wave-700 uppercase"
        >
          <MapPin class="h-4 w-4" />
          {t("map.stat.spots")}
        </div>
        <AnimatedNumber
          value={stats.uniquePlaces}
          class="font-display text-2xl font-black text-wave-900"
        />
      </button>

      <a
        href="/history?view=streak"
        class="glass flex flex-col items-start gap-1 px-3 py-2.5"
      >
        <div
          class="flex items-center gap-1 text-[10px] font-semibold tracking-wide text-wave-700 uppercase"
        >
          <Flame class="h-4 w-4" />
          {t("map.stat.streak")}
        </div>
        <AnimatedNumber
          value={stats.currentDayStreak}
          class="font-display text-2xl font-black text-wave-900"
        />
        {#if stats.currentDayStreak > 0 && stats.daysSinceLast === 1}
          <div class="text-[10px] text-amber-700">
            {t("map.streak.at_risk")}
          </div>
        {/if}
      </a>
    </div>
  {/if}

  <div
    class="relative min-h-0 flex-1 overflow-hidden rounded-2xl border border-white/60 shadow-sm"
  >
    <div class="absolute inset-0">
      {#if mapReady}
        <SwimMap
          places={isGuest || showAll ? appStore.places : appStore.myPlaces}
          sessionsByPlace={appStore.sessionsByPlace}
          userLocation={myLocation}
          {fitToken}
          fitBoundsToPlaces={!isGuest && !showAll}
          viewKey="main"
          topRightActions={mapActions}
        />
      {:else}
        <div class="h-full w-full bg-slate-100"></div>
      {/if}
    </div>
  </div>

  {#if !isGuest && appStore.myStats.totalSwims === 0}
    <p class="text-center text-xs text-slate-500">{t("map.empty.helper")}</p>
  {/if}
</div>
