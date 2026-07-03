import type { AuthController } from "../controllers/AuthController.js"

interface Router {
  post: (path: string, handler: Function) => void
}

export function registerAuthRoutes(ctrl: AuthController, router: Router): void {
  router.post("/auth/login", (req: unknown) => ctrl.login(req as any))
  router.post("/auth/refresh", (req: unknown) => ctrl.refresh(req as any))
  router.post("/auth/logout", (req: unknown) => ctrl.logout(req as any))
}
