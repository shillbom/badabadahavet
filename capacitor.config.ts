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
    // We use the native Firebase Authentication plugin only to open the
    // native account picker and obtain a credential. Sign-in itself is
    // then performed with the Firebase JS SDK (via signInWithCredential)
    // so the rest of the app — which already listens to JS auth state —
    // keeps working unchanged. `skipNativeAuth: true` stops the plugin
    // from also signing into the native Firebase SDK (which we don't use).
    FirebaseAuthentication: {
      skipNativeAuth: true,
      providers: ["google.com"],
    },
  },
};

export default config;
