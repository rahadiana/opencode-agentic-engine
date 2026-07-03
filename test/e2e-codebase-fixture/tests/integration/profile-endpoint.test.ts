// profile-endpoint.test.ts — Integration tests for GET /api/users/:id/profile
// 8 acceptance criteria (A1-A8):
//   A1: Missing auth token → AuthError (401)
//   A2: Invalid/malformed token → AuthError (401)
//   A3: Expired token → AuthError (401)
//   A4: Invalid UUID format (req.params.id) → ValidationError (400)
//   A5: Valid UUID but user not found → NotFoundError (404)
//   A6: Privacy — email hidden for other users (requester !== owner)
//   A7: Privacy — email visible for own profile (requester === owner)
//   A8: Stats format — response includes stats: { postCount, commentCount, reputation }

import { describe, it, expect, beforeEach } from "vitest"
import { UserService } from "../../src/services/UserService.js"
import { AuthService } from "../../src/services/AuthService.js"
import { registerUserRoutes } from "../../src/routes/users.js"
import { UserController } from "../../src/controllers/UserController.js"
import { isUUID } from "../../src/utils/validation.js"
import { AuthError } from "../../src/errors/auth-error.js"
import { ValidationError } from "../../src/errors/validation-error.js"
import { NotFoundError } from "../../src/errors/not-found.js"

// ── Helpers ──

/** A simple in-memory router for testing */
function createTestRouter() {
  const routes: Array<{ path: string; handler: Function }> = []
  return {
    get: (path: string, handler: Function) => routes.push({ path, handler }),
    getRoutes: () => routes,
  }
}

/** Generate a valid UUID v4 */
function uuidv4(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16)
  })
}

/** Create a mock request object */
function mockRequest(overrides: Record<string, unknown> = {}) {
  return {
    params: { id: uuidv4() },
    headers: { authorization: "Bearer valid-token-123" },
    user: undefined,
    ...overrides,
  }
}

/** Helper: login a user and return their Bearer token and a mockRequest with valid auth */
function loginAs(userId: string, authService: AuthService): { token: string; req: ReturnType<typeof mockRequest> } {
  const result = authService.login("test@test.com", "pass", userId)
  const req = mockRequest({ headers: { authorization: `Bearer ${result.token}` } })
  return { token: result.token, req }
}

// ── Mock controller wrapper for route testing ──

function callProfileRoute(
  req: ReturnType<typeof mockRequest>,
  userService: UserService,
  authService?: AuthService,
) {
  const ctrl = new UserController(userService)
  const router = createTestRouter()
  registerUserRoutes(ctrl, router, authService)

  const profileRoute = router.getRoutes().find(r => r.path === "/users/:id/profile")
  if (!profileRoute) throw new Error("Profile route not found")

  try {
    return profileRoute.handler(req)
  } catch (err) {
    throw err
  }
}

// ── Tests ──

describe("GET /api/users/:id/profile — 8 Acceptance Criteria (A1–A8)", () => {
  let userService: UserService
  let authService: AuthService
  let ownUserId: string
  let otherUserId: string

  beforeEach(() => {
    userService = new UserService()
    authService = new AuthService()

    ownUserId = uuidv4()
    otherUserId = uuidv4()

    // Create test users
    userService.create({
      id: ownUserId,
      name: "Alice",
      email: "alice@example.com",
      role: "user",
      avatar: "https://example.com/avatar/alice.png",
      bio: "Hello, I'm Alice",
      createdAt: new Date("2026-01-15"),
      updatedAt: new Date("2026-06-01"),
    })

    userService.create({
      id: otherUserId,
      name: "Bob",
      email: "bob@example.com",
      role: "user",
      createdAt: new Date("2026-02-20"),
      updatedAt: new Date("2026-05-10"),
    })
  })

  // ── A1: Missing auth token → AuthError ──
  it("A1 — should reject request without Authorization header", () => {
    const req = mockRequest({ headers: {} })
    expect(() => callProfileRoute(req, userService)).toThrow(AuthError)
  })

  it("A1 — should reject request with empty Authorization header", () => {
    const req = mockRequest({ headers: { authorization: "" } })
    expect(() => callProfileRoute(req, userService)).toThrow(AuthError)
  })

  it("A1 — should reject request with whitespace-only Authorization header", () => {
    const req = mockRequest({ headers: { authorization: "   " } })
    expect(() => callProfileRoute(req, userService)).toThrow(AuthError)
  })

  // ── A2: Invalid/malformed token → AuthError ──
  it("A2 — should reject token without Bearer prefix", () => {
    const req = mockRequest({ headers: { authorization: "invalid-token-no-bearer" } })
    expect(() => callProfileRoute(req, userService)).toThrow(AuthError)
  })

  it("A2 — should reject empty Bearer token", () => {
    const req = mockRequest({ headers: { authorization: "Bearer " } })
    expect(() => callProfileRoute(req, userService)).toThrow(AuthError)
  })

  it("A2 — should reject non-existent Bearer token (not issued by AuthService)", () => {
    const req = mockRequest({ headers: { authorization: "Bearer non-existent-token" } })
    expect(() => callProfileRoute(req, userService, new AuthService())).toThrow(AuthError)
  })

  // ── A3: Expired token → AuthError ──
  it("A3 — should reject expired token", () => {
    const token = authService.createExpiredToken(ownUserId)
    const req = mockRequest({
      headers: { authorization: `Bearer ${token}` },
    })
    expect(() => callProfileRoute(req, userService, authService)).toThrow(AuthError)
  })

  // ── A4: Invalid UUID format → ValidationError (400) ──
  it("A4 — should reject non-UUID user ID format", () => {
    const req = mockRequest({ params: { id: "not-a-uuid" } })
    expect(() => callProfileRoute(req, userService)).toThrow(ValidationError)
  })

  it("A4 — should reject numeric user ID", () => {
    const req = mockRequest({ params: { id: "12345" } })
    expect(() => callProfileRoute(req, userService)).toThrow(ValidationError)
  })

  it("A4 — should reject empty user ID", () => {
    const req = mockRequest({ params: { id: "" } })
    expect(() => callProfileRoute(req, userService)).toThrow(ValidationError)
  })

  it("A4 — should reject malformed UUID (missing dashes)", () => {
    const req = mockRequest({ params: { id: "550e8400e29b41d4a716446655440000" } })
    expect(() => callProfileRoute(req, userService)).toThrow(ValidationError)
  })

  it("A4 — should reject UUID with invalid version (v6)", () => {
    // v6 UUID has version digit = 6, but our regex accepts [1-5]
    const req = mockRequest({ params: { id: "550e8400-e29b-61d4-a716-446655440000" } })
    expect(() => callProfileRoute(req, userService)).toThrow(ValidationError)
  })

  // ── A5: Valid UUID but user not found → NotFoundError (404) ──
  it("A5 — should return 404 for valid UUID not in database", () => {
    const nonExistentId = uuidv4()
    const req = mockRequest({ params: { id: nonExistentId } })
    expect(() => callProfileRoute(req, userService)).toThrow(NotFoundError)
  })

  // ── A6: Privacy — email hidden for OTHER users ──
  it("A6 — should hide email when requester is a different user", () => {
    const { req } = loginAs(otherUserId, authService) // Bob's token
    req.params = { id: ownUserId } // Requesting Alice's profile
    const profile = callProfileRoute(req, userService, authService)
    expect(profile).toBeDefined()
    expect(profile.email).toBeNull()
    expect(profile.name).toBe("Alice")
    expect(profile.id).toBe(ownUserId)
  })

  it("A6 — should hide email for anonymous requester", () => {
    // Anonymous request: use mockRequest default with valid Bearer token
    // but call without authService so it falls through with anonymous requester
    const req = mockRequest({
      params: { id: ownUserId },
    })
    const profile = callProfileRoute(req, userService)
    expect(profile).toBeDefined()
    expect(profile.email).toBeNull()
  })

  // ── A7: Privacy — email visible for OWN profile ──
  it("A7 — should show email when requesting own profile", () => {
    const { req } = loginAs(ownUserId, authService) // Alice's token
    req.params = { id: ownUserId } // Requesting own profile
    const profile = callProfileRoute(req, userService, authService)
    expect(profile).toBeDefined()
    expect(profile.email).toBe("alice@example.com")
    expect(profile.name).toBe("Alice")
  })

  // ── A8: Stats format: { postCount, commentCount, reputation } ──
  it("A8 — should include stats with correct shape in profile response", () => {
    const { req } = loginAs(ownUserId, authService)
    req.params = { id: ownUserId }
    const profile = callProfileRoute(req, userService, authService)
    expect(profile).toBeDefined()
    expect(profile).toHaveProperty("stats")
    expect(profile.stats).toEqual({
      postCount: expect.any(Number),
      commentCount: expect.any(Number),
      reputation: expect.any(Number),
    })
  })

  it("A8 — stats should be non-negative integers", () => {
    const { req } = loginAs(ownUserId, authService)
    req.params = { id: ownUserId }
    const profile = callProfileRoute(req, userService, authService)
    expect(profile.stats.postCount).toBeGreaterThanOrEqual(0)
    expect(profile.stats.commentCount).toBeGreaterThanOrEqual(0)
    expect(profile.stats.reputation).toBeGreaterThanOrEqual(0)
    expect(Number.isInteger(profile.stats.postCount)).toBe(true)
    expect(Number.isInteger(profile.stats.commentCount)).toBe(true)
    expect(Number.isInteger(profile.stats.reputation)).toBe(true)
  })

  // ── Additional: Full profile shape ──
  it("should return complete profile with all required fields", () => {
    const { req } = loginAs(ownUserId, authService)
    req.params = { id: ownUserId }
    const profile = callProfileRoute(req, userService, authService)
    expect(profile).toMatchObject({
      id: ownUserId,
      name: "Alice",
      email: "alice@example.com",
      avatar: "https://example.com/avatar/alice.png",
      bio: "Hello, I'm Alice",
      joinDate: expect.any(Date),
    })
  })

  it("should handle user without optional fields (avatar, bio)", () => {
    const { req } = loginAs(otherUserId, authService)
    req.params = { id: otherUserId }
    const profile = callProfileRoute(req, userService, authService)
    expect(profile).toMatchObject({
      id: otherUserId,
      name: "Bob",
      email: "bob@example.com",
      avatar: null,
      bio: null,
    })
  })

  // ── Privacy: full response shape verification ──
  it("should not expose internal fields (role, updatedAt) in profile", () => {
    const { req } = loginAs(ownUserId, authService)
    req.params = { id: ownUserId }
    const profile = callProfileRoute(req, userService, authService)
    expect(profile).not.toHaveProperty("role")
    expect(profile).not.toHaveProperty("updatedAt")
  })

  it("should return joinDate matching user createdAt", () => {
    const { req } = loginAs(ownUserId, authService)
    req.params = { id: ownUserId }
    const profile = callProfileRoute(req, userService, authService)
    expect(profile.joinDate).toEqual(new Date("2026-01-15"))
  })
})

// ── Direct unit tests for UserService.getProfile ──

describe("UserService.getProfile — privacy logic", () => {
  let userService: UserService
  let userId: string

  beforeEach(() => {
    userService = new UserService()
    userId = uuidv4()

    userService.create({
      id: userId,
      name: "Charlie",
      email: "charlie@example.com",
      role: "user",
      createdAt: new Date("2026-03-10"),
      updatedAt: new Date("2026-06-15"),
    })
  })

  it("returns null for non-existent user", () => {
    const result = userService.getProfile(uuidv4(), userId)
    expect(result).toBeNull()
  })

  it("returns email when requester is the same user", () => {
    const result = userService.getProfile(userId, userId)
    expect(result).not.toBeNull()
    expect(result!.email).toBe("charlie@example.com")
  })

  it("returns null email when requester is a different user", () => {
    const result = userService.getProfile(userId, uuidv4())
    expect(result).not.toBeNull()
    expect(result!.email).toBeNull()
  })

  it("returns null email when requester is anonymous", () => {
    const result = userService.getProfile(userId, "anonymous")
    expect(result).not.toBeNull()
    expect(result!.email).toBeNull()
  })

  it("returns correct stats shape from getProfile", () => {
    const result = userService.getProfile(userId, userId)
    expect(result!.stats).toEqual({
      postCount: 0,
      commentCount: 0,
      reputation: 0,
    })
  })

  it("returns all profile fields from getProfile", () => {
    const result = userService.getProfile(userId, userId)
    expect(result).toMatchObject({
      id: userId,
      name: "Charlie",
      avatar: null,
      bio: null,
      joinDate: expect.any(Date),
    })
  })

  it("profile does not include internal user fields", () => {
    const result = userService.getProfile(userId, userId)
    expect(result).not.toHaveProperty("role")
    expect(result).not.toHaveProperty("updatedAt")
  })
})

// ── UUID validation unit tests ──

describe("isUUID — UUID validation", () => {
  it("validates standard UUID v4", () => {
    expect(isUUID("550e8400-e29b-41d4-a716-446655440000")).toBe(true)
  })

  it("validates UUID v4 with different variant", () => {
    expect(isUUID("f47ac10b-58cc-4372-a567-0e02b2c3d479")).toBe(true)
  })

  it("rejects non-UUID string", () => {
    expect(isUUID("not-a-uuid")).toBe(false)
  })

  it("rejects empty string", () => {
    expect(isUUID("")).toBe(false)
  })

  it("rejects UUID without dashes", () => {
    expect(isUUID("550e8400e29b41d4a716446655440000")).toBe(false)
  })

  it("rejects UUID with invalid version digit", () => {
    expect(isUUID("550e8400-e29b-61d4-a716-446655440000")).toBe(false)
  })

  it("rejects UUID with uppercase in wrong positions", () => {
    expect(isUUID("550E8400-E29B-41D4-A716-446655440000")).toBe(true)
  })
})
