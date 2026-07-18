#!/usr/bin/env node
/**
 * Force reset a user's password.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     node scripts/force-set-password.mjs <uid> <newPassword>           # dry run
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     node scripts/force-set-password.mjs <uid> <newPassword> --write   # commit
 *
 * Example:
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     node scripts/force-set-password.mjs "abc123xyz" "TempPass123!" --write
 *
 * Notes:
 *   - Requires `firebase-admin` (devDep) and a service-account JSON.
 *   - Password must be at least 6 characters.
 *   - This tool bypasses normal password change flows and directly updates
 *     the user's password in Firebase Auth.
 *   - Use with caution — typically for admin/support purposes only.
 */

import { initializeApp, applicationDefault, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { readFileSync } from "node:fs";

const WRITE = process.argv.includes("--write");
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT ?? "badligan";
const uid = process.argv[2];
const newPassword = process.argv[3];

function initAdmin() {
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credPath) {
    return initializeApp({
      credential: cert(JSON.parse(readFileSync(credPath, "utf8"))),
      projectId: PROJECT_ID,
    });
  }
  return initializeApp({
    credential: applicationDefault(),
    projectId: PROJECT_ID,
  });
}

async function forceSetPassword() {
  if (!uid || !newPassword) {
    console.error(
      "Usage: force-set-password.mjs <uid> <newPassword> [--write]",
    );
    console.error(
      "Example: force-set-password.mjs 'user123' 'NewPass123!' --write",
    );
    process.exit(1);
  }

  if (newPassword.length < 6) {
    console.error("Error: password must be at least 6 characters");
    process.exit(1);
  }

  const app = initAdmin();
  const auth = getAuth(app);

  try {
    // Dry-run: just look up the user to verify they exist
    if (!WRITE) {
      console.log("[DRY RUN] Verifying user exists...");
      try {
        const userRecord = await auth.getUser(uid);
        console.log(`✓ User found: ${userRecord.uid}`);
        console.log(`  Email: ${userRecord.email || "(no email)"}`);
        console.log(`  Display Name: ${userRecord.displayName || "(none)"}`);
        console.log(`\n[DRY RUN] Would update password to: "${newPassword}"`);
        console.log("\nRe-run with --write to apply changes:");
        console.log(
          `GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node scripts/force-set-password.mjs "${uid}" "${newPassword}" --write`,
        );
      } catch (error) {
        console.error(`✗ Could not find user ${uid}:`, error.message);
        process.exit(1);
      }
    } else {
      // Actual password update
      console.log(`[WRITE] Updating password for user: ${uid}`);
      const userRecord = await auth.updateUser(uid, {
        password: newPassword,
      });
      console.log(
        `✓ Successfully updated password for user: ${userRecord.uid}`,
      );
      console.log(`  Email: ${userRecord.email || "(no email)"}`);
    }
  } catch (error) {
    console.error("Error:", error.message);
    process.exit(1);
  }
}

forceSetPassword();
