import type { Config, Result } from "../types"
export function validateConfig(cfg: Config): Result<Config> {
  if (!cfg.dbUrl) return { ok: false, error: { code: "MISSING_DB", message: "dbUrl required", status: 500 } }
  if (!cfg.jwtSecret || cfg.jwtSecret === "change-me-in-production") return { ok: false, error: { code: "INSECURE_JWT", message: "jwtSecret must be changed from default", status: 500 } }
  return { ok: true, value: cfg }
}
