# Next.js + Firebase App Hosting migration plan

**Status: Phases 1–5 implemented on `feat/nextjs`. Phase 6 (deploy) not
started — nothing has been deployed and the domain has not moved.**

| Phase                       | State                                                                                    |
| --------------------------- | ---------------------------------------------------------------------------------------- |
| 1 — Next skeleton           | Done. Next **16.3.4**, not 15 (see deviations below).                                    |
| 2 — routing                 | Done. `react-router` uninstalled; 33 App Router entries (22 pages + 11 API).             |
| 3 — SSR spot pages, sitemap | Done. `/spot/[placeId]` is cached SSR HTML; `app/sitemap.ts` emits 5394 URLs.            |
| 4 — PWA, manifest only      | Done, landed with Phase 1 (`virtual:pwa-register/react` can't outlive Vite).             |
| 5 — functions into Next     | Done. 11 route handlers; `functions/` is `syncTempSummary` alone.                        |
| 6 — deploy                  | **Not started.** `apphosting.yaml` is written but its `NEXT_PUBLIC_*` values are `TODO`. |

Deviations from the plan as written, all deliberate:

- **Next 16, not 15.** 16 was current stable; `reactCompiler` is top-level there.
- **`compilationMode: "all"` is not the equivalent of Vite's widened Babel
  filter** and must not be used: it compiles every function as a component,
  which broke the zustand `create()` factories at runtime. Plain
  `reactCompiler: true` (default `infer`) is correct — Next applies its own
  per-file heuristics before Babel.
- **`src/pages` had to become `src/views`** — Next claims `src/pages` for the
  Pages Router and refuses to build alongside `app/`.
- **Phase 3 needed a boot-gate fix first.** `AppBoot` rendered
  `{booting ? null : children}`, so the server always emitted an empty shell
  and SSR was a no-op. `booting` now gates only the splash overlay and the
  after-boot popovers.
- **Date formatting is pinned to `Europe/Stockholm`.** A UTC server and a
  local browser otherwise disagreed about server-rendered swim dates. This is
  user-visible: someone abroad sees Swedish-time timestamps.
- **CI no longer releases the app.** `deploy.yml` is checks + rules only; the
  old `deploy --only hosting` would have pushed the no-longer-produced `dist/`
  over the live site. The Hosting preview channel in `preview.yml` is obsolete
  for the same reason — a static channel can't run a Next server.

Open items before cutover:

1. **The Perspective API key still has an HTTP-referrer restriction** from
   when it was a browser key. Server-side calls send no referrer, so Google
   returns `403 API_KEY_HTTP_REFERRER_BLOCKED` and — because the checks fail
   open by design — moderation currently passes everything. Drop the referrer
   restriction in the Cloud console, keep the Comment Analyzer API restriction.
2. **The write route handlers' happy paths are untested at runtime.** They are
   ports of working callables (`HttpsError` → `ApiError`, `req.data` →
   `readJson(req)`), but nothing was written to production. Exercise
   `logSession` / `updateSession` / `removeSession` / group join / `banUser` /
   `deleteAccount` against the emulators.
3. **Do not deploy functions with `--force` yet** — it deletes the retired
   callables and destroys the client rollback path. See the hazard note in
   `.github/workflows/deploy.yml`.
4. **`public/sw.js` is a kill-switch**, not a real worker. Remove it (and its
   `next.config.ts` no-cache header) one release after cutover.
5. An unknown spot id answers **200, not 404** — `Layout`'s Suspense boundary
   streams the shell before the async page resolves. Documented in the page.

## Goal

1. Server-render `/spot/:placeId` so spot pages are real, indexable HTML with
   per-place `<title>`/OG tags — replacing the `spotPreview` UA-sniffing shim.
2. A real sitemap generated from live data by the framework, not a hand-rolled
   `onRequest` function.
3. Move most `onCall` Cloud Functions into Next Route Handlers so the server
   logic lives in one codebase with one deploy.

Assumption (say so if wrong): the **whole** app moves to Next and Firebase App
Hosting becomes the only serving surface. The smaller alternative — keep the
Vite SPA and add Next only for public/SEO routes — is discussed at the end.

## Where we started (historical — this is the pre-migration state)

| Piece           | Before                                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------------------------- |
| App             | Vite 8 + React 19 SPA, react-router v8, ~132 files, one Zustand store                                         |
| Routing surface | 25 files import `react-router`; 33 hook call sites; 31 `<Link>`                                               |
| Env             | 15 `import.meta.env` reads (`VITE_*`)                                                                         |
| Offline         | `vite-plugin-pwa` (Workbox), precache-everything, `registerType: "prompt"`                                    |
| Server          | `functions/` — 11 `onCall`, 2 `onRequest` (`sitemap`, `spotPreview`), 1 Firestore trigger (`syncTempSummary`) |
| Serving         | Firebase Hosting static `dist/` + `/api/*` rewrites to functions                                              |
| Scheduled work  | GitHub Actions running `scripts/*.mjs` (temps, places summary, toplist)                                       |

Two constraints from `CLAUDE.md` that shape everything below:

- Reads are deliberately cheap: the map reads `placesSummary/current`, temps
  come from `tempSummary/current`, and the community feed is refcounted. SSR
  must not reintroduce per-request fan-out reads.
- The Firestore **client** SDK with a persistent IndexedDB cache is what makes
  a returning visit cheap. Server rendering uses `firebase-admin` and gets none
  of that cache — so only server-render what actually needs to be in the HTML.

## What SSR is and isn't worth here

Worth it: `/spot/:placeId` (public, linkable, indexable), `/` landing shell,
`robots.txt`, `sitemap.xml`, share cards, and optionally a public leaderboard.

Not worth it: `/log`, `/history`, `/profile`, `/groups`, `/edit`, `/recap`,
`/achievements`, `/streak`, `/admin`. These are behind auth and driven by live
listeners. They ship as client components; SSR would add cost, cold starts and
an auth-cookie problem for zero user-visible gain.

## Phase 0 — decisions to lock before writing code

1. **App Hosting replaces Hosting for the apex domain.** You cannot point
   `badligan.club` at both. Plan a cutover: deploy the App Hosting backend, verify
   on its `*.hosted.app` URL, then move the custom domain. Keep the old Hosting
   site deployable as a rollback for one release cycle.
2. **Runtime = Node, not Edge.** `firebase-admin` requires it. Set
   `export const runtime = "nodejs"` on any route/page touching admin.
3. **Auth to the server = `Authorization: Bearer <idToken>`**, not session
   cookies. Route handlers call `getAuth().verifyIdToken(...)`. This keeps the
   client's existing auth model untouched. Session cookies are only needed if we
   later want SSR of _authenticated_ pages — deliberately out of scope.
4. **Region.** App Hosting backend in `europe-west1` to match Firestore and the
   remaining functions.
5. **Offline is not a goal — decided.** The target is "installable, runs as an
   app". That means a manifest and no service worker (see Phase 4). The existing
   Workbox SW is retired, with a one-release kill-switch `sw.js` to unregister it
   from devices that already have it.

## Phase 1 — Next skeleton, app unchanged

Goal: the current app runs byte-for-byte the same, served by Next, still on
Firebase Hosting-equivalent static output where possible. No behaviour change.

- `next@15` (App Router), `next.config.ts`, `tsconfig` paths for `@/*`.
- Tailwind v4: swap `@tailwindcss/vite` for `@tailwindcss/postcss`. Keep
  `prettier-plugin-tailwindcss`.
- React Compiler: `experimental.reactCompiler` in `next.config.ts` replaces the
  `@rolldown/plugin-babel` pass. Verify with `npx react-compiler-healthcheck`
  that the same files are compiled — the current setup deliberately widens the
  default filter because it silently skipped ~8 components.
- Env: `VITE_*` → `NEXT_PUBLIC_*`. 15 call sites, mechanical. Drop
  `VITE_PERSPECTIVE_API_KEY` from the client entirely (Phase 5).
- `index.html` → `app/layout.tsx`. Careful with the viewport/height setup:
  `html` must match the shell's `100dvh`, **not** `-webkit-fill-available`
  (that caused the iOS "unfilled screen until scroll" PWA bug).
- Keep `src/lib/*`, `src/store/*`, `src/components/*` untouched. Vitest config
  is independent of the bundler, so `npm test` keeps working as-is.

Deliverable: `npm run dev` (Next) + emulators renders the app identically.

## Phase 2 — routing

Replace `react-router` with the App Router. The surface is small (25 files).

- Route tree: `app/(app)/map`, `/history`, `/leaderboard`, `/log`, `/edit/[id]`,
  `/groups`, `/spot/[placeId]`, `/achievements`, `/streak`, `/profile`, `/about`,
  `/privacy`, `/toswim`, `/recap`, `/login`, `/admin/users`.
- Mechanical swaps: `useNavigate()` → `useRouter().push`, `useLocation()` →
  `usePathname()` + `useSearchParams()`, `<Link to=>` → `<Link href=>`,
  `useParams` is near-identical.
- `src/lib/pages.ts` (lazy + `withStaleReload` + post-login preload) is largely
  replaced by Next's per-route splitting and `router.prefetch`. Keep the
  post-login preload _ordering_ intent (Map first, Recap last) via prefetch
  calls; drop the `withStaleReload` chunk-404 guard — Next handles stale
  deployments differently, and the SW change in Phase 4 affects this too.
- The whole authed shell (`Layout`, `NavBar`, store boot via `_startListening`,
  toasts, celebration overlay, consent banner) becomes one client component
  mounted in `app/(app)/layout.tsx`. The Zustand store and its listeners are
  untouched.
- `SwimMap` stays `next/dynamic` with `ssr: false` — Leaflet touches `window`,
  and keeping the ~190 KB chunk off first paint is deliberate.

Risk: the splash/boot choreography (`bootSignal`, `contentReady`, splash exit
timing) is tuned against the current lazy-import boot. Expect to re-tune it.

## Phase 3 — the actual point: SSR spot pages, metadata, sitemap

### `/spot/[placeId]`

- `page.tsx` is a **server** component. It reads via `firebase-admin`:
  the place doc, the swim count, a recent photo, and the `tempSummary/current`
  entry — i.e. exactly what `spotPreview` reads today, so no new read cost, and
  now it's cached instead of thrown away after generating a meta tag.
- `generateMetadata()` produces the title/description/OG/Twitter tags that
  `spotPreview` builds by string concatenation today. Delete
  `spotPreview` and the `SHARE_CRAWLER_UA` sniffing.
- Server-render the static content (name, info text, temp, swim count, map
  placeholder, recent swims list) so crawlers and first paint get real HTML.
  Hydrate `SpotPageContent` as a client component beneath it for the live
  parts (reactions, add-to-swim, temp refresh, live sessions listener).
  `SpotSheet` reuses the same client component — that split already exists via
  the `variant` prop, so this is a clean seam.
- Caching: `export const revalidate = 3600` plus `revalidatePath` from
  `logSession` when a swim lands on that place. Keeps Firestore reads flat
  regardless of crawler traffic.
- `/s/:placeId` keeps working as a permanent redirect to `/spot/:placeId`
  (a `redirect()` in `app/s/[placeId]/route.ts`), so existing shared links and
  the current sitemap's URLs don't break. Consider making `/spot/...` the
  canonical URL in the new sitemap and 301-ing `/s/...`.

### Sitemap and robots

- `app/sitemap.ts` reads `placesSummary/current` (same doc as today) and emits
  entries for every place plus static routes. `buildSitemapXml` and its tests in
  `functions/sitemap.js` are retired — Next owns the XML.
- If the place count outgrows 50k URLs, use `generateSitemaps()` for shards.
  Today ~4k places, so a single sitemap is fine.
- `app/robots.ts` replaces `public/robots.txt`.
- Delete the `sitemap` and `spotPreview` entries from `firebase.json` rewrites.

## Phase 4 — PWA: manifest only, no service worker

Offline is explicitly **not** a goal. The goal is "installable, runs as an app".
That needs a manifest and HTTPS — nothing else. Serwist is not needed and is not
being adopted.

Installability, precisely:

| Install path                                                 | Service worker needed?                                          |
| ------------------------------------------------------------ | --------------------------------------------------------------- |
| iOS "Add to Home Screen"                                     | No — manifest with `display: standalone` + apple-touch-icon     |
| Android / desktop Chrome **menu** install                    | No — requirement dropped in Chrome 108 (mobile) / 112 (desktop) |
| Android automatic **install prompt** (`beforeinstallprompt`) | Yes — still requires a registered SW with a `fetch` handler     |

Next's own PWA guide recommends against building on `beforeinstallprompt`
(unsupported on Safari iOS), so we don't. Menu install + the iOS share-sheet
hint cover both platforms.

The work:

- Port `public/site.webmanifest` to `app/manifest.ts` (typed `MetadataRoute.Manifest`).
  Content is unchanged: id/scope `/`, `display: standalone`, `orientation:
portrait`, the four 192/512 any+maskable icons, `theme_color: #eff9ff`.
- Keep the iOS install hint: a small client component that detects iOS + not
  already `display-mode: standalone` and explains the share-sheet flow.
- Delete `vite-plugin-pwa` and everything downstream of it:
  - `UpdatePrompt.tsx`, `useRegisterSW`, and the hourly `swRegistration.update()`
    check in `App.tsx`
  - `withStaleReload` in `src/lib/pages.ts` (Next handles stale deploys itself)
  - the `sw.js` / `registerSW.js` no-cache headers in `firebase.json`
- Ship a **kill-switch service worker** for one release. Existing installs have a
  precaching Workbox SW registered at `/sw.js`; if that file just 404s, some
  browsers keep serving the old cached shell. Publish a `public/sw.js` that
  calls `self.registration.unregister()` and `caches.keys().then(deleteAll)`,
  keep it for a release cycle, then remove it. **Do not skip this** — it is the
  only real risk in this phase.

Why the runtime caches don't need replacing:

- Swim photos are already uploaded with
  `Cache-Control: public, max-age=31536000, immutable` (`src/lib/data.ts`), so the
  browser HTTP cache does that job.
- OSM / CARTO / Esri tiles ship their own cache headers.

The Workbox layer was belt-and-braces on top of the HTTP cache, not
load-bearing. Do watch the CARTO tile-request count after cutover (the free tier
is 5M/month) — if it climbs materially, revisit with a tiny hand-written
tile-caching SW rather than a full Workbox setup.

Bonus: dropping the SW preserves the behaviour the prompt-mode update flow was
built to protect. That flow exists so a SW activation can never reload the page
mid swim-log; with SSR'd HTML and no SW, an update is simply the next navigation.

Still verify on iOS installed-to-homescreen: the `100dvh` viewport handling
(`html` must match the shell's height — **not** `-webkit-fill-available`) is
unrelated to the SW and remains a real regression risk.

## Phase 5 — move functions into Next

### Moves to Next Route Handlers (`app/api/<name>/route.ts`)

`logSession`, `removeSession`, `updateSession`, `refreshPlaceTemp`,
`setPlaceInfo`, `lookupGroupByCode`, `joinGroupByCode`, `leaveGroup`,
`deleteAccount`, `banUser`.

- These are `onCall`, so the wire format is Firebase's callable envelope. Moving
  them means switching to plain JSON POST. Simplify `cloudFn()` in
  `src/firebase.ts` into a `callApi(name, payload)` that attaches
  `Authorization: Bearer <await user.getIdToken()>` and posts to `/api/<name>`.
  Same-origin, so the emulator/localhost/production three-way branch disappears.
- Server side: shared `requireUser(req)` helper doing `verifyIdToken`, then the
  existing body of each function nearly unchanged (it already uses the admin
  SDK). `functions/scoring.js`, `moderation.js`, `placesLogic.js`,
  `tempLogic.js`, `leaderboard.js` move to `src/server/` as TypeScript-adjacent
  modules — **keep their vitest tests**, they're the safety net for this phase.
- `PERSPECTIVE_API_KEY` becomes an App Hosting secret. The client-side
  Perspective call in `src/lib/moderation.ts` can then go through
  `/api/moderate` instead of shipping a key to the browser — a real security
  improvement, and it removes one API-key referrer restriction to maintain.
- Note the write-authority invariant from `CLAUDE.md`: clients still never write
  `sessions` or `users.scores`. `firestore.rules` is unchanged — the Next server
  writes with admin credentials, exactly like the functions did.

### Stays in Cloud Functions

- `syncTempSummary` (`onDocumentWritten` on `placeTemps/{placeId}`). App Hosting
  has no Firestore triggers. The `functions/` codebase shrinks to this one
  export, `firebase.json`'s `functions` block stays, and `/api/*` rewrites are
  deleted.

### Stays in GitHub Actions

- `update-temperatures.mjs`, `update-places-summary.mjs`, `backfill-toplist.mjs`
  and the seed/scrub scripts. No reason to move them; they're already scheduled
  and they keep the daily-sweep read model intact.

## Phase 6 — deploy

- `apphosting.yaml`: region `europe-west1`, `minInstances: 0`, `maxInstances`
  capped, `NEXT_PUBLIC_*` env vars, `PERSPECTIVE_API_KEY` as a secret.
- App Hosting builds from a connected GitHub branch, which overlaps with
  `.github/workflows/deploy.yml`. Decide: either let App Hosting own the build
  (and reduce the workflow to lint/typecheck/test + rules deploy), or keep CI
  authoritative. Recommend the former, with CI as a required status check.
- `preview.yml` currently deploys PRs to Firebase Hosting preview channels.
  App Hosting has its own PR previews — rewire or retire that workflow, and note
  the IPv4/retry workaround there is Hosting-specific.
- Firebase API key referrer allowlist must gain the new `*.hosted.app` origins
  (and any preview domains) or the client SDK will start 403-ing.
- Cold starts: `minInstances: 0` means the first crawler hit pays a Node cold
  start. If Search Console latency matters, `minInstances: 1` — at a real
  monthly cost that static Hosting didn't have. Worth measuring before deciding.

## Cutover and rollback

1. Ship Phases 1–2 behind the `*.hosted.app` URL while production stays on
   Hosting. The two can run simultaneously against the same Firestore.
2. Move the domain once Phase 3 is verified (spot page HTML, OG cards via the
   Facebook/Twitter debuggers, sitemap fetched by Search Console).
3. Phase 5 last, one function at a time, each with the old `onCall` still
   deployed so a client rollback works. Delete the functions only after a week.

## Risks, honestly

- **The SPA does not get faster.** For signed-in users the store + persistent
  Firestore cache already makes navigation instant. Adding SSR to those routes
  can only make them slower. The win is SEO and share cards, not perf.
- **Stale service workers on existing installs.** Mitigated by the kill-switch
  `sw.js` in Phase 4; skipping it strands users on the old cached shell.
- **Ongoing cost** goes from ~free static Hosting to a Cloud Run service.
- **Blast radius**: routing, bundler, PWA and the server all change. Phasing is
  what keeps this reversible; a big-bang branch would be very hard to review.

## The smaller alternative

If the only real goals are (1) and (2) — indexable spot pages and a proper
sitemap — a much cheaper option exists: keep the Vite SPA on Hosting and add a
Next app on App Hosting serving **only** `/spot/**`, `/sitemap.xml` and
`/robots.txt`, with Hosting rewrites routing those paths to the App Hosting
backend. No routing rewrite, no service-worker change, no function migration. It does not
deliver goal (3), and it means two apps to maintain.

Recommended only if the appetite for Phases 2 and 4 is low.
