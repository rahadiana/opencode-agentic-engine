import type { Result } from "../types"

export class AuditController {
  async handle(req: { body?: unknown; params?: Record<string, string>; query?: Record<string, string> }): Promise<Result<unknown>> {
    try {
      const result = await this.execute(req)
      return { ok: true, value: result }
    } catch (e: unknown) {
      return { ok: false, error: { code: "CTRL_ERR", message: (e as Error).message, status: 500 } }
    }
  }

  private async execute(req: unknown): Promise<unknown> {
    return { controller: "AuditController", handled: true }
  }
}
