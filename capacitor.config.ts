import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "se.badligan.app",
  appName: "Badligan",
  webDir: "dist",
  // The bundled HTML/JS lives inside the binary; Capacitor serves it
  // from capacitor://localhost (iOS) or https://localhost (Android).
  server: {
    androidScheme: "https",
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 800,
      launchAutoHide: true,
      backgroundColor: "#e0f2fe",
      androidSplashResourceName: "splash",
      showSpinner: false,
    },
  },
};

export default config;
