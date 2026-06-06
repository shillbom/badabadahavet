<script lang="ts">
  import { onMount } from "svelte";
  import { fade, scale } from "svelte/transition";
  import { goto } from "$app/navigation";
  import {
    Globe,
    Info,
    Lock,
    Mail,
    Sparkles,
    User,
    Waves,
    X,
  } from "@lucide/svelte";
  import { authStore } from "@/lib/stores/auth.svelte";
  import Button from "@/lib/components/ui/Button.svelte";
  import Input from "@/lib/components/ui/Input.svelte";
  import Label from "@/lib/components/ui/Label.svelte";
  import { toast } from "@/lib/stores/toast.svelte";
  import { localeStore } from "@/lib/stores/locale.svelte";
  import { t } from "@/lib/i18n";
  import LanguageSwitcher from "@/lib/components/LanguageSwitcher.svelte";
  import {
    COUNTRIES,
    detectBrowserCountry,
    flagEmoji,
    pickerCodeFor,
  } from "@/lib/countries";
  import { reverseGeocodeCountry } from "@/lib/geocode";
  import { consumeReturnPath } from "@/lib/utils";

  let mode = $state<"login" | "signup">("login");
  let email = $state("");
  let displayName = $state("");
  let password = $state("");
  let busy = $state(false);
  let homeCountry = $state(pickerCodeFor(detectBrowserCountry()));
  let homeCountryTouched = $state(false);
  let acceptedTerms = $state(false);
  let termsOpen = $state(false);

  function setHomeCountry(code: string, fromUser: boolean) {
    homeCountry = code;
    if (fromUser) homeCountryTouched = true;
    // Auto-pair the locale: SE → Swedish, anything else → English.
    localeStore.set(code === "SE" ? "sv" : "en");
  }

  // An already-authed visitor (not mid-onboarding) belongs on the map.
  // `busy` guard keeps submit()'s own redirect from being clobbered.
  $effect(() => {
    if (authStore.user && !authStore.googleOnboarding && !busy) goto("/");
  });

  // Pre-fill display name from the Google account when entering onboarding.
  $effect(() => {
    if (
      authStore.googleOnboarding &&
      authStore.user?.displayName &&
      !displayName
    ) {
      displayName = authStore.user.displayName;
    }
  });

  // Ask for geolocation on mount so we can flip the UI to the user's likely
  // language before they touch the form. Manual changes still win.
  onMount(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    let cancelled = false;
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const real = await reverseGeocodeCountry(
          pos.coords.latitude,
          pos.coords.longitude,
        );
        if (cancelled || homeCountryTouched) return;
        setHomeCountry(pickerCodeFor(real), false);
      },
      () => {},
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 5 * 60 * 1000 },
    );
    return () => {
      cancelled = true;
    };
  });

  function prettyAuthError(msg: string): string {
    if (msg.includes("invalid-credential") || msg.includes("wrong-password"))
      return t("auth.error.wrong_credentials");
    if (msg.includes("user-not-found")) return t("auth.error.user_not_found");
    if (msg.includes("email-already-in-use")) return t("auth.error.taken");
    if (msg.includes("weak-password")) return t("auth.error.weak_password");
    if (msg.includes("invalid-email")) return t("auth.error.email_invalid");
    return t("auth.error.generic");
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !trimmedEmail.includes("@")) {
      toast.error(t("auth.error.email_invalid"));
      return;
    }
    if (password.length < 6) {
      toast.error(t("auth.error.weak_password"));
      return;
    }
    if (mode === "signup" && !displayName.trim()) {
      toast.error(t("auth.error.name_required"));
      return;
    }
    if (mode === "signup" && !acceptedTerms) {
      toast.error(t("auth.error.terms_required"));
      return;
    }
    busy = true;
    try {
      if (mode === "signup") {
        await authStore.signup(
          trimmedEmail,
          password,
          displayName,
          homeCountry,
        );
        toast.success(t("auth.welcome", { name: displayName.trim() }));
      } else {
        await authStore.login(trimmedEmail, password);
        toast.success(t("auth.hello_again"));
      }
      goto(consumeReturnPath(), { replaceState: true });
    } catch (err) {
      toast.error(prettyAuthError((err as Error).message ?? ""));
    } finally {
      busy = false;
    }
  }

  async function onGoogleSignIn() {
    busy = true;
    try {
      authStore.loginWithGoogle();
      // Page navigates away — busy stays set intentionally.
    } catch (err) {
      toast.error(prettyAuthError((err as Error).message ?? ""));
      busy = false;
    }
  }

  async function onCompleteOnboarding(e: SubmitEvent) {
    e.preventDefault();
    if (!acceptedTerms) {
      toast.error(t("auth.error.terms_required"));
      return;
    }
    busy = true;
    try {
      await authStore.completeGoogleOnboarding(displayName, homeCountry);
      toast.success(
        t("auth.welcome", {
          name: displayName.trim() || authStore.user?.displayName || "",
        }),
      );
      goto(consumeReturnPath(), { replaceState: true });
    } catch (err) {
      toast.error(prettyAuthError((err as Error).message ?? ""));
    } finally {
      busy = false;
    }
  }

  async function onForgot() {
    const trimmed = email.trim();
    if (!trimmed || !trimmed.includes("@")) {
      toast.error(t("auth.error.email_invalid"));
      return;
    }
    try {
      await authStore.resetPassword(trimmed);
      toast.success(t("auth.reset_sent"));
    } catch (err) {
      toast.error(prettyAuthError((err as Error).message ?? ""));
    }
  }

  function browseAsGuest() {
    try {
      sessionStorage.removeItem("login.returnTo");
    } catch {
      /* ignore */
    }
    goto("/");
  }

  function acceptTerms() {
    acceptedTerms = true;
    termsOpen = false;
  }
</script>

<div
  class="relative flex min-h-[100dvh] flex-col items-center justify-center px-5 py-10"
>
  <!-- Ripples -->
  <div class="pointer-events-none absolute inset-0 overflow-hidden">
    {#each [0, 1, 2] as i (i)}
      <span
        class="absolute top-1/3 left-1/2 h-40 w-40 -translate-x-1/2 -translate-y-1/2 animate-ripple rounded-full border border-wave-300/60"
        style="animation-delay: {i * 0.6}s"
      ></span>
    {/each}
  </div>

  <div
    class="absolute top-[max(env(safe-area-inset-top),0.75rem)] right-3 z-10 flex items-center gap-2"
  >
    <button
      type="button"
      onclick={() => goto("/about")}
      class="flex h-9 w-9 items-center justify-center rounded-full bg-white/70 text-wave-700 ring-1 ring-wave-200 backdrop-blur-sm hover:bg-white"
      aria-label={t("nav.about")}
    >
      <Info class="h-4 w-4" />
    </button>
    <LanguageSwitcher />
  </div>

  <div class="z-10 flex flex-col items-center">
    <img
      src="/web-app-manifest-192x192.png"
      alt="Badligan"
      width="80"
      height="80"
      class="mb-3 h-20 w-20 animate-bob rounded-2xl shadow-lg shadow-wave-700/30"
    />
    <h1 class="font-display text-4xl font-black text-wave-900">
      {t("app.name")}
    </h1>
    <p class="mt-1 text-sm text-wave-700">
      {authStore.googleOnboarding
        ? t("auth.google.onboarding.title")
        : t("app.tagline")}
    </p>
  </div>

  {#if authStore.googleOnboarding}
    <form
      onsubmit={onCompleteOnboarding}
      class="glass z-10 mt-8 w-full max-w-sm space-y-4 p-5"
    >
      <div class="space-y-1.5">
        <Label for="ob-name">
          <span class="inline-flex items-center gap-1.5">
            <User class="h-3.5 w-3.5" />
            {t("auth.google.onboarding.name")}
          </span>
        </Label>
        <Input
          id="ob-name"
          autocomplete="nickname"
          placeholder={t("auth.handle_placeholder")}
          bind:value={displayName}
        />
      </div>

      <div class="space-y-1.5">
        <Label for="ob-country">
          <span class="inline-flex items-center gap-1.5">
            <Globe class="h-3.5 w-3.5" />
            {t("auth.home_country")}
          </span>
        </Label>
        <select
          id="ob-country"
          value={homeCountry}
          onchange={(e) => setHomeCountry(e.currentTarget.value, true)}
          class="w-full rounded-xl border border-slate-200 bg-white/90 px-3 py-2 text-sm shadow-sm focus:border-wave-400 focus:ring-2 focus:ring-wave-200 focus:outline-none"
        >
          {#each COUNTRIES as c (c.code)}
            <option value={c.code}>{flagEmoji(c.code)} {c.name}</option>
          {/each}
        </select>
        <p class="text-[11px] text-slate-500">
          {t("auth.google.onboarding.hint")}
        </p>
      </div>

      <label class="flex items-start gap-2 text-[12px] text-slate-600">
        <input
          type="checkbox"
          bind:checked={acceptedTerms}
          class="mt-0.5 h-4 w-4 flex-none rounded border-slate-300 text-wave-600 focus:ring-wave-400"
        />
        <span>
          {t("auth.terms.prefix")}
          <button
            type="button"
            onclick={() => (termsOpen = true)}
            class="font-semibold text-wave-700 underline hover:text-wave-800"
          >
            {t("auth.terms.link")}
          </button>.
        </span>
      </label>

      <Button
        type="submit"
        loading={busy}
        size="lg"
        class="w-full"
        disabled={!acceptedTerms}
      >
        {t("auth.google.onboarding.submit")}
        <Sparkles class="h-4 w-4" />
      </Button>
    </form>
  {:else}
    <form
      onsubmit={submit}
      class="glass z-10 mt-8 w-full max-w-sm space-y-4 p-5"
    >
      <div class="flex rounded-full bg-slate-100 p-1">
        <button
          type="button"
          data-active={mode === "login"}
          onclick={() => (mode = "login")}
          class="pill-tab"
        >
          {t("auth.login")}
        </button>
        <button
          type="button"
          data-active={mode === "signup"}
          onclick={() => (mode = "signup")}
          class="pill-tab"
        >
          {t("auth.signup")}
        </button>
      </div>

      <div class="space-y-1.5">
        <Label for="email">
          <span class="inline-flex items-center gap-1.5">
            <Mail class="h-3.5 w-3.5" />
            {t("auth.email")}
          </span>
        </Label>
        <Input
          id="email"
          type="email"
          autocomplete="email"
          placeholder={t("auth.email_placeholder")}
          bind:value={email}
        />
      </div>

      {#if mode === "signup"}
        <div class="space-y-1.5">
          <Label for="name">
            <span class="inline-flex items-center gap-1.5">
              <User class="h-3.5 w-3.5" />
              {t("auth.name")}
            </span>
          </Label>
          <Input
            id="name"
            autocomplete="nickname"
            placeholder={t("auth.handle_placeholder")}
            bind:value={displayName}
          />
        </div>
        <div class="space-y-1.5">
          <Label for="home-country">
            <span class="inline-flex items-center gap-1.5">
              <Globe class="h-3.5 w-3.5" />
              {t("auth.home_country")}
            </span>
          </Label>
          <select
            id="home-country"
            value={homeCountry}
            onchange={(e) => setHomeCountry(e.currentTarget.value, true)}
            class="w-full rounded-xl border border-slate-200 bg-white/90 px-3 py-2 text-sm shadow-sm focus:border-wave-400 focus:ring-2 focus:ring-wave-200 focus:outline-none"
          >
            {#each COUNTRIES as c (c.code)}
              <option value={c.code}>{flagEmoji(c.code)} {c.name}</option>
            {/each}
          </select>
          <p class="text-[11px] text-slate-500">
            {t("auth.home_country.hint")}
          </p>
        </div>
      {/if}

      <div class="space-y-1.5">
        <Label for="password">
          <span class="inline-flex items-center gap-1.5">
            <Lock class="h-3.5 w-3.5" />
            {t("auth.password")}
          </span>
        </Label>
        <Input
          id="password"
          type="password"
          autocomplete={mode === "signup" ? "new-password" : "current-password"}
          placeholder={t("auth.password_placeholder")}
          bind:value={password}
        />
      </div>

      {#if mode === "signup"}
        <label class="flex items-start gap-2 text-[12px] text-slate-600">
          <input
            type="checkbox"
            bind:checked={acceptedTerms}
            class="mt-0.5 h-4 w-4 flex-none rounded border-slate-300 text-wave-600 focus:ring-wave-400"
          />
          <span>
            {t("auth.terms.prefix")}
            <button
              type="button"
              onclick={() => (termsOpen = true)}
              class="font-semibold text-wave-700 underline hover:text-wave-800"
            >
              {t("auth.terms.link")}
            </button>.
          </span>
        </label>
      {/if}

      <Button
        type="submit"
        loading={busy}
        size="lg"
        class="w-full"
        disabled={mode === "signup" && !acceptedTerms}
      >
        {mode === "signup" ? t("auth.create_account") : t("auth.dive_in")}
        {#if mode === "signup"}
          <Sparkles class="h-4 w-4" />
        {:else}
          <Waves class="h-4 w-4" />
        {/if}
      </Button>

      {#if mode === "login"}
        <button
          type="button"
          onclick={onForgot}
          class="block w-full text-center text-[11px] font-semibold text-wave-700 hover:underline"
        >
          {t("auth.forgot")}
        </button>
      {:else}
        <p
          class="rounded-xl bg-wave-50 px-3 py-2 text-center text-[11px] leading-snug text-wave-800 ring-1 ring-wave-200"
        >
          🔒 {t("auth.privacy_note")}
        </p>
      {/if}

      <div class="flex items-center gap-2">
        <div class="h-px flex-1 bg-slate-200"></div>
        <span class="text-[11px] text-slate-400"
          >{t("auth.google.divider")}</span
        >
        <div class="h-px flex-1 bg-slate-200"></div>
      </div>

      <button
        type="button"
        onclick={onGoogleSignIn}
        disabled={busy}
        class="flex w-full items-center justify-center gap-2.5 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 active:bg-slate-100 disabled:opacity-50"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
          <path
            d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z"
            fill="#4285F4"
          />
          <path
            d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z"
            fill="#34A853"
          />
          <path
            d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332Z"
            fill="#FBBC05"
          />
          <path
            d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.163 6.656 3.58 9 3.58Z"
            fill="#EA4335"
          />
        </svg>
        {t("auth.google")}
      </button>

      <button
        type="button"
        onclick={browseAsGuest}
        class="block w-full text-center text-[12px] font-semibold text-wave-700 hover:underline"
      >
        {t("auth.browse_as_guest")}
      </button>
    </form>
  {/if}

  {#if termsOpen}
    <div
      transition:fade={{ duration: 150 }}
      onclick={() => (termsOpen = false)}
      onkeydown={(e) => e.key === "Escape" && (termsOpen = false)}
      role="presentation"
      class="fixed inset-0 z-[2000] flex items-center justify-center bg-slate-900/50 px-4 backdrop-blur-sm"
    >
      <div
        transition:scale={{ duration: 200, start: 0.97 }}
        onclick={(e) => e.stopPropagation()}
        onkeydown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        tabindex="-1"
        class="relative w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        <div
          class="flex items-center justify-between border-b border-slate-200 px-4 py-3"
        >
          <h3 class="font-display text-lg font-bold text-wave-900">
            {t("terms.title")}
          </h3>
          <button
            type="button"
            onclick={() => (termsOpen = false)}
            class="rounded-full p-1.5 text-slate-500 hover:bg-slate-100"
            aria-label={t("common.close")}
          >
            <X class="h-4 w-4" />
          </button>
        </div>
        <div
          class="max-h-[60vh] overflow-y-auto px-4 py-3 text-sm leading-relaxed text-slate-700"
        >
          <p class="mb-3">{t("terms.intro")}</p>
          <ul class="list-disc space-y-2 pl-5">
            <li>{t("terms.cookies")}</li>
            <li>{t("terms.email")}</li>
            <li>{t("terms.storage")}</li>
            <li>{t("terms.data")}</li>
            <li>{t("terms.content")}</li>
            <li>{t("terms.safety")}</li>
            <li>{t("terms.delete")}</li>
            <li>{t("terms.fun")}</li>
          </ul>
        </div>
        <div class="border-t border-slate-200 px-4 py-3">
          <button
            type="button"
            onclick={acceptTerms}
            class="w-full rounded-xl bg-wave-600 px-3 py-2 text-sm font-bold text-white shadow hover:bg-wave-700"
          >
            {t("terms.accept")}
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>
