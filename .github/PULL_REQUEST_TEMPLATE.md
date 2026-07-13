<!--
Title: use a conventional-commit style, e.g. `feat(map): …`, `fix(log): …`.
Keep this PR focused on one thing — split unrelated changes.
-->

## What & why

<!-- What does this change, and why? Link any related issue. -->

## How it works

<!-- Key implementation notes, trade-offs, or anything non-obvious a reviewer should know. -->

## Testing

<!-- How did you verify this? e.g. `npm test`, driven against the Firebase emulators, screenshots for UI. -->

## Checklist

- [ ] `npm run lint` passes (type-checking is the lint step)
- [ ] `npm test` passes
- [ ] User-facing behaviour verified against the Firebase emulators
- [ ] New UI strings added to **both** dictionaries in `src/lib/i18n.ts` (Swedish + English)
- [ ] No client writes to server-authoritative data (`sessions`, `users.scores`); those go through Cloud Functions
- [ ] Docs updated if needed (README / CLAUDE.md)
