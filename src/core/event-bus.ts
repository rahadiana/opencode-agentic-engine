/**
 * Lightweight Event Bus — generalisasi pola BudgetTracker hook listener.
 *
 * BudgetTracker membuktikan bahwa Producer (LLMEngine/Executor) bisa emit
 * data → Consumer (BudgetTracker) auto-update tanpa LLM harus manual chaining.
 * EventBus menggeneralisasi ini: siapapun bisa emit, siapapun bisa subscribe.
 */
import { createLogger } from "../observability/logger.js"
import type { AgenticEvent } from "./event-taxonomy.js"

const log = createLogger("EventBus")

type EventHandler = (event: AgenticEvent) => void | Promise<void>

export class EventBus {
  private subscribers = new Map<string, Map<string, EventHandler>>()
  private history: AgenticEvent[] = []
  private maxHistory = 200
  private subscriberIdCounter = 0

  /** Subscribe ke satu event type. Returns unsubscribe function. */
  on(type: string, handler: EventHandler): () => void {
    if (!this.subscribers.has(type)) {
      this.subscribers.set(type, new Map())
    }
    const id = `sub_${++this.subscriberIdCounter}`
    this.subscribers.get(type)!.set(id, handler)
    return () => { this.subscribers.get(type)?.delete(id) }
  }

  /** Subscribe ke semua event (wildcard) */
  onAny(handler: EventHandler): () => void {
    return this.on("*", handler)
  }

  /** Emit event — sequential but async-safe */
  emit(event: AgenticEvent): void {
    if (this.history.length >= this.maxHistory) {
      this.history.shift()
    }
    this.history.push(event)

    const emitTo = (handlers: Map<string, EventHandler> | undefined) => {
      if (!handlers) return
      for (const [, handler] of handlers) {
        try {
          const result = handler(event)
          if (result instanceof Promise) {
            result.catch(e => log.error(`subscriber error on ${event.type}`, { error: e }))
          }
        } catch (e) {
          log.error(`subscriber error on ${event.type}`, { error: e })
        }
      }
    }

    emitTo(this.subscribers.get(event.type))
    emitTo(this.subscribers.get("*"))
  }

  /** Dapatkan history event terbaru, filter by type */
  getHistory(type?: string, limit = 50): AgenticEvent[] {
    if (type) {
      return this.history.filter(e => e.type === type).slice(-limit)
    }
    return this.history.slice(-limit)
  }

  /** Hapus semua subscriber */
  clear(): void {
    this.subscribers.clear()
    this.history = []
  }

  /** Jumlah subscriber aktif */
  get subscriberCount(): number {
    let count = 0
    for (const set of this.subscribers.values()) {
      count += set.size
    }
    return count
  }

  /** Setel ulang max history */
  setMaxHistory(max: number): void {
    this.maxHistory = max
    if (this.history.length > max) {
      this.history = this.history.slice(-max)
    }
  }
}
