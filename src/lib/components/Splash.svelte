<!-- Full-screen loading splash. framer-motion's pulsing rings + bob are
     reproduced with CSS keyframes (bob lives in app.css). -->
<div class="flex min-h-[100dvh] flex-col items-center justify-center gap-3">
  <div class="relative h-20 w-20">
    {#each [0, 1, 2] as i (i)}
      <span
        class="splash-ring absolute inset-0 rounded-full border-2 border-wave-400"
        style="animation-delay: {i * 0.4}s"
      ></span>
    {/each}
    <img
      src="/web-app-manifest-192x192.png"
      alt="Badligan"
      class="absolute inset-0 h-full w-full animate-bob rounded-full object-cover"
    />
  </div>
  <div
    class="font-display text-sm font-bold tracking-widest text-wave-700 uppercase"
  >
    Badligan
  </div>
</div>

<style>
  .splash-ring {
    animation: splash-pulse 1.6s ease-out infinite;
  }
  @keyframes splash-pulse {
    0% {
      transform: scale(0.5);
      opacity: 0.5;
    }
    100% {
      transform: scale(1.6);
      opacity: 0;
    }
  }
</style>
