import type { AuthService } from "../services/AuthService.js";
import { AuthError } from "../errors/auth-error.js";

/**
 * Bearer token authentication middleware.
 * Extracts and validates the Bearer token from the Authorization header.
 * Sets `req.user` to the authenticated userId on success.
 *
 * @param auth - Optional AuthService. If omitted, skips validation (anonymous fallback).
 * @throws AuthError if token is missing, malformed, expired, or invalid.
 */
export function authMiddleware(auth?: AuthService) {
  return (req: { headers: Record<string, string>; user?: string }): void => {
    const header = req.headers["authorization"];

    // ── Missing / empty header ──
    if (!header || header.trim().length === 0) {
      throw new AuthError("Missing authorization header")
    }

    // ── Must be Bearer format ──
    if (!header.startsWith("Bearer ")) {
      throw new AuthError("Invalid token format: expected Bearer token")
    }

    const token = header.slice("Bearer ".length).trim()
    if (!token) {
      throw new AuthError("Invalid token format: empty Bearer token")
    }

    // ── Validate against AuthService if provided ──
    if (auth) {
      const session = auth.validate(token)
      if (!session) {
        throw new AuthError("Token expired or invalid")
      }
      if (new Date() > session.expiresAt) {
        throw new AuthError("Token expired")
      }
      req.user = session.userId
    }
  };
}
