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

### Continuous deploy from GitHub

`.github/workflows/deploy.yml` builds and deploys to the **live** channel on every push to `main`. `.github/workflows/preview.yml` builds a preview channel on every pull request and posts the URL as a PR comment.

Both workflows need the following **GitHub repository secrets**:

| Secret                              | Value                                                                                                                                                                                                      |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FIREBASE_SERVICE_ACCOUNT`          | The full JSON of a service account with the `Firebase Hosting Admin` role. Generate from the Firebase console → Project settings → Service accounts → "Generate new private key", then paste the raw JSON. |
| `VITE_FIREBASE_API_KEY`             | From the web app config                                                                                                                                                                                    |
| `VITE_FIREBASE_AUTH_DOMAIN`         | e.g. `your-project.firebaseapp.com`                                                                                                                                                                        |
| `VITE_FIREBASE_PROJECT_ID`          | e.g. `your-project` — also used as the deploy target                                                                                                                                                       |
| `VITE_FIREBASE_STORAGE_BUCKET`      | e.g. `your-project.appspot.com`                                                                                                                                                                            |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` |                                                                                                                                                                                                            |
| `VITE_FIREBASE_APP_ID`              |                                                                                                                                                                                                            |
| `VITE_FIREBASE_MEASUREMENT_ID`      | Optional — `G-…` ID for Firebase Analytics                                                                                                                                                                 |

Rules and indexes are **not** auto-deployed — run `firebase deploy --only firestore:rules,storage:rules,firestore:indexes` locally when you change them.

## Native apps (Capacitor wrapper)

The same React codebase ships as iOS and Android apps via [Capacitor](https://capacitorjs.com).
The wrapper hosts the built SPA in a system WebView and exposes native
APIs (camera, geolocation, splash, push) through plugins. There's a
small `src/lib/native.ts` shim that picks the Capacitor implementation
when `Capacitor.isNativePlatform()` is true and falls back to the
browser APIs otherwise, so a single code path works in both contexts.

### Building

```bash
# Build the web bundle for native (skips the PWA service worker
# and copies dist/ into android/ + ios/)
npm run cap:build

# Open the project in the platform IDE
npm run cap:open:android   # → Android Studio
npm run cap:open:ios       # → Xcode (macOS only)

# Or run on an attached device / simulator
npm run cap:run:android
npm run cap:run:ios
```

After any web-side change, re-run `npm run cap:build` (or `npm run cap:sync`
if you've already built) to push the new assets into the native projects.

### Requirements

- **Android:** Android Studio (or just the Android SDK + `adb`) and a JDK 17+.
- **iOS:** macOS with Xcode 15+. Capacitor 8 uses Swift Package Manager,
  so CocoaPods is no longer required.

### Permissions

iOS usage strings live in `ios/App/App/Info.plist` (`NSCameraUsageDescription`,
`NSPhotoLibraryUsageDescription`, `NSLocationWhenInUseUsageDescription`).
Android permissions are declared in `android/app/src/main/AndroidManifest.xml`
(`CAMERA`, `ACCESS_FINE_LOCATION`, `READ_MEDIA_IMAGES`, …). Edit the strings
there to localise them before submitting to the stores.

### Native Google sign-in

The wrapper uses [`@capacitor-firebase/authentication`](https://github.com/capawesome-team/capacitor-firebase)
to open the OS-level Google account picker (Google Sign-In on iOS,
Play Services on Android) instead of the Firebase web redirect flow,
which is unreliable inside system WebViews. The plugin returns an ID
token; we hand it to the Firebase JS SDK via `signInWithCredential` so
the rest of the app — which already listens to JS auth state — works
unchanged. The branch lives in `loginWithGoogle()` in
`src/store/sessions.ts`, gated by `isNative()` from `src/lib/native.ts`.

Once-per-Firebase-project setup:

1. In the Firebase Console → **Project settings → Your apps**, add an
   **iOS app** (bundle id `se.badligan.app`) and an **Android app**
   (package `se.badligan.app`).
2. Download the config files:
   - **`GoogleService-Info.plist`** → drop into `ios/App/App/`
     (next to `Info.plist`), then drag it into the Xcode project so it
     gets included in the app bundle.
   - **`google-services.json`** → drop into `android/app/`.
3. **iOS only** — open `GoogleService-Info.plist`, copy the
   `REVERSED_CLIENT_ID` value, and add it as a URL scheme in
   `ios/App/App/Info.plist`:

   ```xml
   <key>CFBundleURLTypes</key>
   <array>
     <dict>
       <key>CFBundleURLSchemes</key>
       <array>
         <string>com.googleusercontent.apps.1234567890-abcdef…</string>
       </array>
     </dict>
   </array>
   ```

   (without this, Google Sign-In can't redirect back into the app)

4. In the Firebase Console → **Authentication → Sign-in method**, make
   sure **Google** is enabled. For the **Android** side, also add the
   SHA-1 fingerprint of your debug keystore (and release keystore later)
   under the Android app's settings — the native Google sign-in fails
   silently without it.

Both config files are `.gitignore`d (they're per-environment, not
secret) so each developer/CI environment drops in their own copy.

### Other caveats

- **Apple sign-in** isn't wired up. App Store policy requires it on
  iOS once any other social login is offered, so before submitting to
  the App Store add `signInWithApple` from the same plugin (it needs
  the "Sign In with Apple" capability enabled in the Xcode project and
  Apple Developer Account).
- **Push notifications** need `@capacitor/push-notifications` + a Firebase
  Cloud Messaging server key (Android) and an APNs certificate (iOS).
  Not wired up yet — add when you need it.
- The Capacitor build intentionally skips `vite-plugin-pwa`. Inside a
  native binary the assets are already bundled, and a service worker
  under `capacitor://localhost` / `https://localhost` causes stale-cache
  pain after app updates.

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
