<script module lang="ts">
  import { getRedirectResult } from "firebase/auth";
  import { auth } from "@/lib/firebase";

  // Firebase requires getRedirectResult to run while the page is still
  // loading, so kick it off at module-evaluation time (client-only; the
  // app is ssr:false).
  const redirectResultPromise = getRedirectResult(auth).catch((e) => {
    console.error(e);
    return null;
  });
</script>

<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { toast } from "@/lib/stores/toast.svelte";
  import { t } from "@/lib/i18n";
  import { consumeReturnPath } from "@/lib/utils";
  import FullSplash from "@/lib/components/Splash.svelte";

  onMount(async () => {
    const result = await redirectResultPromise;
    if (result === null) toast.error(t("auth.error.google_cancelled"));
    // Navigate to the preserved deep link (or "/") regardless — the auth
    // listener handles routing if the user isn't authed yet.
    goto(consumeReturnPath(), { replaceState: true });
  });
</script>

<FullSplash />
