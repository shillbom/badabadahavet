# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Badligan is a mobile-first React + Firebase PWA where friends log swims, claim
spots on a map, and compete on points. See README.md for features, scoring
rules, deploy/CI, seeding scripts, and the admin flag; this file covers how to
work in the code.

## Commands

```bash
npm run dev            # Vite dev server (expects the Firebase emulators, see below)
npm run build          # tsc -b && vite build (also what CI runs)
npm run lint           # tsc -b --noEmit — type-checking IS the lint step; there is no eslint
npm test               # vitest run (all tests)
npx vitest run src/lib/streak.test.ts        # single test file
npx vitest run -t "buoy"                     # tests matching a name
npm run format         # prettier --write .
```

Local dev runs against the Firebase emulators (requires Java 11+ and the
`firebase-tools` CLI, which is **not** in devDependencies):

```bash
cp .env.example .env.local      # already points at the emulators
firebase emulators:start        # auth/firestore/storage/functions + UI at :4000
npm run dev                     # separate terminal
```

The pre-commit hook (husky + lint-staged) runs `prettier --check` and
`tsc -b --noEmit` on staged files and **rejects the commit** on any formatting
drift — run `npx prettier --write <files>` before committing. Prettier uses
`prettier-plugin-tailwindcss`, so class order in `className` is enforced too.

## Architecture

### One store, one derive pass

`src/store/sessions.ts` is the single Zustand store: auth state, Firestore
subscriptions, and all derived data. `App.tsx` calls `_startListening()` once
at boot, which chains Firebase Auth → per-user listeners (profile doc, own
sessions, groups) and the public `places` listener. Whenever raw data changes,
`derive()` recomputes every derived value (stats, `sessionsByPlace`,
achievements, `myPlaces`…) in one pass and writes it back to the store —
components read precomputed state via selectors and should **not** re-derive
in `useMemo`. If you add derived data, add it to `derive()`.

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

The always-on `places` listener streams every changed doc to every client, so
high-churn temperature readings are stored separately: all map temps come from
the single `tempSummary/current` doc (rebuilt by the daily sweep,
~1 read/client/day; merged onto places in `derive()` as `placesWithTemps`),
and the open spot subscribes to `placeTemps/{placeId}` for live on-demand
refreshes (`refreshPlaceTemp` writes only there). Never write reading fields
onto `places` docs, and consume `placesWithTemps` / `myPlaces` — not raw
`places` — anywhere a temperature should show.

### Writes are server-authoritative

Clients never write `sessions` docs or `users.scores` — the `logSession` /
`removeSession` Cloud Functions (`functions/index.js`, scoring math in
`functions/scoring.js`) do, so points can't be forged, and they also maintain
the denormalized fields (`displayName`/`placeName` on sessions,
`lastSwimAt/By/Border` on places). `firestore.rules` enforces this; emoji
reactions are the one client-writable session field. Callables go through
`cloudFn()` in `src/firebase.ts`, which routes emulator vs. localhost vs. the
production same-origin `/api/*` Hosting rewrite — add new functions to that
rewrite list in `firebase.json`.

### i18n: every string, both languages

All UI text goes through `useT()` with keys in `src/lib/i18n.ts`, which holds
two parallel dictionaries (Swedish first, English ~600 lines below). A new key
must be added to **both**; a missing key renders as the raw key. The app
defaults to Swedish.

### The map is performance-sensitive

`src/components/SwimMap.tsx` is loaded lazily (keeps the ~190 KB Leaflet chunk
off first paint — don't import it eagerly) and is full of deliberate
non-idiomatic code: module-level caches for marker positions and icons,
cluster on/off hysteresis, view persistence across unmounts (`savedViews`),
and refs feeding the cluster-icon builder. Each has a comment explaining the
re-render or flicker bug it prevents — read them before "simplifying". To
focus a place programmatically use the `focusPlaceId`/`focusToken` props;
focused/active pins are pulled out of the cluster group on purpose.

### Data model and tests

`src/lib/types.ts` is the source of truth for document shapes (with rationale
in comments). Pure logic lives in `src/lib/*` with vitest tests alongside
(`*.test.ts`, node environment via `vitest.config.ts` — kept separate from
`vite.config.ts` so the PWA/React plugins don't load). `functions/scoring.js`
is covered by the same vitest run. There are no component/DOM tests; UI
changes are verified by driving the app against the emulators.

### Auth quirks worth knowing

Google sign-in uses a popup on localhost but a redirect in production (see
`loginWithGoogle` in the store for why), and Google users without a
`homeCountry` are routed through a `googleOnboarding` state. The
"since last visit" digest reads `lastSeenBaseline` captured at login — not
`profile.lastSeenAt`, which is immediately re-stamped to "now".
