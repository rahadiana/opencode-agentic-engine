import { authConfig } from "../config/auth.js"
import {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  createJWT,
  type JwtPayload,
} from "../utils/jwt.js"

export interface TokenPair {
  accessToken: string
  refreshToken: string
  expiresAt: Date
}

interface RefreshRecord {
  tokenHash: string
  userId: string
  expiresAt: Date
  revoked: boolean
}

/**
 * Simple in-memory JWT-based authentication service.
 * Supports access/refresh token pairs with revocation.
 */
export class AuthService {
  /** Track refresh tokens for revocation (never store access tokens) */
  private refreshStore = new Map<string, RefreshRecord>()

  /** Simple user store for demo purposes */
  private users = new Map<string, { email: string; password: string; name: string; role: string }>()

  constructor() {
    // Seed a demo user
    this.users.set("user-1", {
      email: "test@test.com",
      password: "pass",
      name: "Test User",
      role: "user",
    })
    this.users.set("admin-1", {
      email: "admin@test.com",
      password: "admin",
      name: "Admin User",
      role: "admin",
    })
  }

  /**
   * Authenticate a user with email and password.
   * Returns a JWT access + refresh token pair.
   */
  login(email: string, password: string, userId?: string): TokenPair {
    // Find user by credentials
    let user: { email: string; password: string; name: string; role: string } | undefined
    let uid = userId

    if (uid) {
      user = this.users.get(uid)
    } else {
      for (const [id, u] of this.users) {
        if (u.email === email && u.password === password) {
          user = u
          uid = id
          break
        }
      }
    }

    if (!user || !uid) {
      throw new Error("Invalid credentials")
    }

    return this.createTokenPair(uid, user.role, user.email)
  }

  /**
   * Validate an access token.
   * Returns the session info if valid, null otherwise.
   */
  validate(token: string): { userId: string; expiresAt: Date } | null {
    const payload = verifyAccessToken(token, authConfig.jwtSecret)
    if (!payload || !payload.userId) return null

    return {
      userId: payload.userId,
      expiresAt: new Date((payload.exp ?? 0) * 1000),
    }
  }

  /**
   * Refresh an access token using a valid refresh token.
   * Revokes the old refresh token and issues a new pair.
   */
  refreshToken(refreshToken: string): TokenPair | null {
    const payload = verifyRefreshToken(refreshToken, authConfig.jwtSecret)
    if (!payload || !payload.userId) return null

    // Check revocation store
    const record = this.refreshStore.get(payload.jti ?? "")
    if (!record || record.revoked) return null

    // Revoke the old refresh token (rotation)
    record.revoked = true

    // Get user info
    const user = this.users.get(payload.userId)
    if (!user) return null

    return this.createTokenPair(payload.userId, payload.role as string ?? user.role, payload.email as string ?? user.email)
  }

  /**
   * Logout by revoking the refresh token.
   */
  logout(refreshToken: string): void {
    const payload = verifyRefreshToken(refreshToken, authConfig.jwtSecret)
    if (!payload || !payload.jti) return

    const record = this.refreshStore.get(payload.jti)
    if (record) {
      record.revoked = true
    }
  }

  /**
   * Logout all sessions for a user (revoke all refresh tokens).
   */
  logoutAll(userId: string): void {
    for (const [, record] of this.refreshStore) {
      if (record.userId === userId) {
        record.revoked = true
      }
    }
  }

  /**
   * Create an already-expired access token for testing expired-token scenarios.
   */
  createExpiredToken(userId: string): string {
    const payload: JwtPayload = {
      userId,
      sub: userId,
      type: "access",
      role: "user",
    }
    // Create a token that expired 1 hour ago
    return createJWT(payload, authConfig.jwtSecret, "-1h")
  }

  /** Check if a refresh token is still valid (not revoked) */
  isRefreshTokenValid(token: string): boolean {
    const payload = verifyRefreshToken(token, authConfig.jwtSecret)
    if (!payload || !payload.jti) return false
    const record = this.refreshStore.get(payload.jti)
    return !!record && !record.revoked
  }

  /** Count active sessions for a user */
  activeSessionCount(userId: string): number {
    let count = 0
    for (const [, record] of this.refreshStore) {
      if (record.userId === userId && !record.revoked) {
        count++
      }
    }
    return count
  }

  // ── Private helpers ──

  private createTokenPair(userId: string, role: string, email: string): TokenPair {
    const basePayload: JwtPayload = { userId, sub: userId, role, email }

    const accessToken = generateAccessToken(basePayload, { secret: authConfig.jwtSecret })
    const decodedRefresh = generateRefreshToken(basePayload, { secret: authConfig.jwtSecret })
    const refreshPayload = verifyRefreshToken(decodedRefresh, authConfig.jwtSecret)!

    // Store refresh token for revocation tracking
    const now = Math.floor(Date.now() / 1000)
    this.refreshStore.set(refreshPayload.jti!, {
      tokenHash: decodedRefresh.slice(-16), // only store suffix for identification
      userId,
      expiresAt: new Date((refreshPayload.exp ?? now) * 1000),
      revoked: false,
    })

    return {
      accessToken,
      refreshToken: decodedRefresh,
      expiresAt: new Date((refreshPayload.exp ?? now + 7 * 86400) * 1000),
    }
  }
}
