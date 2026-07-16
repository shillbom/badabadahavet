import { defineConfig } from "react-doctor/api";

export default defineConfig({
  ignore: {
    rules: [
      "-doctor/no-danger",
      "react-doctor/firebase-permissive-rules",
      // The Firebase client config is public by design (it's not a secret), and
      // every collection/field is enforced server-side: firestore.rules gates
      // each collection on request.auth.uid, keeps scores/statsByYear/isAdmin/
      // points server-owned + immutable from the client, and ends in a
      // catch-all deny. Shipping collection names in the bundle therefore grants
      // no access — the canonical "verified safe" case for this rule.
      "react-doctor/artifact-baas-authority-surface",
    ],
    files: [".claude/**"],
  },
  categories: {
    Maintainability: "warn",
  },
});
