// Shared plumbing for the Route Handlers that replaced the `onCall` Cloud
// Functions. The functions used firebase-functions' `HttpsError` and the
// callable SDK's envelope; both are gone, so this module reproduces the two
// things the client actually depended on:
//
//   1. An error *code* string (`unauthenticated`, `not-found`, …) and an
//      optional `details` object. `src/lib/data.ts` branches on
//      `err.details.reason === "moderation"` and on
//      `err.code === "functions/not-found"`, so the wire format keeps both
//      (`callApi` in src/firebase.ts re-adds the `functions/` prefix). The
//      canonical codes are kept rather than invented HTTP-only semantics so
//      the mapping stays one-to-one with the functions being replaced.
//   2. Auth from an `Authorization: Bearer <idToken>` header instead of the
//      callable envelope's `request.auth`. Session cookies are deliberately
//      out of scope (see the migration plan's Phase 0).

import { NextResponse } from "next/server";
import type { DecodedIdToken } from "firebase-admin/auth";
import { getAuth } from "./firebaseAdmin";

/** The canonical error codes the replaced callables threw. */
export type ApiErrorCode =
  | "invalid-argument"
  | "failed-precondition"
  | "not-found"
  | "permission-denied"
  | "resource-exhausted"
  | "unauthenticated"
  | "internal";

// Same mapping firebase-functions used for callables, so a client that
// looked at the status before still sees the same one.
const STATUS: Record<ApiErrorCode, number> = {
  "invalid-argument": 400,
  "failed-precondition": 400,
  unauthenticated: 401,
  "permission-denied": 403,
  "not-found": 404,
  "resource-exhausted": 429,
  internal: 500,
};

/**
 * Drop-in replacement for `HttpsError`. `toResponse()` serialises it into
 * the `{ error: { code, message, details? } }` body `callApi` unpacks.
 */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(
    code: ApiErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.details = details;
  }

  get status(): number {
    return STATUS[this.code];
  }
}

/** Minimal stand-in for firebase-functions' structured `logger`. App Hosting
 *  runs on Cloud Run, where stdout/stderr land in Cloud Logging just the
 *  same, so plain console calls with a payload keep the call sites unchanged. */
export const logger = {
  info: (msg: string, data?: unknown) => console.info(msg, data ?? ""),
  warn: (msg: string, data?: unknown) => console.warn(msg, data ?? ""),
  error: (msg: string, data?: unknown) => console.error(msg, data ?? ""),
};

/**
 * Verify the caller's Firebase ID token and return what the callables read
 * off `request.auth`: the uid and the decoded token (claims — `isAdmin`
 * lives in Firestore, not the token, so routes still read the user doc).
 *
 * Throws `unauthenticated` for a missing, malformed, expired or revoked
 * token — the same code and 401 the `if (!req.auth)` guard produced.
 */
export async function requireUser(
  req: Request,
): Promise<{ uid: string; token: DecodedIdToken }> {
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer (.+)$/i.exec(header.trim());
  if (!match) {
    throw new ApiError("unauthenticated", "Sign in required.");
  }
  let token: DecodedIdToken;
  try {
    token = await getAuth().verifyIdToken(match[1]!);
  } catch {
    // Don't leak *why* (expired vs. forged vs. wrong project) to the client.
    throw new ApiError("unauthenticated", "Sign in required.");
  }
  return { uid: token.uid, token };
}

/** Parse a JSON request body, tolerating an empty one (`deleteAccount`
 *  posts nothing meaningful). Anything that isn't a JSON object is a
 *  client bug, not a server error. */
export async function readJson(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (!text.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ApiError("invalid-argument", "Body must be JSON.");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ApiError("invalid-argument", "Body must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

/** Serialise a thrown error into the response body `callApi` expects. */
export function errorResponse(err: unknown): NextResponse {
  if (err instanceof ApiError) {
    return NextResponse.json(
      {
        error: {
          code: err.code,
          message: err.message,
          ...(err.details ? { details: err.details } : {}),
        },
      },
      { status: err.status },
    );
  }
  // Unexpected: log the real thing, tell the client nothing.
  logger.error("route handler failed", { error: String(err) });
  return NextResponse.json(
    { error: { code: "internal", message: "Internal error." } },
    { status: 500 },
  );
}

/**
 * Wrap a route body so every handler shares one try/catch and one JSON
 * error shape — the equivalent of what `onCall` did around each callable.
 * The returned value is sent as the response body verbatim (`undefined`
 * becomes `null`, matching the callable SDK's `result.data`).
 */
export function route<T>(
  handler: (req: Request) => Promise<T>,
): (req: Request) => Promise<NextResponse> {
  return async (req: Request) => {
    try {
      const data = await handler(req);
      return NextResponse.json(data ?? null);
    } catch (err) {
      return errorResponse(err);
    }
  };
}
