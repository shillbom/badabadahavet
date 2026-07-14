import { defineConfig } from "react-doctor/api";

export default defineConfig({
  ignore: {
    rules: ["-doctor/no-danger", "react-doctor/firebase-permissive-rules"],
    files: [".claude/**"],
  },
  categories: {
    Maintainability: "warn",
  },
});
