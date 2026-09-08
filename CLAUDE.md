# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Badligan is a mobile-first Next.js + Firebase app where friends log swims,
claim spots on a map, and compete on points. See README.md for features,
scoring rules, deploy/CI, seeding scripts, and the admin flag; this file covers
how to work in the code.

## Commands

```bash
npm run dev            # Next dev server (Turbopack) on :3000
npm run build          # next build (also what CI runs) — runs tsc as part of it
npm start              # serve the production build (the only way to see ISR caching)
npm run lint           # oxlint (Rust linter, config in .oxlintrc.json)
npm run typecheck      # tsc -b --noEmit — the TypeScript 7 native compiler (tsgo)
npm test               # vitest run (all tests)
npx vitest run src/lib/streak.test.ts        # single test file
npx vitest run -t "buoy"                     # tests matching a name
npm run format         # prettier --write .
```

Local dev can run against the Firebase emulators (requires Java 11+ and the
`firebase-tools` CLI, which is **not** in devDependencies):

```bash
cp .env.example .env.local      # points at the emulators
firebase emulators:start        # auth/firestore/storage + UI at :4000
npm run dev                     # separate terminal
```

Pointing `.env.local` at the real project instead also works, and is how the
server-rendered pages get realistic data. Either way the **server** half needs
credentials of its own: `firebase-admin` uses Application Default Credentials,
so set `GOOGLE_APPLICATION_CREDENTIALS=./service-account.json` (the same
git-ignored file the maintenance scripts use) when not on the emulators. On App
Hosting the runtime service account is picked up automatically.

The pre-commit hook (husky + lint-staged) runs `prettier --check`, `oxlint`,
and `tsc -b --noEmit` on staged files and **rejects the commit** on any
formatting drift or lint/type error — run `npx prettier --write <files>` before
committing. Prettier uses `prettier-plugin-tailwindcss`, so class order in
`className` is enforced too.

Linting is [oxlint](https://oxc.rs), not eslint: typescript-eslint needs the
classic TypeScript compiler API, which the TS 7 native port (tsgo) doesn't
expose, so type-aware rules (e.g. `no-deprecated`) aren't available. oxlint is
config-light and type-unaware; errors block, warnings advise. Tune rules in
`.oxlintrc.json`.

## Architecture

### Where things live

`app/` is the App Router tree and holds routing only: each `page.tsx` is a
thin wrapper around a component in `src/views/`, so the views stay
framework-shaped rather than route-shaped. The chrome (top bar, content
column, FAB, bottom nav) is `src/components/Layout.tsx`, mounted by
`app/(app)/layout.tsx` for everything in the `(app)` group; `/login` and
`/auth/google` sit outside that group on purpose. `app/AppBoot.tsx` is the one
client shell for every route — store boot, the boot/splash gate and the global
overlays. `src/server/` is server-only code (never import it from a client
component): the `firebase-admin` handle, the moved scoring/leaderboard/
moderation logic as plain ESM `.js`, and the reads behind the server-rendered
pages.

### One store, one derive pass

`src/store/sessions.ts` is the single Zustand store: auth state, Firestore
subscriptions, and all derived data. `app/AppBoot.tsx` calls
`_startListening()` once at boot, which chains Firebase Auth → per-user
listeners (profile doc, own sessions, groups) and the public summary
listeners. Whenever raw data changes, `derive()` recomputes every derived
value (stats, `sessionsByPlace`, achievements, `myPlaces`…) in one pass and
writes it back to the store — components read precomputed state via selectors
and should **not** re-derive in `useMemo`. If you add derived data, add it to
`derive()`.

### What is server-rendered, and what must not be

Only the public routes are: `/spot/[placeId]` (the reason the app moved to
Next), the `/` landing shell, `/about`, `/privacy`, `/leaderboard`,
`/sitemap.xml` and `/robots.txt`.

The authed routes (`/log`, `/history`, `/profile`, `/groups`, `/swim/*/edit`,
`/recap`, `/achievements`, `/streak`, `/admin`) deliberately render **nothing**
on the server. They sit behind `RequireAuth`, which renders `null` until
Firebase Auth has resolved — which on the server is never. That is the whole
mechanism: auth lives only in the browser (no session cookie), the Firestore
client SDK's persistent IndexedDB cache is what makes a returning visit cheap,
and the server gets none of it. SSR there would add reads and cold starts for
nothing. Don't "fix" it by fetching user data server-side.

`AppBoot` keeps `children` mounted from the very first render — it used to
gate them on `booting`, which made the server emit an empty shell — and the
opaque boot splash covers them until boot finishes. So anything rendered at
route level must survive being rendered with `loading: true`, no `user` and no
`profile`, on the server. Two consequences worth knowing: never reach for
`window`/`document` while rendering (see the guard in
`src/components/Lightbox.tsx` for what that costs), and never call
`useSearchParams()` in a subtree that must be server-rendered — it opts that
subtree out of SSR up to the nearest `<Suspense>` (`SpotPage` reads
`?session=` from `window.location` in an effect for exactly this reason).

### The spot page is the SEO surface

`app/(app)/spot/[placeId]/page.tsx` is a server component. It reads four
bounded things via `src/server/spotData.ts` (place doc, aggregate swim count,
the newest 25 swims, the `tempSummary/current` entry — the same reads the old
`spotPreview` Cloud Function made), emits the per-place OG/Twitter/canonical
tags from `generateMetadata`, and hands the same data to the client view as
`initial`. `SpotView` renders identical markup from those props on the server
and on its first client render, so the HTML is real content and hydration
matches without any of the UI being duplicated — then the live listeners take
over. `SpotSheet` renders the same component with no `initial`.

Caching is what keeps this cheap: `revalidate = 3600` plus a
`generateStaticParams` returning `[]` (without it Next treats the route as
fully dynamic and re-reads Firestore on every request). `/api/logSession`,
`/api/removeSession` and `/api/setPlaceInfo` call
`revalidatePath("/spot/<id>")` so an edit shows up at once. `/s/[placeId]`
remains a 308 to `/spot/[placeId]` for links already in the wild;
`/spot/...` is the canonical URL everywhere.

`app/sitemap.ts` lists the static routes plus one `/spot/<id>` per place from
**one** doc read (`placesSummary/current`); `app/robots.ts` replaces the old
static file. The contents logic and its tests live in `src/server/sitemap.ts`.

### The community feed is lazy — keep it that way

`allSessions` (every user's swims this year) is the most expensive
subscription in the app and is **refcounted, not always-on**. Anything that
reads `allSessions` — or state derived from it (`sessionsByPlace`,
`achievementCtx`, community achievements) — must hold an acquisition via
`useAllSessionsFeed(active?)` while mounted. The listener starts with the
first consumer, survives a 60 s grace period after the last one, and requires
a signed-in user (security rules reject unauthenticated session reads, so
guests never start it). `allSessionsReady` tells you whether the feed is live;
`SinceLastVisit` shows the pattern of waiting for it before computing.

### Water temps live OFF the place docs — keep them there

High-churn temperature readings are stored separately from the place docs, so
a new reading doesn't fan out to every client: all map temps come from the
single `tempSummary/current` doc (rebuilt by the daily sweep,
~1 read/client/day; merged onto places in `derive()` as `placesWithTemps`),
and the open spot subscribes to `placeTemps/{placeId}` for live on-demand
refreshes (`refreshPlaceTemp` writes only there). The server-rendered spot
page reads the same `tempSummary/current` entry. Never write reading fields
onto `places` docs, and consume `placesWithTemps` / `myPlaces` — not raw
`places` — anywhere a temperature should show.

### Places are read from a summary doc, not the collection

For the same reason, the map/pickers never subscribe to the whole ~5k-doc
`places` collection. They read `placesSummary/current` — one doc of every
place's lightweight display fields (name, lat/lng, naturist flag) plus the
`lastSwim*` recency glow/border, rebuilt by the daily sweep
(`scripts/update-places-summary.mjs`) from the sessions — plus a bounded
`updatedAt > builtAt` delta listener (`watchPlaceChangesSince`) for spots
created or edited since that build. That delta is a live subscription, so it
runs **only while signed in** (gated by `syncDelta()` on auth changes) — guests
make do with the daily summary and never subscribe to `places` (one-off reads
like `getPlace` on a spot page still work for them). The store reassembles its
`places` array (`PlacePin[]`) via `mergeDelta` (`src/lib/places.ts`), and it
flows through the same `derive()` pipeline. So: never add an always-on listener
over `places`,
never write `lastSwim*`/`waterTemp*` onto place docs (`logSession` /
`removeSession` don't — the summary derives the last swim from sessions), and
stamp `updatedAt` on any new place write so the delta catches it. The full
place doc (info, provenance) is fetched on demand — by the spot page's server
read, and by the client via `getPlace`; the standalone
`scripts/scrub-place-legacy.mjs` clears the old fields off docs.

The same one-doc rule applies to server code: `app/sitemap.ts` reads that doc,
not the collection.

### Writes are server-authoritative

Clients never write `sessions` docs or `users.scores` — the Route Handlers in
`app/api/*/route.ts` do (scoring math in `src/server/scoring.js`, leaderboard
in `src/server/leaderboard.js`), so points can't be forged, and they also
maintain the denormalized `displayName`/`placeName` on sessions.
`firestore.rules` enforces this; emoji reactions are the one client-writable
session field. The client calls them through `callApi(name, payload)` in
`src/firebase.ts`, which POSTs to `/api/<name>` with the user's ID token as a
`Authorization: Bearer` header; `requireUser()` in `src/server/api.ts` verifies
it. Adding an endpoint is a new `app/api/<name>/route.ts` with
`export const runtime = "nodejs"` (firebase-admin needs Node) — there is no
rewrite list to update any more. `syncTempSummary` is the one remaining Cloud
Function in `functions/`: it's a Firestore trigger, which App Hosting can't
host.

### i18n: every string, both languages

All UI text goes through `useT()` with keys in `src/lib/i18n.ts`, which holds
two parallel dictionaries (Swedish first, English ~600 lines below). A new key
must be added to **both**; a missing key renders as the raw key. The app
defaults to Swedish.

Because pages are server-rendered, the locale store always _starts_ `"sv"` even
in the browser, and `hydrateLocale()` (called from `AppBoot` in a layout
effect, so before paint) applies the saved / browser-preferred language. If it
detected the locale at module scope, an English user's first client render
would disagree with the Swedish HTML and every translated string would report a
hydration mismatch. Server-only text that can't use `useT()` — the spot page's
share card — is Swedish by design; see `src/server/spotShare.ts`.

Dates are formatted in `Europe/Stockholm`, not the device zone
(`src/lib/utils.ts`): a swim is a Swedish bathing-day fact, and a
runtime-default zone made the UTC server and the browser disagree about
server-rendered swim dates.

### The map is performance-sensitive

`src/components/SwimMap/` is loaded lazily and client-only — import
`@/components/SwimMapDynamic`, **never** `@/components/SwimMap`: Leaflet reads
`window` as its module initialises, so an eager import breaks the server render
of any route that touches it, and the ~190 KB chunk must stay off first paint.
The map is full of deliberate non-idiomatic code: module-level caches for
marker positions and icons, cluster on/off hysteresis, view persistence across
unmounts (`savedViews`), and refs feeding the cluster-icon builder. Each has a
comment explaining the re-render or flicker bug it prevents — read them before
"simplifying". To focus a place programmatically use the
`focusPlaceId`/`focusToken` props; focused/active pins are pulled out of the
cluster group on purpose.

### Installable, but no service worker

The app ships a manifest (`app/manifest.ts`) and is installable, but offline is
explicitly not a goal — there is no service worker at all. A `public/sw.js`
kill-switch existed for one release after the Next cutover, to unregister the
old Workbox worker on devices that already had it; it has since been retired,
along with its no-cache header in `next.config.ts`. Don't reintroduce a
service worker without a reason: the prompt-mode update flow existed only to
stop an SW activation reloading the page mid swim-log, and with SSR'd HTML an
update is simply the next navigation.

### Data model and tests

`src/lib/types.ts` is the source of truth for document shapes (with rationale
in comments). Pure logic lives in `src/lib/*` and `src/server/*` with vitest
tests alongside (`*.test.ts` / `*.test.js`, node environment via
`vitest.config.ts` — kept separate from the Next build so no bundler plugins
load). There are no component/DOM tests; UI changes are verified by driving
the app in a browser.

### Auth quirks worth knowing

Google sign-in uses a popup on localhost but a redirect in production (see
`loginWithGoogle` in the store for why), and Google users without a
`homeCountry` are routed through a `googleOnboarding` state. The
"since last visit" digest reads `lastSeenBaseline` captured at login — not
`profile.lastSeenAt`, which is immediately re-stamped to "now".

### Deploy

`badligan.club` is served by Firebase App Hosting — backend `badligan` in
`europe-west4` (co-located with Firestore's `eur3` multi-region), configured
by `apphosting.yaml` and `firebase.json`'s `apphosting` block. CI releases it:
`.github/workflows/deploy.yml` runs `deploy --only apphosting`, which uploads
source for Cloud Build. The backend's own automatic rollout trigger is
disabled on purpose so a push doesn't build twice.

Two things to know. App Hosting resolves every secret declared in
`apphosting.yaml` at rollout time regardless of its `availability`, so a
missing Secret Manager grant is a hard _build_ failure. And the apex must stay
DNS-only in Cloudflare — proxying makes Cloudflare terminate TLS with its own
certificate, which breaks Google's cert validation.

The old static-Hosting block is gone; `functions/` holds only
`syncTempSummary`, since App Hosting has no Firestore triggers.
