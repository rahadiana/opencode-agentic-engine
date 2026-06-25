/**
 * DynamicToolRegistry — Runtime tool registry with versioning support.
 *
 * Tool Versioning (v0.6.0):
 * - Each tool can have multiple versions stored concurrently
 * - Active version auto-selects highest semver unless pinned
 * - Pin to specific version via pin(name, version)
 * - Deprecate versions via deprecate(name, version)
 * - Migration paths between versions via addMigration()
 * - All existing methods (get, list, call) resolve to active version
 */

import { type MCPTool } from "./mcp-client.js"

export interface DynamicToolRegistration {
  name: string
  description: string
  parameters?: Record<string, unknown>
  execute: (args: Record<string, unknown>, context?: any) => Promise<unknown>
  metadata?: {
    category?: string
    keywords?: string[]
    version?: string
    author?: string
  }
  registeredAt: number
}

export interface ToolCallResult {
  tool: string
  content: unknown
  isError: boolean
  durationMs: number
}

export interface VersionInfo {
  version: string
  deprecated: boolean
  registeredAt: number
}

export interface VersionMigration {
  /** Source version (use "*" for any) */
  fromVersion: string
  /** Target version */
  toVersion: string
  /** Migration function: transforms args from old to new format */
  adapter: (args: Record<string, unknown>) => Record<string, unknown>
  description?: string
}

export interface ToolVersionStats {
  name: string
  activeVersion: string
  totalVersions: number
  pinned: boolean
  deprecatedVersions: string[]
  migrations: number
}

/** Simple semver comparison for tool versioning */
function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(".").map(Number)
  const pb = b.replace(/^v/, "").split(".").map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0
    const nb = pb[i] ?? 0
    if (na !== nb) return na - nb
  }
  return 0
}

export class DynamicToolRegistry {
  /** Map: toolName → version → registration */
  private versions = new Map<string, Map<string, DynamicToolRegistration>>()
  /** Map: toolName → active version string */
  private activeVersion = new Map<string, string>()
  /** Map: toolName → pinned version string (overrides auto-select) */
  private pinnedVersions = new Map<string, string>()
  /** Set: "toolName@version" for deprecated versions */
  private deprecatedVersions = new Set<string>()
  /** Migrations: "toolName@fromVersion→toVersion" → adapter */
  private migrations = new Map<string, VersionMigration>()

  // ── Registration ────────────────────────────────

  /**
   * Register a tool with optional version.
   * If metadata.version is not set, defaults to "1.0.0".
   * Auto-sets as active if it's the highest version.
   */
  register(registration: DynamicToolRegistration): void {
    if (!registration.name || typeof registration.name !== "string") {
      throw new Error("Tool name is required and must be a string")
    }
    if (typeof registration.execute !== "function") {
      throw new Error("Tool execute function is required")
    }

    const name = registration.name
    const version = registration.metadata?.version ?? "1.0.0"
    const full: DynamicToolRegistration = {
      ...registration,
      metadata: {
        ...registration.metadata,
        version,
      },
      registeredAt: registration.registeredAt ?? Date.now(),
    }

    // Get or create version map for this tool
    let versionMap = this.versions.get(name)
    if (!versionMap) {
      versionMap = new Map()
      this.versions.set(name, versionMap)
    }
    versionMap.set(version, full)

    // Auto-select active version: highest semver unless pinned
    this._updateActiveVersion(name)
  }

  /**
   * Register a tool from pre-built components (used by registryTool helper).
   * Accepts optional version in metadata.
   */
  registerFromTool(
    name: string,
    description: string,
    parameters: Record<string, unknown>,
    execute: (args: Record<string, unknown>, context?: any) => Promise<unknown>,
    metadata?: { category?: string; keywords?: string[]; version?: string },
  ): void {
    this.register({
      name,
      description,
      parameters,
      execute,
      metadata,
      registeredAt: Date.now(),
    })
  }

  /** Register multiple tools at once */
  registerBatch(registrations: DynamicToolRegistration[]): void {
    for (const reg of registrations) {
      this.register(reg)
    }
  }

  // ── Unregistration ──────────────────────────────

  /** Remove all versions of a tool */
  unregister(name: string): boolean {
    const existed = this.versions.has(name)
    this.versions.delete(name)
    this.activeVersion.delete(name)
    this.pinnedVersions.delete(name)
    // Clean up deprecated entries
    for (const key of this.deprecatedVersions) {
      if (key.startsWith(name + "@")) {
        this.deprecatedVersions.delete(key)
      }
    }
    return existed
  }

  /** Remove a specific version of a tool */
  unregisterVersion(name: string, version: string): boolean {
    const versionMap = this.versions.get(name)
    if (!versionMap) return false
    const removed = versionMap.delete(version)
    if (removed) {
      // Clean deprecated entry
      this.deprecatedVersions.delete(`${name}@${version}`)
      // If no versions left, remove tool entirely
      if (versionMap.size === 0) {
        this.versions.delete(name)
        this.activeVersion.delete(name)
        this.pinnedVersions.delete(name)
      } else if (this.activeVersion.get(name) === version) {
        // If active version was removed, update
        this._updateActiveVersion(name)
      }
    }
    return removed
  }

  // ── Retrieval ───────────────────────────────────

  /**
   * Get a tool registration by name and optional version.
   * If version is omitted, returns the active version.
   * Returns undefined if tool or version doesn't exist.
   */
  get(name: string, version?: string): DynamicToolRegistration | undefined {
    const versionMap = this.versions.get(name)
    if (!versionMap) return undefined

    if (version) {
      return versionMap.get(version)
    }

    // Return active version
    const active = this.activeVersion.get(name)
    if (active && versionMap.has(active)) {
      return versionMap.get(active)
    }

    // Fallback: any version
    return versionMap.values().next().value
  }

  /** Check if a tool name exists (any version) */
  has(name: string): boolean {
    return this.versions.has(name)
  }

  /** Check if a specific tool version exists */
  hasVersion(name: string, version: string): boolean {
    return this.versions.get(name)?.has(version) ?? false
  }

  // ── Version Management ──────────────────────────

  /**
   * Pin a tool to a specific version.
   * All calls to get(name) and call(name) will use this version.
   */
  pin(name: string, version: string): boolean {
    const versionMap = this.versions.get(name)
    if (!versionMap || !versionMap.has(version)) {
      return false
    }
    this.pinnedVersions.set(name, version)
    this.activeVersion.set(name, version)
    return true
  }

  /** Remove version pin — reverts to highest semver */
  unpin(name: string): boolean {
    const had = this.pinnedVersions.has(name)
    this.pinnedVersions.delete(name)
    if (had) {
      this._updateActiveVersion(name)
    }
    return had
  }

  /** Get pinned version for a tool, or null if not pinned */
  getPinnedVersion(name: string): string | null {
    return this.pinnedVersions.get(name) ?? null
  }

  /** Get the currently active version string for a tool */
  getActiveVersion(name: string): string | null {
    return this.activeVersion.get(name) ?? null
  }

  /** List all versions of a tool with metadata */
  listVersions(name: string): VersionInfo[] {
    const versionMap = this.versions.get(name)
    if (!versionMap) return []

    return [...versionMap.entries()]
      .map(([version, reg]) => ({
        version,
        deprecated: this.deprecatedVersions.has(`${name}@${version}`),
        registeredAt: reg.registeredAt,
      }))
      .sort((a, b) => -compareSemver(a.version, b.version))
  }

  // ── Deprecation ─────────────────────────────────

  /** Mark a specific version as deprecated */
  deprecate(name: string, version: string): boolean {
    if (!this.versions.get(name)?.has(version)) return false
    this.deprecatedVersions.add(`${name}@${version}`)
    // If deprecated version was active, try to find another
    if (this.activeVersion.get(name) === version) {
      this._updateActiveVersion(name)
    }
    return true
  }

  /** Remove deprecation from a version */
  undeprecate(name: string, version: string): boolean {
    return this.deprecatedVersions.delete(`${name}@${version}`)
  }

  /** Check if a specific version is deprecated */
  isDeprecated(name: string, version: string): boolean {
    return this.deprecatedVersions.has(`${name}@${version}`)
  }

  // ── Migrations ──────────────────────────────────

  /**
   * Register a migration path between tool versions.
   * The adapter function transforms arguments from the old format to the new format.
   * The description should include the tool name for filtering (e.g., "agentic_plan v1→v2").
   */
  addMigration(migration: VersionMigration): void {
    this.migrations.set(`${migration.fromVersion}→${migration.toVersion}`, migration)
  }

  /** Get all registered migrations for a tool (matched by description) */
  getMigrations(name: string): VersionMigration[] {
    return [...this.migrations.values()].filter(m => {
      return m.description?.includes(name) ?? false
    })
  }

  // ── Call & Execution ────────────────────────────

  /**
   * Call a tool by name.
   * Resolves to the active version (or pinned version if set).
   */
  async call(name: string, args: Record<string, unknown>): Promise<ToolCallResult> {
    const tool = this.get(name)
    if (!tool) {
      return {
        tool: name,
        content: `Tool not found: ${name}`,
        isError: true,
        durationMs: 0,
      }
    }

    const start = performance.now()
    try {
      const content = await tool.execute(args)
      return {
        tool: name,
        content,
        isError: false,
        durationMs: Math.round(performance.now() - start),
      }
    } catch (err) {
      return {
        tool: name,
        content: err instanceof Error ? err.message : String(err),
        isError: true,
        durationMs: Math.round(performance.now() - start),
      }
    }
  }

  // ── Listing & Search ────────────────────────────

  /** List all tools (active versions only, one per tool name) */
  list(): DynamicToolRegistration[] {
    const result: DynamicToolRegistration[] = []
    for (const [name] of this.versions) {
      const tool = this.get(name)
      if (tool) {
        result.push(tool)
      }
    }
    return result.sort((a, b) => a.name.localeCompare(b.name))
  }

  /** List tools by category */
  listByCategory(category: string): DynamicToolRegistration[] {
    return this.list().filter(
      (t) => t.metadata?.category === category,
    )
  }

  /** List all versions of all tools (flat list) */
  listAllVersions(): DynamicToolRegistration[] {
    const result: DynamicToolRegistration[] = []
    for (const versionMap of this.versions.values()) {
      for (const tool of versionMap.values()) {
        result.push(tool)
      }
    }
    return result.sort((a, b) => a.name.localeCompare(b.name))
  }

  /** Search tools by name, description, or keywords */
  search(query: string): DynamicToolRegistration[] {
    const lower = query.toLowerCase()
    return this.list().filter((t) => {
      if (t.name.toLowerCase().includes(lower)) return true
      if (t.description.toLowerCase().includes(lower)) return true
      if (t.metadata?.keywords?.some((k) => k.toLowerCase().includes(lower))) return true
      if (t.metadata?.version?.toLowerCase().includes(lower)) return true
      return false
    })
  }

  // ── Utility ─────────────────────────────────────

  get size(): number {
    return this.versions.size
  }

  /** Get total count across all versions */
  get totalVersions(): number {
    let count = 0
    for (const versionMap of this.versions.values()) {
      count += versionMap.size
    }
    return count
  }

  /** Remove all tools */
  clear(): void {
    this.versions.clear()
    this.activeVersion.clear()
    this.pinnedVersions.clear()
    this.deprecatedVersions.clear()
    this.migrations.clear()
  }

  // ── Stats ───────────────────────────────────────

  getStats(): { total: number; byCategory: Record<string, number>; totalVersions: number; pinnedCount: number; deprecatedCount: number } {
    const byCategory: Record<string, number> = {}
    for (const tool of this.list()) {
      const cat = tool.metadata?.category ?? "other"
      byCategory[cat] = (byCategory[cat] ?? 0) + 1
    }
    return {
      total: this.versions.size,
      byCategory,
      totalVersions: this.totalVersions,
      pinnedCount: this.pinnedVersions.size,
      deprecatedCount: this.deprecatedVersions.size,
    }
  }

  /** Get version stats for all tools */
  getVersionStats(): ToolVersionStats[] {
    const stats: ToolVersionStats[] = []
    for (const [name] of this.versions) {
      const versionMap = this.versions.get(name)!
      const deprecated = [...versionMap.keys()].filter(v => this.deprecatedVersions.has(`${name}@${v}`))
      const toolMigrations = [...this.migrations.values()].filter(m =>
        m.description?.includes(name)
      )
      stats.push({
        name,
        activeVersion: this.activeVersion.get(name) ?? versionMap.keys().next().value ?? "unknown",
        totalVersions: versionMap.size,
        pinned: this.pinnedVersions.has(name),
        deprecatedVersions: deprecated,
        migrations: toolMigrations.length,
      })
    }
    return stats.sort((a, b) => a.name.localeCompare(b.name))
  }

  // ── MCP Exposure ────────────────────────────────

  toMCPTools(): MCPTool[] {
    return this.list().map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters ?? {},
      version: t.metadata?.version,
    }))
  }

  // ── Internal ────────────────────────────────────

  /**
   * Update the active version for a tool based on:
   * 1. Pinned version (if set)
   * 2. Highest non-deprecated semver
   * 3. Highest semver (fallback)
   */
  private _updateActiveVersion(name: string): void {
    const versionMap = this.versions.get(name)
    if (!versionMap || versionMap.size === 0) {
      this.activeVersion.delete(name)
      return
    }

    // 1. Check pinned version
    const pinned = this.pinnedVersions.get(name)
    if (pinned && versionMap.has(pinned)) {
      this.activeVersion.set(name, pinned)
      return
    }

    // 2. Find highest non-deprecated version
    let best: string | null = null
    let bestDeprecated: string | null = null
    for (const version of versionMap.keys()) {
      const isDep = this.deprecatedVersions.has(`${name}@${version}`)
      if (!isDep) {
        if (best === null || compareSemver(version, best) > 0) {
          best = version
        }
      } else {
        // Track best deprecated as fallback
        if (bestDeprecated === null || compareSemver(version, bestDeprecated) > 0) {
          bestDeprecated = version
        }
      }
    }

    // 3. Fallback to deprecated if no non-deprecated versions
    const activeVersion = best ?? bestDeprecated

    if (activeVersion) {
      this.activeVersion.set(name, activeVersion)
    }
  }
}
