/**
 * Lightweight Event Bus — generalisasi pola BudgetTracker hook listener.
 *
 * BudgetTracker membuktikan bahwa Producer (LLMEngine/Executor) bisa emit
 * data → Consumer (BudgetTracker) auto-update tanpa LLM harus manual chaining.
 * EventBus menggeneralisasi ini: siapapun bisa emit, siapapun bisa subscribe.
 */
import type { AgenticEvent } from "./event-taxonomy.js"

type EventHandler = (event: AgenticEvent) => void | Promise<void>

export class EventBus {
  private subscribers = new Map<string, Set<EventHandler>>()
  private history: AgenticEvent[] = []
  private maxHistory = 200

  /** Subscribe ke satu event type */
  on(type: string, handler: EventHandler): () => void {
    if (!this.subscribers.has(type)) {
      this.subscribers.set(type, new Set())
    }
    this.subscribers.get(type)!.add(handler)
    return () => { this.subscribers.get(type)?.delete(handler) }
  }

  /** Subscribe ke semua event (wildcard) */
  onAny(handler: EventHandler): () => void {
    return this.on("*", handler)
  }

  /** Emit event — synchronous, non-blocking (tidak await Promise) */
  emit(event: AgenticEvent): void {
    // Record historia
    if (this.history.length >= this.maxHistory) {
      this.history.shift()
    }
    this.history.push(event)

    // Panggil subscriber spesifik
    const specific = this.subscribers.get(event.type)
    if (specific) {
      for (const handler of specific) {
        try {
          const result = handler(event)
          if (result instanceof Promise) {
            result.catch(e => console.error(`[EventBus] subscriber error on ${event.type}:`, e))
          }
        } catch (e) {
          console.error(`[EventBus] subscriber error on ${event.type}:`, e)
        }
      }
    }

    // Panggil wildcard subscriber
    const wildcard = this.subscribers.get("*")
    if (wildcard) {
      for (const handler of wildcard) {
        try {
          const result = handler(event)
          if (result instanceof Promise) {
            result.catch(e => console.error(`[EventBus] wildcard subscriber error:`, e))
          }
        } catch (e) {
          console.error(`[EventBus] wildcard subscriber error:`, e)
        }
      }
    }
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
}
