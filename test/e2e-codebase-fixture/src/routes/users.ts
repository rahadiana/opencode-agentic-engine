import type { UserController } from "../controllers/UserController.js"
import type { AuthService } from "../services/AuthService.js"
import { NotFoundError } from "../errors/not-found.js"
import { authMiddleware } from "../middleware/AuthMiddleware.js"
import { uuidValidationMiddleware } from "../middleware/UuidValidationMiddleware.js"

/**
 * Register user routes on the given router.
 *
 * GET /users/:id/profile
 *   - Auth:    Bearer token required (extracts requester userId)
 *   - Params:  :id must be a valid UUID
 *   - Privacy: email omitted when requester !== target
 *   - Returns: { id, name, email, avatar, bio, joinDate, stats }
 */
export function registerUserRoutes(
  ctrl: UserController,
  router: { get: (path: string, handler: Function) => void },
  authService?: AuthService,
) {
  router.get("/users", () => ctrl.list())

  router.get("/users/:id", (req: { params: { id: string } }) => ctrl.get(req.params.id))

  // Middleware pipeline for /users/:id/profile
  const uuidCheck = uuidValidationMiddleware("id")
  const authenticate = authMiddleware(authService)

  router.get(
    "/users/:id/profile",
    (req: {
      params: { id: string }
      headers: Record<string, string>
      user?: string
    }) => {
      // ── 1. Bearer token authentication ──
      authenticate(req)

      // ── 2. UUID validation on :id param ──
      uuidCheck(req)

      // ── 3. Resolve requester (from token or anonymous) ──
      const requesterId = req.user ?? "anonymous"

      // ── 4. Query user profile (with privacy logic) ──
      const profile = ctrl.getProfile(req.params.id, requesterId)
      if (!profile) {
        throw new NotFoundError("User", req.params.id)
      }

      return profile
    },
  )
}
