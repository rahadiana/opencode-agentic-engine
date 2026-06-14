import type { User, Session, AuditLog, Config, WebhookPayload } from "../types"

export class ConfigModel {
  private data: Map<string, unknown> = new Map()
  async find(id: string): Promise<unknown> { return this.data.get(id) ?? null }
  async create(item: unknown & { id: string }): Promise<unknown> { this.data.set(item.id, item); return item }
  async update(id: string, patch: Partial<unknown>): Promise<unknown> { const prev = this.data.get(id) ?? {}; const next = { ...prev, ...patch }; this.data.set(id, next); return next }
  async delete(id: string): Promise<boolean> { return this.data.delete(id) }
  async list(): Promise<unknown[]> { return [...this.data.values()] }
}
