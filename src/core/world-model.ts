/**
 * World Model + Belief State System (Comparison 19)
 *
 * Best practices applied:
 * - Externalized belief state (BDI / BeliefMem): beliefs stored outside LLM context
 * - Confidence scoring with [0, 1] range per belief
 * - Belief decay (confidence *= 0.98) prevents stale beliefs
 * - Conflict resolution: contradictory evidence reduces confidence
 * - Uncertainty threshold for reliability checks
 * - Evidence provenance tracking per belief
 *
 * References:
 * - Belief Memory: Agent Memory Under Partial Observability (arXiv:2605.05583v2)
 * - BDI (Belief-Desire-Intention) agent architecture
 * - Belief Engine: Bayesian Memory for LLM Agents (ICLR 2026)
 */

import crypto from "node:crypto"

// ── Types ────────────────────────────────────────────────────────────────

export interface Entity {
  id: string
  type: string
  name: string
  properties: Record<string, unknown>
  lastObserved: number
}

export interface Relation {
  id: string
  source: string   // entity ID
  target: string   // entity ID
  type: string
  properties: Record<string, unknown>
  lastObserved: number
}

export interface Belief {
  key: string
  fact: string
  confidence: number       // [0, 1]
  evidence: BeliefEvidence[]
  lastUpdated: number
  category: string         // e.g. "file_state", "agent_capability", "system_status"
}

export interface BeliefEvidence {
  source: string           // e.g. "execution_result", "user_input", "observation"
  value: string
  timestamp: number
  supports: boolean        // true = supports belief, false = contradicts
}

export interface WorldSnapshot {
  timestamp: number
  entities: Entity[]
  relations: Relation[]
  beliefs: Belief[]
}

export interface BeliefUpdateResult {
  key: string
  previousConfidence: number
  newConfidence: number
  changed: boolean
}

export interface WorldModelConfig {
  /** Default belief decay factor per cycle (default: 0.98) */
  beliefDecayFactor?: number
  /** Confidence threshold for isReliable() (default: 0.7) */
  reliabilityThreshold?: number
  /** Max entities before pruning oldest (default: 1000) */
  maxEntities?: number
  /** Max relations before pruning oldest (default: 2000) */
  maxRelations?: number
  /** Max beliefs before pruning lowest-confidence (default: 500) */
  maxBeliefs?: number
  /** Enable automatic belief decay on observe() (default: true) */
  autoDecay?: boolean
  /** Confidence penalty for contradictory evidence (default: 0.5) */
  conflictPenalty?: number
}

const DEFAULTS: Required<WorldModelConfig> = {
  beliefDecayFactor: 0.98,
  reliabilityThreshold: 0.7,
  maxEntities: 1000,
  maxRelations: 2000,
  maxBeliefs: 500,
  autoDecay: true,
  conflictPenalty: 0.5,
}

// ── WorldModel Class ─────────────────────────────────────────────────────

export class WorldModel {
  private entities = new Map<string, Entity>()
  private relations = new Map<string, Relation>()
  private beliefs = new Map<string, Belief>()
  private config: Required<WorldModelConfig>
  private cycleCount = 0

  constructor(config: WorldModelConfig = {}) {
    this.config = { ...DEFAULTS, ...config }
  }

  // ── Entity Management ─────────────────────────────────────────────────

  /** Add or update an entity */
  addEntity(type: string, name: string, properties: Record<string, unknown> = {}): Entity {
    const existing = [...this.entities.values()].find(
      e => e.type === type && e.name === name
    )
    if (existing) {
      existing.properties = { ...existing.properties, ...properties }
      existing.lastObserved = Date.now()
      return existing
    }

    const id = this._generateId("ent")
    const entity: Entity = {
      id, type, name, properties,
      lastObserved: Date.now(),
    }
    this.entities.set(id, entity)
    this._pruneEntities()
    return entity
  }

  /** Remove an entity and its relations */
  removeEntity(entityId: string): boolean {
    const existed = this.entities.delete(entityId)
    // Remove all relations involving this entity
    for (const [rid, rel] of this.relations) {
      if (rel.source === entityId || rel.target === entityId) {
        this.relations.delete(rid)
      }
    }
    return existed
  }

  /** Get entity by ID */
  getEntity(entityId: string): Entity | undefined {
    return this.entities.get(entityId)
  }

  /** Find entities by type */
  findEntities(type: string): Entity[] {
    return [...this.entities.values()].filter(e => e.type === type)
  }

  /** Get all entities */
  getAllEntities(): Entity[] {
    return [...this.entities.values()]
  }

  // ── Relation Management ───────────────────────────────────────────────

  /** Add or update a relation between two entities */
  addRelation(source: string, target: string, type: string, properties: Record<string, unknown> = {}): Relation {
    const id = this._generateId("rel")
    const relation: Relation = {
      id, source, target, type, properties,
      lastObserved: Date.now(),
    }
    this.relations.set(id, relation)
    this._pruneRelations()
    return relation
  }

  /** Remove a relation */
  removeRelation(relationId: string): boolean {
    return this.relations.delete(relationId)
  }

  /** Get relations for a specific entity */
  getEntityRelations(entityId: string): Relation[] {
    return [...this.relations.values()].filter(
      r => r.source === entityId || r.target === entityId
    )
  }

  /** Get all relations of a type */
  findRelations(type: string): Relation[] {
    return [...this.relations.values()].filter(r => r.type === type)
  }

  /** Get all relations */
  getAllRelations(): Relation[] {
    return [...this.relations.values()]
  }

  // ── Belief State Management ──────────────────────────────────────────

  /**
   * Observe a fact and update belief state.
   * Follows Belief Engine approach: updates confidence based on evidence.
   * If evidence supports → confidence increases toward 1.0
   * If evidence contradicts → confidence decreases (conflictPenalty)
   */
  observe(key: string, fact: string, confidence: number, source: string, category: string = "general"): BeliefUpdateResult {
    if (this.config.autoDecay) {
      this._applyDecay()
    }

    const existing = this.beliefs.get(key)
    const previousConfidence = existing?.confidence ?? 0

    if (!existing) {
      // New belief
      const belief: Belief = {
        key,
        fact,
        confidence: this._clamp(confidence),
        evidence: [{
          source,
          value: fact,
          timestamp: Date.now(),
          supports: true,
        }],
        lastUpdated: Date.now(),
        category,
      }
      this.beliefs.set(key, belief)
      this._pruneBeliefs()
      return {
        key,
        previousConfidence: 0,
        newConfidence: belief.confidence,
        changed: true,
      }
    }

    // Update existing belief — Bayesian-inspired update
    const evidence: BeliefEvidence = {
      source,
      value: fact,
      timestamp: Date.now(),
      supports: fact === existing.fact || confidence > existing.confidence,
    }
    existing.evidence.push(evidence)
    existing.lastUpdated = Date.now()

    // Update confidence using weighted average
    // If evidence supports → move toward confidence
    // If contradicts → apply conflict penalty
    let newConfidence: number
    if (evidence.supports) {
      // Supporting evidence: weighted average favoring new observation
      newConfidence = existing.confidence * 0.7 + confidence * 0.3
    } else {
      // Contradictory evidence: confidence drops
      newConfidence = existing.confidence * this.config.conflictPenalty
    }

    existing.confidence = this._clamp(newConfidence)

    // Limit evidence history to last 20 entries
    if (existing.evidence.length > 20) {
      existing.evidence = existing.evidence.slice(-20)
    }

    return {
      key,
      previousConfidence,
      newConfidence: existing.confidence,
      changed: Math.abs(existing.confidence - previousConfidence) > 0.001,
    }
  }

  /** Get a specific belief */
  getBelief(key: string): Belief | undefined {
    return this.beliefs.get(key)
  }

  /** Check if a belief is reliable (confidence >= threshold) */
  isReliable(key: string): boolean {
    const belief = this.beliefs.get(key)
    return belief ? belief.confidence >= this.config.reliabilityThreshold : false
  }

  /** Get beliefs by category */
  getBeliefsByCategory(category: string): Belief[] {
    return [...this.beliefs.values()].filter(b => b.category === category)
  }

  /** Get all beliefs */
  getAllBeliefs(): Belief[] {
    return [...this.beliefs.values()]
  }

  /** Get beliefs with low confidence (unreliable / uncertain) */
  getUncertainBeliefs(): Belief[] {
    return [...this.beliefs.values()].filter(
      b => b.confidence < this.config.reliabilityThreshold
    )
  }

  /** Remove a belief */
  removeBelief(key: string): boolean {
    return this.beliefs.delete(key)
  }

  // ── Belief Decay ─────────────────────────────────────────────────────

  /**
   * Apply belief decay to all beliefs.
   * confidence *= decayFactor — prevents stale beliefs from persisting indefinitely.
   * Beliefs that haven't been updated in many cycles decay more.
   */
  applyDecay(): void {
    this._applyDecay()
  }

  /** Reset cycle counter */
  resetCycleCount(): void {
    this.cycleCount = 0
  }

  /** Get current cycle count */
  getCycleCount(): number {
    return this.cycleCount
  }

  // ── Snapshot ─────────────────────────────────────────────────────────

  /** Take a snapshot of the entire world model state */
  snapshot(): WorldSnapshot {
    return {
      timestamp: Date.now(),
      entities: this.getAllEntities(),
      relations: this.getAllRelations(),
      beliefs: this.getAllBeliefs(),
    }
  }

  /** Restore from a snapshot */
  restore(snapshot: WorldSnapshot): void {
    this.entities.clear()
    this.relations.clear()
    this.beliefs.clear()
    for (const e of snapshot.entities) this.entities.set(e.id, e)
    for (const r of snapshot.relations) this.relations.set(r.id, r)
    for (const b of snapshot.beliefs) this.beliefs.set(b.key, b)
  }

  /** Clear all state */
  clear(): void {
    this.entities.clear()
    this.relations.clear()
    this.beliefs.clear()
    this.cycleCount = 0
  }

  /** Get summary statistics */
  getStats(): { entities: number; relations: number; beliefs: number; cycles: number } {
    return {
      entities: this.entities.size,
      relations: this.relations.size,
      beliefs: this.beliefs.size,
      cycles: this.cycleCount,
    }
  }

  // ── Private Helpers ──────────────────────────────────────────────────

  private _generateId(prefix: string): string {
    return `${prefix}_${crypto.randomBytes(4).toString("hex")}`
  }

  private _clamp(value: number): number {
    return Math.max(0, Math.min(1, value))
  }

  private _applyDecay(): void {
    this.cycleCount++
    for (const belief of this.beliefs.values()) {
      belief.confidence = this._clamp(belief.confidence * this.config.beliefDecayFactor)
    }
  }

  private _pruneEntities(): void {
    if (this.entities.size <= this.config.maxEntities) return
    const sorted = [...this.entities.values()].sort((a, b) => a.lastObserved - b.lastObserved)
    const toRemove = sorted.slice(0, sorted.length - this.config.maxEntities)
    for (const e of toRemove) {
      this.removeEntity(e.id)
    }
  }

  private _pruneRelations(): void {
    if (this.relations.size <= this.config.maxRelations) return
    const sorted = [...this.relations.values()].sort((a, b) => a.lastObserved - b.lastObserved)
    const toRemove = sorted.slice(0, sorted.length - this.config.maxRelations)
    for (const r of toRemove) {
      this.relations.delete(r.id)
    }
  }

  private _pruneBeliefs(): void {
    if (this.beliefs.size <= this.config.maxBeliefs) return
    const sorted = [...this.beliefs.values()].sort((a, b) => a.confidence - b.confidence)
    const toRemove = sorted.slice(0, sorted.length - this.config.maxBeliefs)
    for (const b of toRemove) {
      this.beliefs.delete(b.key)
    }
  }
}
