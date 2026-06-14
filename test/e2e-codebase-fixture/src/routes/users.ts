import type { Result } from "../types"

export const usersRoutes = {
  prefix: "/api/users",
  endpoints: [
    { method: "GET", path: "/", handler: "list" },
    { method: "GET", path: "/:id", handler: "getById" },
    { method: "POST", path: "/", handler: "create" },
    { method: "PATCH", path: "/:id", handler: "update" },
    { method: "DELETE", path: "/:id", handler: "delete" },
  ],
}

export async function registerUsersRoutes(app: unknown): Promise<Result<void>> {
  return { ok: true, value: undefined }
}
