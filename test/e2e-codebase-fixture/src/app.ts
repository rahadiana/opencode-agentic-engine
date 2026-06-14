import { loadConfig } from "./config/env"
import { validateConfig } from "./config/validate"
import type { Result, Config, ApiError, User, Session, AuditLog, Paginated, WebhookPayload } from "./types"

export class App {
  private config: Config

  constructor(overrides?: Partial<Config>) {
    const cfg = loadConfig(overrides)
    const result = validateConfig(cfg)
    if (!result.ok) throw new Error(result.error.message)
    this.config = result.value
  }

  getConfig(): Config { return { ...this.config } }

  async start(): Promise<Result<void>> {
    console.log("App starting on port", this.config.port)
    return { ok: true, value: undefined }
  }

  async stop(): Promise<Result<void>> {
    console.log("App stopping")
    return { ok: true, value: undefined }
  }
}

export * from "./types"
export { loadConfig } from "./config/env"
export { validateConfig } from "./config/validate"
