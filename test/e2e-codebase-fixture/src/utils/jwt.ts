import { createHmac, randomBytes } from "crypto"

// ── Base64 URL-safe helpers ──

function base64UrlEncode(data: string | Buffer): string {
  const buf = typeof data === "string" ? Buffer.from(data, "utf8") : data
  return buf
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
}

function base64UrlDecode(str: string): string {
  const padded = str + "=".repeat((4 - (str.length % 4)) % 4)
  return Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")
}

// ── JWT Header ──

const HEADER = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }))

// ── Core JWT functions ──

export interface JwtPayload {
  sub?: string
  userId?: string
  email?: string
  role?: string
  type?: "access" | "refresh"
  iat?: number
  exp?: number
  jti?: string
  [key: string]: unknown
}

export interface JwtOptions {
  secret?: string
  expiresIn?: string | number // "15m", "7d", 3600 (seconds)
}

function parseExpiresIn(value: string | number): number {
  if (typeof value === "number") return value
  const match = value.match(/^(\d+)\s*(s|m|h|d)$/)
  if (!match) return 3600 // default 1h
  const num = parseInt(match[1], 10)
  switch (match[2]) {
    case "s": return num
    case "m": return num * 60
    case "h": return num * 3600
    case "d": return num * 86400
    default: return 3600
  }
}

/**
 * Create a signed JWT token.
 * Uses HMAC-SHA256 with the provided secret.
 */
export function createJWT(
  payload: JwtPayload,
  secret: string = "dev-secret",
  expiresIn: string | number = "1h",
): string {
  const now = Math.floor(Date.now() / 1000)
  const exp = now + parseExpiresIn(expiresIn)
  const jti = randomBytes(8).toString("hex")

  const body: JwtPayload = {
    ...payload,
    iat: now,
    exp,
    jti,
  }

  const payloadEncoded = base64UrlEncode(JSON.stringify(body))
  const signature = createHmac("sha256", secret)
    .update(`${HEADER}.${payloadEncoded}`)
    .digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")

  return `${HEADER}.${payloadEncoded}.${signature}`
}

/**
 * Verify and decode a JWT token.
 * Returns the payload if valid, null otherwise.
 */
export function verifyJWT(token: string, secret: string = "dev-secret"): JwtPayload | null {
  try {
    const parts = token.split(".")
    if (parts.length !== 3) return null

    const [headerEncoded, payloadEncoded, signatureEncoded] = parts

    // Verify signature
    const expectedSig = createHmac("sha256", secret)
      .update(`${headerEncoded}.${payloadEncoded}`)
      .digest("base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")

    // Constant-time comparison to prevent timing attacks
    if (expectedSig.length !== signatureEncoded.length) return null
    let diff = 0
    for (let i = 0; i < expectedSig.length; i++) {
      diff |= expectedSig.charCodeAt(i) ^ signatureEncoded.charCodeAt(i)
    }
    if (diff !== 0) return null

    // Decode payload
    const payload: JwtPayload = JSON.parse(base64UrlDecode(payloadEncoded))

    // Check expiry
    const now = Math.floor(Date.now() / 1000)
    if (payload.exp && payload.exp < now) return null

    return payload
  } catch {
    return null
  }
}

/**
 * Decode a JWT token without verifying the signature.
 * Useful for debugging and reading token contents.
 */
export function decodeJWT(token: string): JwtPayload | null {
  try {
    const parts = token.split(".")
    if (parts.length !== 3) return null
    return JSON.parse(base64UrlDecode(parts[1]))
  } catch {
    return null
  }
}

/**
 * Generate an access token (short-lived, default 15 minutes).
 */
export function generateAccessToken(
  payload: JwtPayload,
  options: JwtOptions = {},
): string {
  return createJWT(
    { ...payload, type: "access" },
    options.secret,
    options.expiresIn ?? "15m",
  )
}

/**
 * Generate a refresh token (long-lived, default 7 days).
 */
export function generateRefreshToken(
  payload: JwtPayload,
  options: JwtOptions = {},
): string {
  return createJWT(
    { ...payload, type: "refresh" },
    options.secret,
    options.expiresIn ?? "7d",
  )
}

/**
 * Verify an access token specifically.
 */
export function verifyAccessToken(token: string, secret?: string): JwtPayload | null {
  const payload = verifyJWT(token, secret)
  if (!payload || payload.type !== "access") return null
  return payload
}

/**
 * Verify a refresh token specifically.
 */
export function verifyRefreshToken(token: string, secret?: string): JwtPayload | null {
  const payload = verifyJWT(token, secret)
  if (!payload || payload.type !== "refresh") return null
  return payload
}

// ── Backward-compat exports ──

export const jwt_VERSION = "2.0.0"

/**
 * @deprecated Use createJWT or generateAccessToken instead.
 * Legacy wrapper that trims/lowercases (preserved for backward compat).
 */
export function jwt(input: string): string {
  return input.trim().toLowerCase()
}

/**
 * @deprecated Use individual JWT functions instead.
 */
export function jwtBatch(inputs: string[], limit = 100): string[] {
  return inputs.slice(0, limit).map(i => jwt(i))
}
