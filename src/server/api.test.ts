import { describe, expect, it, vi, beforeEach } from "vitest";

// requireUser reaches for the admin SDK, which would try to find credentials.
// Stub the whole module — these tests are about the request contract (header
// parsing, error codes, status mapping), not about token cryptography.
const verifyIdToken = vi.fn();
vi.mock("./firebaseAdmin", () => ({
  getAuth: () => ({ verifyIdToken }),
}));

const { ApiError, readJson, requireUser, errorResponse } =
  await import("./api");

const post = (body: string, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/x", { method: "POST", body, headers });

describe("ApiError", () => {
  it("maps each code to the status the callables used", () => {
    expect(new ApiError("invalid-argument", "x").status).toBe(400);
    expect(new ApiError("failed-precondition", "x").status).toBe(400);
    expect(new ApiError("unauthenticated", "x").status).toBe(401);
    expect(new ApiError("permission-denied", "x").status).toBe(403);
    expect(new ApiError("not-found", "x").status).toBe(404);
    expect(new ApiError("resource-exhausted", "x").status).toBe(429);
    expect(new ApiError("internal", "x").status).toBe(500);
  });

  it("carries the details the client branches on", () => {
    const err = new ApiError("invalid-argument", "nope", {
      reason: "moderation",
    });
    expect(err.details).toEqual({ reason: "moderation" });
  });
});

describe("errorResponse", () => {
  it("serialises an ApiError with its code, message and details", async () => {
    const res = errorResponse(
      new ApiError("failed-precondition", "Past seasons are locked.", {
        reason: "season-locked",
      }),
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: {
        code: "failed-precondition",
        message: "Past seasons are locked.",
        details: { reason: "season-locked" },
      },
    });
  });

  it("hides unexpected failures behind a bare 500", async () => {
    const res = errorResponse(new Error("db exploded: user@example.com"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("internal");
    expect(JSON.stringify(body)).not.toContain("exploded");
  });
});

describe("readJson", () => {
  it("parses an object body", async () => {
    await expect(readJson(post('{"placeId":"a"}'))).resolves.toEqual({
      placeId: "a",
    });
  });

  it("treats an empty body as {} (deleteAccount posts nothing)", async () => {
    await expect(readJson(post(""))).resolves.toEqual({});
  });

  it("rejects malformed JSON as invalid-argument, not a 500", async () => {
    await expect(readJson(post("{oops"))).rejects.toMatchObject({
      code: "invalid-argument",
    });
  });

  it("rejects a non-object body", async () => {
    await expect(readJson(post("[1,2]"))).rejects.toMatchObject({
      code: "invalid-argument",
    });
    await expect(readJson(post("42"))).rejects.toMatchObject({
      code: "invalid-argument",
    });
  });
});

describe("requireUser", () => {
  beforeEach(() => {
    // Braces matter: a beforeEach that *returns* the mock hands vitest the
    // mock as a teardown callback, which then calls it.
    verifyIdToken.mockReset();
  });

  it("rejects a request with no Authorization header", async () => {
    await expect(requireUser(post("{}"))).rejects.toMatchObject({
      code: "unauthenticated",
    });
    expect(verifyIdToken).not.toHaveBeenCalled();
  });

  it("rejects a non-Bearer scheme", async () => {
    await expect(
      requireUser(post("{}", { authorization: "Basic abc" })),
    ).rejects.toMatchObject({ code: "unauthenticated" });
  });

  it("rejects an invalid token without leaking the reason", async () => {
    verifyIdToken.mockRejectedValue(new Error("token expired at 12:00"));
    const err = await requireUser(
      post("{}", { authorization: "Bearer stale" }),
    ).catch((e) => e);
    expect(err.code).toBe("unauthenticated");
    expect(err.message).toBe("Sign in required.");
  });

  it("returns the uid for a valid token", async () => {
    verifyIdToken.mockResolvedValue({ uid: "u1", admin: false });
    await expect(
      requireUser(post("{}", { authorization: "Bearer good" })),
    ).resolves.toMatchObject({ uid: "u1" });
    expect(verifyIdToken).toHaveBeenCalledWith("good");
  });

  it("accepts a lower-case bearer scheme", async () => {
    verifyIdToken.mockResolvedValue({ uid: "u2" });
    await expect(
      requireUser(post("{}", { authorization: "bearer good" })),
    ).resolves.toMatchObject({ uid: "u2" });
  });
});
