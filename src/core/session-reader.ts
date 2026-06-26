/**
 * SessionReader — membaca session info (cost + model) langsung dari OpenCode.
 *
 * Daripada plugin tracking cost sendiri (yg sering mismatch), kita baca aja
 * dari OpenCode-native yang udah akurat (source of truth).
 *
 * Data berasal dari:
 *   - OpenCode SDK: `client.session.get({ path: { id: sessionID } })`
 *   - Fallback: HTTP API `GET /v2/session/{id}`
 *
 * Schema response (dari SessionV2 / OpenAPI):
 *   {
 *     cost: number,                          // total spent USD
 *     model: { id: string, providerID: string, variant?: string },
 *     tokens: { input, output, reasoning, cache: { read, write } },
 *     title: string,
 *     agent: string,
 *     time: { created, updated },
 *     ...
 *   }
 */

import type { BudgetTracker } from "./budget-tracker.js"

export interface OpenCodeSessionInfo {
  /** Total cost in USD (dari OpenCode session.cost) */
  cost: number
  /** Current model info */
  model: {
    id: string
    providerID: string
    variant?: string
  }
  /** Token breakdown */
  tokens: {
    input: number
    output: number
    reasoning: number
    cache: {
      read: number
      write: number
    }
  }
  /** Session metadata */
  title?: string
  agent?: string
}

export class SessionReader {
  private opencodeClient: unknown = null
  private pluginSessionId: string | null = null
  private budgetTracker?: BudgetTracker

  /** Cache session info — refresh setiap 5 detik */
  private cachedInfo: { timestamp: number; data: OpenCodeSessionInfo } | null = null
  private readonly CACHE_TTL = 5_000

  setOpencodeClient(client: unknown): void {
    this.opencodeClient = client
  }

  setSessionId(id: string): void {
    this.pluginSessionId = id
  }

  setBudgetTracker(tracker: BudgetTracker): void {
    this.budgetTracker = tracker
  }

  /**
   * Baca session info dari OpenCode SDK.
   * Returns null kalo gagal / belum siap.
   */
  async readSessionInfo(): Promise<OpenCodeSessionInfo | null> {
    // Cache hit?
    if (this.cachedInfo && Date.now() - this.cachedInfo.timestamp < this.CACHE_TTL) {
      return this.cachedInfo.data
    }

    try {
      const info = await this.fetchFromSDK()
      if (info) {
        this.cachedInfo = { timestamp: Date.now(), data: info }
        return info
      }
    } catch {
      // Silent — fallback ke data yang ada
    }

    // Fallback: balikin cache lama (meski expired)
    return this.cachedInfo?.data ?? null
  }

  /** Invalidate cache paksa (misal abis LLM call) */
  invalidateCache(): void {
    this.cachedInfo = null
  }

  /**
   * Sync cost + model dari OpenCode ke BudgetTracker.
   * Dipanggil setelah setiap LLM call.
   */
  async syncToBudgetTracker(): Promise<void> {
    if (!this.budgetTracker) return

    const info = await this.readSessionInfo()
    if (!info) return

    // Sync model — set sebagai default model buat tracker
    const modelId = `${info.model.providerID}/${info.model.id}`
    this.budgetTracker.syncFromOpenCode(modelId, info.cost, info.tokens)
  }

  /**
   * Dapetin model string dari OpenCode session.
   * Format: "providerID/modelID" (e.g. "opencode/deepseek-v4-flash-free")
   */
  async getCurrentModel(): Promise<string | null> {
    const info = await this.readSessionInfo()
    if (!info?.model) return null
    const { providerID, id } = info.model
    return `${providerID}/${id}`
  }

  /**
   * List semua model yang tersedia dari OpenCode SDK.
   * Returns array [{ id, providerID, providerName }] atau [] kalau gagal.
   */
  async listModels(): Promise<Array<{ id: string; providerID: string; providerName: string }>> {
    try {
      const sdk = this.opencodeClient as {
        config?: {
          providers?: () => Promise<{
            data?: {
              providers: Array<{ name: string; id: string; models?: Record<string, unknown> }>
              default?: Record<string, string>
            }
          }>
        }
        models?: () => Promise<Array<{ id: string }>>
      }

      const result: Array<{ id: string; providerID: string; providerName: string }> = []

      // 1. Coba dari client.config.providers() — paling lengkap
      // SDK response: { data: { providers: [...], default: {...} } }
      if (sdk?.config?.providers) {
        const resp = await sdk.config.providers()
        const providers = resp?.data?.providers ?? []
        for (const p of providers) {
          if (p.models) {
            for (const modelKey of Object.keys(p.models)) {
              const id = modelKey.includes("/") ? modelKey.split("/").pop()! : modelKey
              result.push({ id, providerID: p.id, providerName: p.name })
            }
          }
        }
      }

      // 2. Fallback: client.models()
      if (result.length === 0 && typeof sdk?.models === "function") {
        const models = await sdk.models()
        for (const m of models) {
          const id = m.id.includes("/") ? m.id.split("/").pop()! : m.id
          if (!result.some(r => r.id === id)) {
            result.push({ id, providerID: "opencode", providerName: "OpenCode" })
          }
        }
      }

      return result
    } catch {
      return []
    }
  }

  // ── Private: fetch dari SDK ──

  private async fetchFromSDK(): Promise<OpenCodeSessionInfo | null> {
    if (!this.opencodeClient || !this.pluginSessionId) return null

    const sdk = this.opencodeClient as {
      session?: {
        get: (opts: {
          path: { id: string }
          throwOnError?: boolean
        }) => Promise<{
          data?: {
            cost?: number | null
            model?: { id?: string; providerID?: string; variant?: string } | null
            tokens?: {
              input?: number
              output?: number
              reasoning?: number
              cache?: { read?: number; write?: number }
            } | null
            title?: string
            agent?: string
          }
        }>
      }
    }

    if (!sdk.session?.get) return null

    const resp = await sdk.session.get({
      path: { id: this.pluginSessionId },
      throwOnError: false,
    })

    const d = resp?.data
    if (!d) return null

    return {
      cost: d.cost ?? 0,
      model: {
        id: d.model?.id ?? "unknown",
        providerID: d.model?.providerID ?? "opencode",
        variant: d.model?.variant,
      },
      tokens: {
        input: d.tokens?.input ?? 0,
        output: d.tokens?.output ?? 0,
        reasoning: d.tokens?.reasoning ?? 0,
        cache: {
          read: d.tokens?.cache?.read ?? 0,
          write: d.tokens?.cache?.write ?? 0,
        },
      },
      title: d.title,
      agent: d.agent,
    }
  }
}
