import type { Result, ApiError, User, AuditLog } from "../types"

export function CorsMiddleware(): (ctx: unknown, next: () => Promise<void>) => Promise<Result<void>> {
  return async (ctx, next) => {
    const start = Date.now()
    try {
      await next()
      return { ok: true, value: undefined }
    } catch (e: unknown) {
      return { ok: false, error: { code: "MW_ERR", message: "CorsMiddleware error", status: 500 } }
    } finally {
      const elapsed = Date.now() - start
      if (elapsed > 1000) console.warn("CorsMiddleware: slow request ", elapsed, "ms")
    }
  }
}
