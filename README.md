# Badligan 🌊

A friendly little competition app for swim-spot collectors. Log your dips, claim
spots on the map, earn points and achievements, and compete with friends. It's a
React + Firebase **installable PWA**, mobile-browser-first. The UI is in Swedish
by default with English as a second language — toggle it in the header (or on the
login screen).

Try it out at https://badligan.club

## Features

- **Log a swim** — "here & now" (auto-attaches to the nearest known spot via GPS)
  or "pick on map" (search or drop a pin), with an optional photo that's
  downscaled client-side before upload.
- **Map** — clustered pins for every spot, live-ish water temperatures, a
  satellite layer toggle, and "my places" vs. "all places" views.
- **Leaderboard** — per-year and all-time, decided automatically.
- **Groups** — create or join via an invite code; view each member's swims on a
  **map or list**, and leave **emoji reactions** on individual swims.
- **Achievements** — unlock cosmetic **borders** that ring your pins on the map.
- **Want-to-swim list** — bookmark spots you'd like to visit.
- **Yearly recap** — a stats summary of your swimming year.
- **PWA** — installable and offline-capable; on first load you always get the
  latest version, and an in-app update lands mid-session as a "reload" prompt
  rather than a forced refresh.

## Scoring

Points are computed **server-side** by Cloud Functions (clients can't write
their own score), and bucketed per calendar year:

- **+1** per swim session
- **+3** the first time you swim at a unique named spot (matches by name + 100 m radius)
- **+2** winter bonus when the swim is in November–March
- Achievements grant additional bonus points (see `src/lib/achievements.ts`)

Home country is used only for an "abroad" display stat — it does not change points.

## Stack

- Vite + React 19 + TypeScript
- Tailwind v4 (`@tailwindcss/vite`) with hand-rolled shadcn-style primitives in `src/components/ui`
- React Router v7
- Firebase: Authentication (email/password and Google), Firestore, Storage, Cloud Functions
- Leaflet + `leaflet.markercluster` + react-leaflet, on CARTO/OpenStreetMap tiles (Esri for satellite)
- `vite-plugin-pwa` (Workbox) for the service worker
- Zustand for client state, Framer Motion for animations, lucide-react icons, date-fns
- Cloud Functions on Node 24 + `firebase-admin`; `jimp` for server-side thumbnail backfills

## Run locally with the Firebase emulators

You need Node 24, Java 11+ (for the Firestore emulator), and the Firebase CLI:

```bash
npm install -g firebase-tools
```

Then in one terminal:

```bash
firebase emulators:start
```

(Emulator UI at http://localhost:4000)

In another terminal:

```bash
cp .env.example .env.local   # already points at the emulators
npm install
npm run dev
```

Open http://localhost:5173 — sign up with any name + password (stored in the auth
emulator only).

## Going to production

1. Create a Firebase project, enable **Email/Password** (and optionally **Google**)
   auth, **Firestore**, **Storage**, and **Cloud Functions**.
2. Put the real web config into `.env.local` and set `VITE_USE_FIREBASE_EMULATORS=0`.
   Use your **`*.web.app`** Hosting domain for `VITE_FIREBASE_AUTH_DOMAIN` (not
   `*.firebaseapp.com`) so the auth handler runs same-origin.
3. `npm run build && firebase deploy`.

### Continuous deploy from GitHub

- **`deploy.yml`** — on every push to `main`: builds, then deploys hosting +
  Firestore/Storage rules + indexes via the Firebase CLI. Cloud Functions deploy
  is gated behind the `DEPLOY_FUNCTIONS` repo variable (the deploy service
  account needs the extra Functions/Build/Artifact-Registry roles first).
- **`preview.yml`** — on every PR: builds and deploys a per-PR Hosting **preview
  channel** (`pr-<n>`, auto-expires in 7 days) and comments the URL on the PR.
- **`temperatures.yml`** — every 6 hours: refreshes water temperatures.

Both deploy/preview workflows need these **GitHub repository secrets**:

| Secret                              | Value                                                                                                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `FIREBASE_SERVICE_ACCOUNT`          | Full JSON of a service account with the `Firebase Hosting Admin` role (Firebase console → Project settings → Service accounts → "Generate new private key"). |
| `VITE_FIREBASE_API_KEY`             | From the web app config                                                                                                                                      |
| `VITE_FIREBASE_AUTH_DOMAIN`         | Your `*.web.app` Hosting domain                                                                                                                              |
| `VITE_FIREBASE_PROJECT_ID`          | e.g. `your-project` — also the deploy target                                                                                                                 |
| `VITE_FIREBASE_STORAGE_BUCKET`      | e.g. `your-project.appspot.com`                                                                                                                              |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` |                                                                                                                                                              |
| `VITE_FIREBASE_APP_ID`              |                                                                                                                                                              |
| `VITE_FIREBASE_MEASUREMENT_ID`      | Optional — `G-…` ID for Firebase Analytics                                                                                                                   |

## Scripts

Data/maintenance scripts run against a project using a local, git-ignored
`service-account.json` (`GOOGLE_APPLICATION_CREDENTIALS`). Most take `--write` to
actually persist (dry-run by default):

| Script                        | What it does                                                 |
| ----------------------------- | ------------------------------------------------------------ |
| `npm run seed:badplatser`     | Import Swedish public bathing spots (Hav och Vatten)         |
| `npm run seed:eea`            | Import EEA bathing-water spots (e.g. Denmark/Finland)        |
| `npm run update:temperatures` | Refresh water temps (official readings, Open-Meteo fallback) |
| `npm run backfill:scores`     | Recompute every user's per-year score                        |
| `npm run backfill:thumbnails` | Regenerate photo LQIP placeholders                           |
| `npm run merge:places`        | Merge a duplicate spot into the one it duplicates            |

## Admin / moderation

Admins can rename and delete spots, delete individual swims, and remove bad
photos. The flag isn't reachable from the UI on purpose — set it manually:

```bash
# emulator
curl -X PATCH \
  "http://localhost:8080/v1/projects/demo-badabadahavet/databases/(default)/documents/users/<UID>?updateMask.fieldPaths=isAdmin" \
  -H "Content-Type: application/json" \
  -d '{"fields":{"isAdmin":{"booleanValue":true}}}'
```

In production: Firebase Console → Firestore → `users/{uid}` → add `isAdmin: true`.
Security rules forbid clients from toggling this themselves.

## Data model

Simplified — see `src/lib/types.ts` for the full shapes:

```
users/{uid}    { displayName, emoji?, scores?{year:pts}, achievements?, selectedBorder?,
                 homeCountry?, locale?, toswim?, lastLocation?, isAdmin?, createdAt }
places/{id}    { name, lat, lng, createdBy, firstSwumAt, source?, externalId?,
                 waterTemp?, waterTempAt?, tempSource?, lastSwimAt?, lastSwimBy?, lastSwimBorder? }
sessions/{id}  { uid, displayName, placeId, placeName, lat, lng, date, points,
                 isUniqueForUser, isWinter, country?, border?, note?,
                 photoUrl?, photoThumb?, reactions?{emoji:[uid]}, createdAt }
groups/{id}    { name, emoji?, code, members[], createdBy, createdAt }
```

Scores and sessions are written only by Cloud Functions; security rules block
direct client writes to them (reactions are the one client-writable session field).

## Layout

```
src/
  auth/         AuthContext.tsx
  components/   Layout, SwimMap, ReactionBar, Photo, UpdatePrompt, ui/ (Button, Input, …)
  lib/          types, utils, scoring, achievements, borders, image, geocode, i18n, data
  pages/        Map, Spot, Log, History, Leaderboard, Groups, Achievements,
                Recap, Profile, Toswim, About, Login, GoogleAuth
  store/        sessions.ts (zustand store)
  firebase.ts
functions/      Cloud Functions (logSession, removeSession, scoring, groups, …)
scripts/        seed / temperature / backfill utilities
```

## License

[MIT](LICENSE) © Simon Hillbom
