# Badligan 🌊

A friendly little competition app for swim-spot collectors. React + Firebase, mobile-browser-first. UI is in Swedish by default with English as a second language; toggle in the header (or on the login screen).

## Scoring

- **+1** per swim session
- **+2** the first time you swim at a unique named spot (matches by name + 100 m radius)
- **+2** winter bonus when the swim is in November–March

Yearly winners are decided automatically — toggle "All time" / "year" on the leaderboard.

## Stack

- Vite + React + TypeScript
- Tailwind (with hand-rolled shadcn-style primitives in `src/components/ui`)
- Firebase: Auth (email/password under the hood, but users only see a name), Firestore, Storage
- Leaflet + OpenStreetMap tiles
- Framer Motion for animations
- Zustand for client-side state

## Run locally with the Firebase emulators

You need Java 11+ for the Firestore emulator and the Firebase CLI:

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

Open http://localhost:5173 — sign up with any name + password (stored in the auth emulator only).

## Going to production

1. Create a Firebase project, enable **Email/Password** auth, **Firestore**, and **Storage**.
2. Drop the real config into `.env.local` and set `VITE_USE_FIREBASE_EMULATORS=0`.
3. `npm run build && firebase deploy` (rules + hosting + indexes).

## Admin / moderation

Admins can rename and delete spots, delete individual swims, and remove
bad photos. The flag isn't reachable from the UI on purpose — flip it
manually:

```bash
# emulator
curl -X PATCH \
  "http://localhost:8080/v1/projects/demo-badligan/databases/(default)/documents/users/<UID>?updateMask.fieldPaths=isAdmin" \
  -H "Content-Type: application/json" \
  -d '{"fields":{"isAdmin":{"booleanValue":true}}}'
```

In production, the simplest path is the Firebase Console → Firestore →
`users/{uid}` → add field `isAdmin: true`. Rules forbid clients from
toggling this themselves.

## Data model

```
users/{uid}      { displayName, emoji, groups[], createdAt }
places/{id}      { name, lat, lng, createdBy, firstSwumAt }
sessions/{id}    { uid, displayName, placeId, placeName, lat, lng, date,
                   note?, photoUrl?, isUniqueForUser, isWinter, points, createdAt }
groups/{id}      { name, code, members[], createdBy, createdAt }
```

## Layout

```
src/
  auth/         AuthContext.tsx
  components/
    ui/         Button, Input, Card, Toast (shadcn-style)
    Layout.tsx
    SwimMap.tsx
  lib/          types, utils, scoring, data (Firestore queries)
  pages/        MapPage, HistoryPage, LeaderboardPage, GroupsPage, LogSessionPage, LoginPage
  store/        sessions.ts (zustand store)
  firebase.ts
```
