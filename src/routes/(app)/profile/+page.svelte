<script lang="ts">
  import type { Snippet } from "svelte";
  import { goto } from "$app/navigation";
  import {
    ArrowLeft,
    Award,
    CalendarHeart,
    Check,
    ChevronRight,
    Clock,
    Compass,
    Flame,
    History as HistoryIcon,
    Info,
    LogOut,
    MapPin,
    Pencil,
    Snowflake,
    Sparkles,
    Star,
    Trash2,
    Trophy,
    X,
  } from "@lucide/svelte";
  import { updateProfile } from "firebase/auth";
  import { auth } from "@/lib/firebase";
  import { authStore } from "@/lib/stores/auth.svelte";
  import { appStore } from "@/lib/stores/app.svelte";
  import {
    updateUserDisplayName,
    updateUserEmoji,
    updateUserHomeCountry,
    updateUserLocale,
  } from "@/lib/data";
  import { localeStore } from "@/lib/stores/locale.svelte";
  import { COUNTRIES, flagEmoji } from "@/lib/countries";
  import { ACHIEVEMENTS } from "@/lib/achievements";
  import { formatDate, cn } from "@/lib/utils";
  import { monthShort, t } from "@/lib/i18n";
  import AnimatedNumber from "@/lib/components/AnimatedNumber.svelte";
  import Input from "@/lib/components/ui/Input.svelte";
  import { toast } from "@/lib/stores/toast.svelte";

  const EMOJI_POOL = [
    "🐬",
    "🦭",
    "🐟",
    "🦦",
    "🐳",
    "🪼",
    "🐠",
    "🦑",
    "🐢",
    "🦞",
    "🐙",
    "🦈",
    "🐧",
    "🦆",
    "🦀",
    "🪴",
  ];

  const profile = $derived(authStore.profile);
  const stats = $derived(appStore.myStats);

  let editingName = $state(false);
  let nameInput = $state("");
  let emojiOpen = $state(false);
  let confirmDelete = $state(false);
  let busy = $state(false);
  let deleting = $state(false);

  async function pickLocale(next: "sv" | "en") {
    localeStore.set(next);
    if (authStore.user) {
      try {
        await updateUserLocale(authStore.user.uid, next);
      } catch {
        /* non-fatal; local pref is already updated */
      }
    }
  }

  async function onDeleteAccount() {
    deleting = true;
    try {
      await authStore.deleteAccount();
      goto("/", { replaceState: true });
    } catch (e) {
      const msg = (e as Error).message ?? "";
      toast.error(
        msg.includes("requires-recent-login")
          ? t("profile.delete.relogin")
          : t("profile.delete.error"),
      );
    } finally {
      deleting = false;
    }
  }

  async function pickHomeCountry(next: string) {
    if (!authStore.user) return;
    try {
      await updateUserHomeCountry(authStore.user.uid, next);
      toast.success(t("profile.home_country_saved"));
    } catch {
      toast.error(t("profile.save_error"));
    }
  }

  async function saveName(e: SubmitEvent) {
    e.preventDefault();
    const user = authStore.user;
    if (!user) return;
    const trimmed = nameInput.trim();
    if (!trimmed) return;
    busy = true;
    try {
      // Keep Firebase Auth and Firestore in sync so ensureUserDoc doesn't
      // revert the name on the next app load.
      await updateProfile(auth.currentUser!, { displayName: trimmed });
      await updateUserDisplayName(user.uid, trimmed);
      toast.success(t("profile.name_saved"));
      editingName = false;
    } catch {
      toast.error(t("profile.save_error"));
    } finally {
      busy = false;
    }
  }

  async function pickEmoji(emoji: string) {
    if (!authStore.user) return;
    try {
      await updateUserEmoji(authStore.user.uid, emoji);
      toast.success(t("profile.emoji_saved"));
      emojiOpen = false;
    } catch {
      toast.error(t("profile.save_error"));
    }
  }

  const streakValue = $derived(
    stats.currentWeekStreak === 0
      ? "—"
      : stats.currentWeekStreak === 1
        ? t("vibes.streak.weeks_one")
        : t("vibes.streak.weeks_many", { n: stats.currentWeekStreak }),
  );
  const streakSub = $derived(
    stats.longestWeekStreak > stats.currentWeekStreak
      ? t("vibes.streak.best", { n: stats.longestWeekStreak })
      : t("vibes.streak.on_fire"),
  );
  const lastValue = $derived(
    stats.daysSinceLast == null
      ? "—"
      : stats.daysSinceLast === 0
        ? t("vibes.last_swim.today")
        : t("vibes.last_swim.days_ago", { n: stats.daysSinceLast }),
  );
  const lastSub = $derived(t("vibes.last_swim.total", { n: stats.totalSwims }));
</script>

{#snippet miniCard(icon: Snippet, label: string, value: number)}
  <div class="glass flex flex-col items-start gap-0.5 px-2.5 py-2">
    <div
      class="flex items-center gap-1 text-[9px] font-semibold tracking-wide text-wave-700 uppercase"
    >
      {@render icon()}
      <span class="truncate">{label}</span>
    </div>
    <AnimatedNumber
      {value}
      class="font-display text-xl font-black text-wave-900"
    />
  </div>
{/snippet}

{#snippet vibesMini(icon: Snippet, label: string, value: string, sub?: string)}
  <div class="glass flex flex-col gap-0.5 px-3 py-2.5">
    <div
      class="flex items-center gap-1 text-[10px] font-semibold tracking-wide text-slate-500 uppercase"
    >
      {@render icon()}
      {label}
    </div>
    <div class="font-display text-lg font-black text-wave-900">{value}</div>
    {#if sub}<div class="text-[10px] text-slate-500">{sub}</div>{/if}
  </div>
{/snippet}

<div class="px-4 pt-2 pb-12">
  <div class="mb-5 flex items-center gap-2">
    <button
      onclick={() => history.back()}
      class="rounded-full bg-white/70 p-2 ring-1 ring-slate-200"
      aria-label={t("common.back")}
    >
      <ArrowLeft class="h-4 w-4" />
    </button>
    <h2 class="font-display text-2xl font-black text-wave-900">
      {t("profile.title")}
    </h2>
  </div>

  <!-- Avatar + name -->
  <div class="mb-5 flex flex-col items-center gap-3">
    <button
      onclick={() => (emojiOpen = !emojiOpen)}
      class="flex h-20 w-20 items-center justify-center rounded-full bg-wave-100 text-5xl shadow-md ring-4 ring-white transition-transform active:scale-95"
      aria-label={t("profile.change_emoji")}
      title={t("profile.change_emoji")}
    >
      {profile?.emoji ?? "🌊"}
    </button>

    {#if emojiOpen}
      <div class="glass flex flex-wrap justify-center gap-2 px-4 py-3">
        {#each EMOJI_POOL as e (e)}
          <button
            onclick={() => pickEmoji(e)}
            class={cn(
              "rounded-xl p-1.5 text-3xl transition-transform active:scale-90",
              profile?.emoji === e
                ? "bg-wave-100 ring-2 ring-wave-400"
                : "hover:bg-slate-100",
            )}
          >
            {e}
          </button>
        {/each}
      </div>
    {/if}

    {#if editingName}
      <form onsubmit={saveName} class="flex items-center gap-2">
        <Input
          bind:value={nameInput}
          maxlength={40}
          class="text-center font-display text-lg font-bold"
        />
        <button
          type="submit"
          disabled={busy}
          class="rounded-full bg-wave-600 p-2 text-white shadow disabled:opacity-50"
        >
          <Check class="h-4 w-4" />
        </button>
        <button
          type="button"
          onclick={() => {
            editingName = false;
            nameInput = profile?.displayName ?? "";
          }}
          class="rounded-full bg-white/70 p-2 ring-1 ring-slate-200"
        >
          <X class="h-4 w-4" />
        </button>
      </form>
    {:else}
      <button
        onclick={() => {
          nameInput = profile?.displayName ?? "";
          editingName = true;
        }}
        class="flex items-center gap-1.5 font-display text-2xl font-black text-wave-900"
      >
        {profile?.displayName ?? t("layout.swimmer")}
        <Pencil class="h-4 w-4 text-slate-400" />
      </button>
    {/if}
  </div>

  <!-- Home country -->
  <div class="mb-3 flex items-center justify-center gap-2">
    <span
      class="text-[10px] font-semibold tracking-wide text-slate-500 uppercase"
    >
      {t("profile.home_country")}
    </span>
    <select
      value={profile?.homeCountry ?? ""}
      onchange={(e) => pickHomeCountry(e.currentTarget.value)}
      class="rounded-full border border-slate-200 bg-white/90 px-2.5 py-1 text-xs font-medium text-slate-700 shadow-sm focus:border-wave-400 focus:ring-2 focus:ring-wave-200 focus:outline-none"
    >
      {#if !profile?.homeCountry}
        <option value="" disabled>—</option>
      {/if}
      {#each COUNTRIES as c (c.code)}
        <option value={c.code}>{flagEmoji(c.code)} {c.name}</option>
      {/each}
    </select>
  </div>

  <!-- Language -->
  <div class="mb-4 flex items-center justify-center gap-2">
    <span
      class="text-[10px] font-semibold tracking-wide text-slate-500 uppercase"
    >
      {t("profile.language")}
    </span>
    <div
      class="flex rounded-full bg-white/80 p-0.5 text-[11px] font-bold tracking-wide uppercase shadow-sm ring-1 ring-white/70"
      role="group"
      aria-label="Language"
    >
      <button
        type="button"
        onclick={() => pickLocale("sv")}
        data-active={localeStore.current === "sv"}
        class="rounded-full px-2.5 py-1 text-slate-500 transition data-[active=true]:bg-wave-600 data-[active=true]:text-white"
        aria-pressed={localeStore.current === "sv"}
      >
        SV
      </button>
      <button
        type="button"
        onclick={() => pickLocale("en")}
        data-active={localeStore.current === "en"}
        class="rounded-full px-2.5 py-1 text-slate-500 transition data-[active=true]:bg-wave-600 data-[active=true]:text-white"
        aria-pressed={localeStore.current === "en"}
      >
        EN
      </button>
    </div>
  </div>

  <!-- Stats -->
  <div class="mb-4 grid grid-cols-4 gap-2">
    {#snippet trophyIcon()}<Trophy class="h-3.5 w-3.5" />{/snippet}
    {#snippet flameIcon()}<Flame class="h-3.5 w-3.5" />{/snippet}
    {#snippet pinIcon()}<MapPin class="h-3.5 w-3.5" />{/snippet}
    {#snippet snowIcon()}<Snowflake class="h-3.5 w-3.5" />{/snippet}
    {@render miniCard(
      trophyIcon,
      t("map.stat.points"),
      stats.totalPoints + appStore.achievementBonusPoints,
    )}
    {@render miniCard(flameIcon, t("profile.stat.swims"), stats.totalSwims)}
    {@render miniCard(pinIcon, t("map.stat.spots"), stats.uniquePlaces)}
    {@render miniCard(snowIcon, t("profile.stat.winter"), stats.winterSwims)}
  </div>

  <!-- Shortcuts -->
  {#if stats.totalSwims > 0}
    <div class="mb-4 grid grid-cols-2 gap-2">
      <a
        href="/recap"
        class="glass flex items-center gap-2 bg-gradient-to-br from-amber-50 via-white to-wave-50 p-3"
      >
        <Sparkles class="h-5 w-5 text-amber-500" />
        <div class="min-w-0 flex-1">
          <div
            class="text-[10px] font-semibold tracking-wide text-slate-500 uppercase"
          >
            {t("map.recap.label")}
          </div>
          <div class="font-display text-sm font-bold text-wave-900">
            {t("map.recap.cta", { year: new Date().getFullYear() })}
          </div>
        </div>
      </a>
      <a href="/achievements" class="glass flex items-center gap-2 p-3">
        <Award class="h-5 w-5 text-amber-500" />
        <div class="min-w-0 flex-1">
          <div
            class="text-[10px] font-semibold tracking-wide text-slate-500 uppercase"
          >
            {t("map.achievements.label")}
          </div>
          <div class="font-display text-sm font-bold text-wave-900">
            {t("map.achievements.count", {
              n: appStore.unlockedAchievements.size,
              total: ACHIEVEMENTS.length,
            })}
          </div>
        </div>
      </a>
    </div>
  {/if}

  <a href="/history" class="glass mb-4 flex items-center gap-2 p-3">
    <HistoryIcon class="h-5 w-5 text-wave-700" />
    <div class="min-w-0 flex-1">
      <div
        class="text-[10px] font-semibold tracking-wide text-slate-500 uppercase"
      >
        {t("nav.history")}
      </div>
      <div class="font-display text-sm font-bold text-wave-900">
        {t("profile.history_cta")}
      </div>
    </div>
    <ChevronRight class="h-4 w-4 text-slate-400" />
  </a>

  <!-- Vibes -->
  {#if stats.totalSwims > 0}
    <div class="space-y-2">
      <h3 class="text-xs font-semibold tracking-wide text-slate-500 uppercase">
        {t("vibes.title")}
      </h3>

      <div class="grid grid-cols-2 gap-2">
        {#snippet flameAmber()}<Flame
            class="h-4 w-4 text-amber-500"
          />{/snippet}
        {#snippet clockWave()}<Clock class="h-4 w-4 text-wave-600" />{/snippet}
        {@render vibesMini(
          flameAmber,
          t("vibes.streak"),
          streakValue,
          streakSub,
        )}
        {@render vibesMini(clockWave, t("vibes.last_swim"), lastValue, lastSub)}
      </div>

      {#if stats.favouriteSpot}
        <a
          href={`/spot/${stats.favouriteSpot.placeId}`}
          class="glass flex items-center gap-3 p-3"
        >
          <Star class="h-5 w-5 text-amber-500" />
          <div class="min-w-0 flex-1">
            <div
              class="text-[10px] font-semibold tracking-wide text-slate-500 uppercase"
            >
              {t("vibes.fav_spot")}
            </div>
            <div
              class="truncate font-display text-base font-bold text-wave-900"
            >
              {stats.favouriteSpot.name}
            </div>
          </div>
          <div class="font-display text-xl font-black text-wave-700">
            {stats.favouriteSpot.count}
          </div>
        </a>
      {/if}

      {#if stats.range}
        <div class="glass flex items-center gap-3 p-3">
          <Compass class="h-5 w-5 text-wave-600" />
          <div class="min-w-0 flex-1">
            <div
              class="text-[10px] font-semibold tracking-wide text-slate-500 uppercase"
            >
              {t("vibes.range")}
            </div>
            <div class="text-sm text-wave-900">
              {t("vibes.range.spans", { n: stats.range.km.toFixed(1) })}
            </div>
          </div>
        </div>
      {/if}

      {#if stats.bestMonth}
        <div class="glass flex items-center gap-3 p-3">
          <CalendarHeart class="h-5 w-5 text-rose-500" />
          <div class="min-w-0 flex-1">
            <div
              class="text-[10px] font-semibold tracking-wide text-slate-500 uppercase"
            >
              {t("vibes.best_month")}
            </div>
            <div class="text-sm text-wave-900">
              {t("vibes.best_month.value", {
                month: monthShort(stats.bestMonth.month),
                n: stats.bestMonth.points,
              })}
            </div>
          </div>
        </div>
      {/if}

      {#if stats.onThisDay}
        <a
          href={`/spot/${stats.onThisDay.placeId}`}
          class="glass flex items-start gap-3 bg-gradient-to-br from-wave-50 to-white p-3"
        >
          <span class="text-2xl">🗓️</span>
          <div class="min-w-0 flex-1">
            <div
              class="text-[10px] font-semibold tracking-wide text-wave-700 uppercase"
            >
              {t("vibes.on_this_day")}
            </div>
            <div class="text-sm text-wave-900">
              {t("vibes.on_this_day.text", {
                place: stats.onThisDay.placeName,
                date: formatDate(stats.onThisDay.date),
              })}{stats.onThisDay.isWinter ? " ❄️" : ""}
            </div>
          </div>
        </a>
      {/if}
    </div>
  {/if}

  <!-- About + sign out -->
  <div class="mt-8 space-y-2">
    <a
      href="/about"
      class="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white/70 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-white"
    >
      <Info class="h-4 w-4" />
      {t("about.title")}
    </a>
    <button
      type="button"
      onclick={() => authStore.logout()}
      class="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white/70 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-white"
    >
      <LogOut class="h-4 w-4" />
      {t("layout.log_out")}
    </button>
  </div>

  <!-- Danger zone -->
  <div class="mt-6 border-t border-rose-100 pt-4">
    <h3
      class="mb-2 text-xs font-semibold tracking-wide text-rose-500 uppercase"
    >
      {t("profile.danger.title")}
    </h3>
    {#if !confirmDelete}
      <button
        type="button"
        onclick={() => (confirmDelete = true)}
        class="flex w-full items-center justify-center gap-2 rounded-xl border border-rose-200 bg-white/70 px-3 py-2 text-sm font-semibold text-rose-600 transition hover:bg-rose-50"
      >
        <Trash2 class="h-4 w-4" />
        {t("profile.delete.button")}
      </button>
    {:else}
      <div class="rounded-xl border border-rose-200 bg-rose-50/80 p-3">
        <p class="mb-3 text-sm leading-snug text-rose-800">
          {t("profile.delete.confirm")}
        </p>
        <div class="flex gap-2">
          <button
            type="button"
            onclick={() => (confirmDelete = false)}
            disabled={deleting}
            class="flex-1 rounded-xl bg-white px-3 py-2 text-sm font-semibold text-slate-700 ring-1 ring-slate-200 disabled:opacity-50"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onclick={onDeleteAccount}
            disabled={deleting}
            class="flex-1 rounded-xl bg-rose-600 px-3 py-2 text-sm font-bold text-white shadow disabled:opacity-50"
          >
            {deleting
              ? t("profile.delete.deleting")
              : t("profile.delete.confirm_button")}
          </button>
        </div>
      </div>
    {/if}
  </div>
</div>
