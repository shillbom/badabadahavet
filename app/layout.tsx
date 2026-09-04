import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "@/index.css";

const SITE = "https://badligan.club";
const TITLE = "Badligan – logga bad, samla badplatser och tävla med vänner";
const SHARE_TITLE = "Badligan – en liten, vänlig badtävling";
const DESCRIPTION =
  "Badligan är en liten, vänlig badtävling. Logga dina bad, samla badplatser på kartan, lås upp utmärkelser och tävla med vänner om poäng.";
const SHARE_DESCRIPTION =
  "Logga dina bad, samla badplatser på kartan, lås upp utmärkelser och tävla med vänner om poäng.";
const SHARE_IMAGE = `${SITE}/web-app-manifest-512x512.png`;

/**
 * SEO + social sharing tags are emitted server-side on purpose: link-preview
 * scrapers — Messenger, WhatsApp, Slack, LinkedIn, X — do not run our JS, so
 * anything set client-side would be invisible to them. Per-place tags for
 * `/spot/[placeId]` come from that route's own `generateMetadata`.
 */
export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: TITLE,
  description: DESCRIPTION,
  applicationName: "Badligan",
  alternates: { canonical: "/" },
  robots: { index: true, follow: true },
  formatDetection: {
    telephone: false,
    date: false,
    email: false,
    address: false,
  },
  // Emits both `mobile-web-app-capable` and the apple-prefixed variants.
  appleWebApp: {
    capable: true,
    title: "Badligan",
    // `default` (not black-translucent): Badligan is a light app, so we want
    // DARK status-bar text over our light background. black-translucent forces
    // WHITE text (unreadable here) and floats the document up under the status
    // bar, which also produced the pale bar at the bottom. `default` keeps the
    // content below the status bar and lets the light theme-color tint it.
    // viewport-fit=cover + the safe-area paddings still fill the screen.
    statusBarStyle: "default",
  },
  openGraph: {
    type: "website",
    siteName: "Badligan",
    title: SHARE_TITLE,
    description: SHARE_DESCRIPTION,
    url: SITE,
    locale: "sv_SE",
    alternateLocale: ["en_GB"],
    images: [
      {
        url: SHARE_IMAGE,
        type: "image/png",
        width: 512,
        height: 512,
        alt: "Badligans logotyp",
      },
    ],
  },
  twitter: {
    // `summary` (not summary_large_image) because the share image is a square
    // logo, not a 1200×630 banner. Swap to a wide banner +
    // summary_large_image if a dedicated OG image is added later.
    card: "summary",
    title: SHARE_TITLE,
    description: SHARE_DESCRIPTION,
    images: [SHARE_IMAGE],
  },
  // Favicons live in public/. The 5 MB SVG export isn't linked — raster PNGs
  // are cheaper at every size the browser uses and the SVG just bakes a
  // bitmap inside anyway.
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "32x32" },
      { url: "/favicon-96x96.png", type: "image/png", sizes: "96x96" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  // Status-bar / browser-UI tint. Badligan has no dark theme — the UI is
  // always light blue — so we pin theme-color to the app's top colour in BOTH
  // colour schemes. Without the dark-scheme entry iOS/Safari darkens the
  // single value in dark mode, which is what turned the status bar grey. Keep
  // light and dark identical so it always matches the app.
  themeColor: [
    { color: "#eff9ff" },
    { media: "(prefers-color-scheme: light)", color: "#eff9ff" },
    { media: "(prefers-color-scheme: dark)", color: "#eff9ff" },
  ],
};

/** Structured data: lets Google render a richer result for the app. */
const JSON_LD = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "Badligan",
  url: `${SITE}/`,
  description:
    "En liten, vänlig badtävling: logga dina bad, samla badplatser på kartan, lås upp utmärkelser och tävla med vänner om poäng.",
  applicationCategory: "SportsApplication",
  operatingSystem: "Web, iOS, Android",
  inLanguage: ["sv", "en"],
  offers: { "@type": "Offer", price: "0", priceCurrency: "SEK" },
  author: { "@type": "Person", name: "Simon Hillbom" },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="sv">
      <head>
        {/* Warm up the connections the app needs the instant it boots.
            preconnect opens DNS/TLS early so the first auth/Firestore request
            doesn't pay handshake latency on the critical path. */}
        <link rel="preconnect" href="https://identitytoolkit.googleapis.com" />
        <link rel="preconnect" href="https://securetoken.googleapis.com" />
        <link rel="preconnect" href="https://firestore.googleapis.com" />
        {/* Map tiles load only after sign-in, so a lighter hint is enough. */}
        <link rel="dns-prefetch" href="https://a.tile.openstreetmap.org" />
        {/* Preload the self-hosted splash wordmark font so it is ready at
            first paint. The remaining font files are discovered from CSS. */}
        <link
          rel="preload"
          as="font"
          type="font/woff2"
          crossOrigin=""
          href="/fonts/caveat-brush-latin.woff2"
        />
        {/* First-paint background matching the splash. The animated splash
            itself is rendered by React (components/Splash.tsx) — this just
            avoids a bare flash before the bundle mounts. Unlayered on purpose
            so Tailwind's layered reset can't override it. NOTE: `html` height
            must match the shell's 100dvh — never -webkit-fill-available,
            which caused the iOS "unfilled screen until scroll" PWA bug. */}
        <style id="first-paint">{`body{margin:0}html{background:linear-gradient(180deg,#eff9ff 0%,#def1ff 46%,#b6e4ff 100%)}`}</style>
        {/* Publish the real viewport height as --app-height before first
            paint, so the shell isn't sized by iOS's lying launch viewport.
            beforeInteractive (not the client bundle) because hydration
            happens far too late — see src/lib/appHeight.ts for the full
            story; the resize/orientation/pageshow listeners it installs are
            attached from ClientShell once the app mounts. */}
        <Script id="app-height" strategy="beforeInteractive">
          {`(function(){var h=Math.round(window.innerHeight);if(h>0)document.documentElement.style.setProperty("--app-height",h+"px")})()`}
        </Script>
        <Script
          id="ld-json"
          type="application/ld+json"
          strategy="beforeInteractive"
        >
          {JSON.stringify(JSON_LD)}
        </Script>
      </head>
      <body className="bg-sky-50">{children}</body>
    </html>
  );
}
