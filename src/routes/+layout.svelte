<script lang="ts">
  import "@/app.css";
  import { onMount } from "svelte";
  import { authStore } from "@/lib/stores/auth.svelte";
  import { appStore } from "@/lib/stores/app.svelte";
  import Toaster from "@/lib/components/Toast.svelte";
  import FullSplash from "@/lib/components/Splash.svelte";

  let { children } = $props();

  // Boot the Firebase auth listener + data subscriptions once for the app's
  // lifetime (replaces App.tsx's useEffect(() => useStore.getState()._startListening())).
  onMount(() => {
    const stopAuth = authStore.init();
    const stopApp = appStore.start();
    return () => {
      stopApp();
      stopAuth();
    };
  });

  // While Firebase Auth and the Firestore user doc are still hydrating we
  // show the splash instead of a half-populated UI.
  const gating = $derived(
    (authStore.loading || (!!authStore.user && !authStore.profile)) &&
      !authStore.googleOnboarding,
  );
</script>

<Toaster />

{#if gating}
  <FullSplash />
{:else}
  {@render children()}
{/if}
