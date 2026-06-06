<script lang="ts">
  import ComingSoon from "@/lib/components/ComingSoon.svelte";
  import { page } from "$app/state";
</script>

<ComingSoon title={`Spot · ${page.params.placeId}`} />
