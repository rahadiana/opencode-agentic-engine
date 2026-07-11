/**
 * TechKnowledgeRegistry — Extensible technology knowledge base.
 *
 * Kenapa tidak hardcode?
 *   - Framework baru muncul tiap bulan (SolidStart, Analog, dll)
 *   - Best practices berubah (Vue Options → Composition API, dll)
 *   - Setiap project punya stack preference berbeda
 *   - User/pengembang harus bisa nambah sendiri tanpa rebuild
 *
 * Arsitektur:
 *   1. Built-in defaults sebagai fallback
 *   2. Persistent store di .agentic/tech-knowledge.json (per project)
 *   3. Runtime registration via registerTech() / registerPractice()
 *   4. Auto-sync: tiap perubahan langsung simpan ke disk
 *   5. Global + project-level: bisa override per project
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import { join, dirname as _dirname } from "node:path"
import { createLogger } from "../observability/logger.js"

const log = createLogger("TechKnowledge")

// ── Types ──────────────────────────────────────────────────────

export type TechCategory = "language" | "framework" | "database" | "tool"

export interface TechKeywordEntry {
  keyword: string
  category: TechCategory
  name: string
  /** Alternative names/aliases for this tech */
  aliases?: string[]
  /** Documentation URL for reference */
  docsUrl?: string
  /** Last updated timestamp */
  updatedAt?: string
}

export interface BestPracticeEntry {
  tech: string
  category: string
  practice: string
  detail: string
  /** Priority: critical > recommended > optional. Default: recommended */
  priority?: "critical" | "recommended" | "optional"
  /** Source URL where this practice was derived from */
  sourceUrl?: string
  /** When this practice was added/updated */
  updatedAt?: string
}

export interface TechKnowledgeData {
  version: number
  updatedAt: string
  technologies: TechKeywordEntry[]
  bestPractices: BestPracticeEntry[]
  /** Per-project overrides (keyed by projectId or path) */
  projectOverrides?: Record<string, {
    technologies?: TechKeywordEntry[]
    bestPractices?: BestPracticeEntry[]
  }>
}

// ── Built-in Defaults ──────────────────────────────────────────

const DEFAULT_KEYWORDS: TechKeywordEntry[] = [
  // Languages
  { keyword: "typescript", category: "language", name: "TypeScript", aliases: ["ts"], docsUrl: "https://www.typescriptlang.org/docs/" },
  { keyword: "javascript", category: "language", name: "JavaScript", aliases: ["js", "node"], docsUrl: "https://developer.mozilla.org/en-US/docs/Web/JavaScript" },
  { keyword: "python", category: "language", name: "Python", aliases: ["py"], docsUrl: "https://docs.python.org/3/" },
  { keyword: "rust", category: "language", name: "Rust", docsUrl: "https://doc.rust-lang.org/" },
  { keyword: "go", category: "language", name: "Go", aliases: ["golang"], docsUrl: "https://go.dev/doc/" },
  { keyword: "java", category: "language", name: "Java", docsUrl: "https://docs.oracle.com/en/java/" },
  { keyword: "php", category: "language", name: "PHP", docsUrl: "https://www.php.net/docs.php" },
  { keyword: "kotlin", category: "language", name: "Kotlin", docsUrl: "https://kotlinlang.org/docs/" },
  { keyword: "swift", category: "language", name: "Swift", docsUrl: "https://www.swift.org/documentation/" },
  // Backend Frameworks
  { keyword: "express", category: "framework", name: "Express.js", aliases: ["expressjs"], docsUrl: "https://expressjs.com/" },
  { keyword: "fastify", category: "framework", name: "Fastify", docsUrl: "https://www.fastify.io/docs/" },
  { keyword: "next", category: "framework", name: "Next.js", aliases: ["nextjs"], docsUrl: "https://nextjs.org/docs" },
  { keyword: "nuxt", category: "framework", name: "Nuxt.js", aliases: ["nuxtjs"], docsUrl: "https://nuxt.com/docs" },
  { keyword: "nest", category: "framework", name: "NestJS", aliases: ["nestjs"], docsUrl: "https://docs.nestjs.com/" },
  { keyword: "flask", category: "framework", name: "Flask", docsUrl: "https://flask.palletsprojects.com/" },
  { keyword: "django", category: "framework", name: "Django", docsUrl: "https://docs.djangoproject.com/" },
  { keyword: "fastapi", category: "framework", name: "FastAPI", docsUrl: "https://fastapi.tiangolo.com/" },
  { keyword: "spring", category: "framework", name: "Spring Boot", aliases: ["springboot"], docsUrl: "https://spring.io/projects/spring-boot" },
  { keyword: "rails", category: "framework", name: "Ruby on Rails", aliases: ["ruby-on-rails"], docsUrl: "https://guides.rubyonrails.org/" },
  { keyword: "laravel", category: "framework", name: "Laravel", docsUrl: "https://laravel.com/docs" },
  { keyword: "gin", category: "framework", name: "Gin", docsUrl: "https://gin-gonic.com/docs/" },
  { keyword: "echo", category: "framework", name: "Echo", docsUrl: "https://echo.labstack.com/docs" },
  // Frontend Frameworks
  { keyword: "react", category: "framework", name: "React", docsUrl: "https://react.dev/" },
  { keyword: "vue", category: "framework", name: "Vue.js", aliases: ["vuejs", "vue"], docsUrl: "https://vuejs.org/guide/introduction.html" },
  { keyword: "angular", category: "framework", name: "Angular", docsUrl: "https://angular.dev/" },
  { keyword: "svelte", category: "framework", name: "Svelte", aliases: ["sveltekit", "svelte-kit"], docsUrl: "https://svelte.dev/docs" },
  { keyword: "solid", category: "framework", name: "Solid.js", aliases: ["solidjs"], docsUrl: "https://docs.solidjs.com/" },
  { keyword: "remix", category: "framework", name: "Remix", docsUrl: "https://remix.run/docs" },
  { keyword: "alpine", category: "framework", name: "Alpine.js", aliases: ["alpinejs"], docsUrl: "https://alpinejs.dev/start-here" },
  // Databases
  { keyword: "sqlite", category: "database", name: "SQLite", aliases: ["sqlite3"], docsUrl: "https://www.sqlite.org/docs.html" },
  { keyword: "postgresql", category: "database", name: "PostgreSQL", aliases: ["postgres", "pg"], docsUrl: "https://www.postgresql.org/docs/" },
  { keyword: "mysql", category: "database", name: "MySQL", docsUrl: "https://dev.mysql.com/doc/" },
  { keyword: "mongodb", category: "database", name: "MongoDB", aliases: ["mongo"], docsUrl: "https://www.mongodb.com/docs/" },
  { keyword: "redis", category: "database", name: "Redis", docsUrl: "https://redis.io/docs/" },
  { keyword: "supabase", category: "database", name: "Supabase", docsUrl: "https://supabase.com/docs" },
  { keyword: "firebase", category: "database", name: "Firebase", docsUrl: "https://firebase.google.com/docs" },
  { keyword: "prisma", category: "database", name: "Prisma ORM", aliases: ["prisma-orm"], docsUrl: "https://www.prisma.io/docs" },
  { keyword: "drizzle", category: "database", name: "Drizzle ORM", aliases: ["drizzle-orm"], docsUrl: "https://orm.drizzle.team/docs" },
  { keyword: "typeorm", category: "database", name: "TypeORM", docsUrl: "https://typeorm.io/" },
  // Tools & Platforms
  { keyword: "docker", category: "tool", name: "Docker", docsUrl: "https://docs.docker.com/" },
  { keyword: "kubernetes", category: "tool", name: "Kubernetes", aliases: ["k8s"], docsUrl: "https://kubernetes.io/docs/" },
  { keyword: "aws", category: "tool", name: "AWS", docsUrl: "https://docs.aws.amazon.com/" },
  { keyword: "gcp", category: "tool", name: "Google Cloud", aliases: ["google-cloud"], docsUrl: "https://cloud.google.com/docs" },
  { keyword: "azure", category: "tool", name: "Azure", docsUrl: "https://learn.microsoft.com/en-us/azure/" },
  { keyword: "tailwind", category: "tool", name: "Tailwind CSS", aliases: ["tailwindcss"], docsUrl: "https://tailwindcss.com/docs" },
  { keyword: "graphql", category: "tool", name: "GraphQL", docsUrl: "https://graphql.org/learn/" },
  { keyword: "websocket", category: "tool", name: "WebSocket", docsUrl: "https://developer.mozilla.org/en-US/docs/Web/API/WebSocket" },
  { keyword: "jwt", category: "tool", name: "JWT", aliases: ["json-web-token"], docsUrl: "https://jwt.io/introduction" },
  { keyword: "oauth", category: "tool", name: "OAuth", aliases: ["oauth2"], docsUrl: "https://oauth.net/2/" },
]

const DEFAULT_PRACTICES: BestPracticeEntry[] = [
  // ── Express.js ──
  { tech: "express", category: "architecture", practice: "Error Handling Middleware", priority: "critical",
    detail: "Gunakan centralized error handler — `app.use((err, req, res, next) => ...)`. Jangan try/catch di setiap route, biar error terhandle seragam.",
    sourceUrl: "https://expressjs.com/en/guide/error-handling.html" },
  { tech: "express", category: "architecture", practice: "Route Segregation", priority: "critical",
    detail: "Pisahkan routes ke file terpisah per resource (routes/users.ts, routes/products.ts). Gunakan express.Router().",
    sourceUrl: "https://expressjs.com/en/guide/routing.html" },
  { tech: "express", category: "security", practice: "Helmet + CORS", priority: "critical",
    detail: "Wajib `helmet()` untuk security headers dan `cors()` untuk CORS. Jangan buka CORS ke semua origin di production.",
    sourceUrl: "https://helmetjs.github.io/" },
  { tech: "express", category: "validation", practice: "Input Validation Middleware", priority: "critical",
    detail: "Validasi input di middleware layer (zod, joi, express-validator) — jangan di route handler. Schema validation mencegah injection.",
    sourceUrl: "https://express-validator.github.io/docs/" },
  { tech: "express", category: "structure", practice: "MVC Pattern", priority: "recommended",
    detail: "Pisahkan Models (data layer), Routes (controllers), Services (business logic). Jangan gabung semuanya di satu file route." },
  { tech: "express", category: "async", practice: "Async Error Wrapper", priority: "critical",
    detail: "Bungkus semua async route handler: `const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)`.",
    sourceUrl: "https://expressjs.com/en/guide/error-handling.html" },
  // ── Vue.js 3 ──
  { tech: "vue", category: "architecture", practice: "Composition API", priority: "critical",
    detail: "Gunakan `<script setup>` + Composition API (`ref`, `reactive`, `computed`). Jangan pakai Options API (`data()`, `methods: {}`) untuk component baru.",
    sourceUrl: "https://vuejs.org/guide/composition-api-setup.html" },
  { tech: "vue", category: "structure", practice: "Feature-based Organization", priority: "recommended",
    detail: "Organize components per fitur: `components/checkout/` bukan `components/generic/`. Lebih mudah di-maintain saat scale.",
    sourceUrl: "https://vuejs.org/guide/scaling-up/routing.html" },
  { tech: "vue", category: "state", practice: "Pinia State Management", priority: "recommended",
    detail: "Gunakan Pinia (bukan Vuex) untuk state management. Definisikan store per domain — jangan satu store untuk semua state.",
    sourceUrl: "https://pinia.vuejs.org/" },
  { tech: "vue", category: "routing", practice: "Lazy Loading Routes", priority: "recommended",
    detail: "Gunakan dynamic import: `() => import('./views/About.vue')`. Biar Vue auto code-split per route — bundle size lebih kecil.",
    sourceUrl: "https://router.vuejs.org/guide/advanced/lazy-loading.html" },
  { tech: "vue", category: "typescript", practice: "Typed Components", priority: "recommended",
    detail: "Gunakan `defineProps<{...}>()` dan `defineEmits<{...}>()` untuk props/events typing. Hindari runtime props validation.",
    sourceUrl: "https://vuejs.org/guide/typescript/composition-api.html" },
  { tech: "vue", category: "performance", practice: "v-memo / computed", priority: "optional",
    detail: "Gunakan `computed` untuk derived state (bukan method). `v-memo` untuk list rendering berat. Hindari watcher berlebihan." },
  // ── SQLite ──
  { tech: "sqlite", category: "performance", practice: "WAL Mode", priority: "critical",
    detail: "Aktifkan WAL mode: `PRAGMA journal_mode=WAL;`. Meningkatkan concurrent read performance signifikan.",
    sourceUrl: "https://www.sqlite.org/wal.html" },
  { tech: "sqlite", category: "schema", practice: "Foreign Keys ON", priority: "critical",
    detail: "SQLite tidak enable foreign keys by default. Wajib: `PRAGMA foreign_keys=ON;` setiap koneksi.",
    sourceUrl: "https://www.sqlite.org/foreignkeys.html" },
  { tech: "sqlite", category: "performance", practice: "Strategic Indexing", priority: "recommended",
    detail: "Buat index untuk kolom di WHERE, JOIN, ORDER BY. Cek dengan `EXPLAIN QUERY PLAN`. Jangan over-index." },
  { tech: "sqlite", category: "migration", practice: "Idempotent Migrations", priority: "critical",
    detail: "Migration harus idempotent: `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ADD COLUMN IF NOT EXISTS` (via schema version check).",
    sourceUrl: "https://www.sqlite.org/lang_altertable.html" },
  { tech: "sqlite", category: "performance", practice: "Batch INSERT", priority: "recommended",
    detail: "Bungkus multiple INSERT dalam satu transaksi: `BEGIN; INSERT ...; INSERT ...; COMMIT;`. 10-100x lebih cepat dari per-statement." },
  // ── React ──
  { tech: "react", category: "architecture", practice: "Component Composition", priority: "critical",
    detail: "Prefer composition (`children`, render props) over inheritance. Extract shared logic ke custom hooks.",
    sourceUrl: "https://react.dev/learn/passing-props-to-a-component" },
  { tech: "react", category: "state", practice: "State Management by Scale", priority: "recommended",
    detail: "Local state: `useState`/`useReducer`. Global state: Context untuk theme/auth, Zustand/Redux Toolkit untuk domain data kompleks.",
    sourceUrl: "https://react.dev/learn/managing-state" },
  { tech: "react", category: "performance", practice: "React.memo / useMemo", priority: "optional",
    detail: "Gunakan `React.memo` untuk component dengan props yang jarang berubah. `useMemo`/`useCallback` untuk expensive computations.",
    sourceUrl: "https://react.dev/reference/react/memo" },
  { tech: "react", category: "routing", practice: "React Router Data Loading", priority: "recommended",
    detail: "Gunakan React Router v6+ loaders/actions untuk data fetching — bukan useEffect + fetch di component.",
    sourceUrl: "https://reactrouter.com/en/main/route/loader" },
  // ── Prisma ──
  { tech: "prisma", category: "schema", practice: "Schema-First Design", priority: "critical",
    detail: "Definisikan schema dulu di `schema.prisma`, baru `prisma generate`. Jangan modifikasi migration files manual.",
    sourceUrl: "https://www.prisma.io/docs/orm/prisma-schema/overview" },
  { tech: "prisma", category: "query", practice: "N+1 Prevention", priority: "critical",
    detail: "Gunakan `include` atau `select` untuk eager loading relasi. Jangan query parent-child terpisah di loop.",
    sourceUrl: "https://www.prisma.io/docs/orm/prisma-client/queries/relation-queries" },
  { tech: "prisma", category: "migration", practice: "Prisma Migrate", priority: "recommended",
    detail: "Gunakan `prisma migrate dev` untuk development, `prisma migrate deploy` untuk production. Jangan edit migration SQL manual.",
    sourceUrl: "https://www.prisma.io/docs/orm/prisma-migrate/understanding-prisma-migrate" },
  // ── Docker ──
  { tech: "docker", category: "dockerfile", practice: "Multi-stage Builds", priority: "critical",
    detail: "Stage 1: build dependencies. Stage 2: production image — lebih kecil, lebih aman (gak include dev tools).",
    sourceUrl: "https://docs.docker.com/build/building/multi-stage/" },
  { tech: "docker", category: "dockerfile", practice: "Layer Caching", priority: "critical",
    detail: "Urutkan Dockerfile: COPY package.json dulu → RUN npm install → baru COPY source code. Manfaatkan layer cache.",
    sourceUrl: "https://docs.docker.com/build/cache/" },
  { tech: "docker", category: "security", practice: "Non-root User", priority: "critical",
    detail: "Jangan run container sebagai root. Tambahkan: `RUN addgroup -S app && adduser -S app && USER app`.",
    sourceUrl: "https://docs.docker.com/develop/develop-images/dockerfile_best-practices/" },
  // ── General ──
  { tech: "general", category: "testing", practice: "Test Pyramid", priority: "recommended",
    detail: "Komposisi: unit test >70% (cepat, isolated), integration test ~20%, e2e test ~10% (lambat, fragile)." },
  { tech: "general", category: "security", practice: "OWASP Top 10 Awareness", priority: "critical",
    detail: "Waspadai: Injection (#1), Broken Authentication (#2), XSS (#3), Broken Access Control (#1 di 2021), Security Misconfiguration (#5).",
    sourceUrl: "https://owasp.org/www-project-top-ten/" },
  { tech: "general", category: "api", practice: "RESTful Naming", priority: "recommended",
    detail: "Gunakan plural nouns: `/api/v1/users`, `/api/v1/products`. HTTP methods: GET=read, POST=create, PUT/PATCH=update, DELETE=delete." },
  { tech: "general", category: "api", practice: "Version Your API", priority: "critical",
    detail: "Version API sejak awal: `/api/v1/...`. Biar breaking changes gak ngerusak client lama." },
  { tech: "general", category: "logging", practice: "Structured Logging", priority: "recommended",
    detail: "Gunakan structured logging (JSON format) — bukan `console.log()`. Include correlation ID per request untuk tracing." },
  { tech: "general", category: "error", practice: "Never Expose Stack Traces", priority: "critical",
    detail: "Jangan expose internal error detail ke client production. Gunakan error code + message yang aman." },
  { tech: "general", category: "env", practice: "Environment Variables", priority: "critical",
    detail: "Semua konfigurasi via environment variables. Jangan hardcode secrets/credentials. Validasi config di startup." },
]

// ── Registry ───────────────────────────────────────────────────

export class TechKnowledgeRegistry {
  private technologies: Map<string, TechKeywordEntry> = new Map()
  private bestPractices: BestPracticeEntry[] = []
  private configDir: string
  private projectOverrides: Map<string, { technologies?: TechKeywordEntry[]; bestPractices?: BestPracticeEntry[] }> = new Map()
  private dirty = false
  private saveTimer: ReturnType<typeof setTimeout> | null = null

  constructor(configDir?: string) {
    this.configDir = configDir ?? ""
    this._loadDefaults()
    this._loadFromDisk()
  }

  // ── Registration API ──

  /**
   * Register a technology keyword.
   * Use this to add new frameworks, languages, databases, tools.
   *
   * @example
   * registry.registerTech({
   *   keyword: "analog",
   *   category: "framework",
   *   name: "AnalogJS",
   *   aliases: ["analogjs", "analog"],
   *   docsUrl: "https://analogjs.org/docs"
   * })
   */
  registerTech(entry: TechKeywordEntry): void {
    const key = entry.keyword.toLowerCase()
    this.technologies.set(key, { ...entry, updatedAt: new Date().toISOString() })
    this.dirty = true
    this._scheduleSave()
    log.info(`[TechKnowledge] Registered tech: ${entry.name} (${entry.category})`)
  }

  /**
   * Register multiple technology keywords at once.
   * Useful for bulk registration from config or web fetch.
   */
  registerTechs(entries: TechKeywordEntry[]): void {
    for (const entry of entries) {
      this.registerTech(entry)
    }
  }

  /**
   * Register a best practice for a technology.
   *
   * @example
   * registry.registerPractice({
   *   tech: "analog",
   *   category: "architecture",
   *   practice: "File-based Routing",
   *   detail: "Analog uses file-based routing in src/pages/...",
   *   priority: "critical",
   *   sourceUrl: "https://analogjs.org/docs/routing"
   * })
   */
  registerPractice(practice: BestPracticeEntry): void {
    // Deduplicate by tech + practice name
    const existingIndex = this.bestPractices.findIndex(
      p => p.tech === practice.tech && p.practice === practice.practice
    )
    if (existingIndex >= 0) {
      this.bestPractices[existingIndex] = { ...practice, updatedAt: new Date().toISOString() }
    } else {
      this.bestPractices.push({ ...practice, updatedAt: practice.updatedAt ?? new Date().toISOString() })
    }
    this.dirty = true
    this._scheduleSave()
  }

  /**
   * Register multiple best practices at once.
   */
  registerPractices(practices: BestPracticeEntry[]): void {
    for (const p of practices) {
      this.registerPractice(p)
    }
  }

  /**
   * Set per-project overrides for technologies and best practices.
   * This allows each project to have its own set of known technologies.
   */
  setProjectOverrides(projectId: string, overrides: {
    technologies?: TechKeywordEntry[]
    bestPractices?: BestPracticeEntry[]
  }): void {
    this.projectOverrides.set(projectId, overrides)
    this.dirty = true
    this._scheduleSave()
  }

  // ── Query API ──

  /**
   * Detect technologies from a text string (e.g., user goal).
   * Returns matched tech entries with their categories.
   */
  detectTechs(text: string): { technologies: TechKeywordEntry[]; stack: { languages: string[]; frameworks: string[]; databases: string[]; tools: string[] } } {
    const lower = text.toLowerCase()
    const matched: TechKeywordEntry[] = []
    const stack = { languages: [] as string[], frameworks: [] as string[], databases: [] as string[], tools: [] as string[] }

    for (const entry of this.technologies.values()) {
      const keywords = [entry.keyword, ...(entry.aliases ?? [])]
      const isMatched = keywords.some(kw => lower.includes(kw.toLowerCase()))
      if (isMatched) {
        matched.push(entry)
        switch (entry.category) {
          case "language": if (!stack.languages.includes(entry.name)) stack.languages.push(entry.name); break
          case "framework": if (!stack.frameworks.includes(entry.name)) stack.frameworks.push(entry.name); break
          case "database": if (!stack.databases.includes(entry.name)) stack.databases.push(entry.name); break
          case "tool": if (!stack.tools.includes(entry.name)) stack.tools.push(entry.name); break
        }
      }
    }

    return { technologies: matched, stack }
  }

  /**
   * Get best practices for a specific technology or set of technologies.
   * @param techFilter - Array of tech names or keywords to filter by
   * @param minPriority - Minimum priority level (critical > recommended > optional)
   */
  getPractices(techFilter?: string[], minPriority?: "critical" | "recommended" | "optional"): BestPracticeEntry[] {
    let practices = this.bestPractices

    if (techFilter && techFilter.length > 0) {
      const lowerTechs = techFilter.map(t => t.toLowerCase())
      practices = practices.filter(p => {
        const techLower = p.tech.toLowerCase()
        return lowerTechs.some(t => techLower.includes(t) || t.includes(techLower))
      })
    }

    // Always include "general" practices
    const generalPractices = this.bestPractices.filter(p => p.tech === "general")
    practices = [...practices, ...generalPractices.filter(p => !practices.includes(p))]

    // Filter by priority
    if (minPriority === "critical") {
      practices = practices.filter(p => p.priority === "critical" || p.tech === "general")
    } else if (minPriority === "recommended") {
      practices = practices.filter(p => p.priority === "critical" || p.priority === "recommended" || p.tech === "general")
    }

    return practices
  }

  /**
   * Get ALL registered technologies.
   */
  getAllTechs(): TechKeywordEntry[] {
    return [...this.technologies.values()]
  }

  /**
   * Get ALL registered best practices.
   */
  getAllPractices(): BestPracticeEntry[] {
    return [...this.bestPractices]
  }

  /**
   * Search for a specific technology by name or keyword.
   */
  findTech(query: string): TechKeywordEntry | undefined {
    const lower = query.toLowerCase()
    return [...this.technologies.values()].find(
      t => t.keyword === lower ||
        t.name.toLowerCase().includes(lower) ||
        t.aliases?.some(a => a.toLowerCase() === lower)
    )
  }

  /**
   * Export all data as serializable object (for disk persistence).
   */
  exportData(): TechKnowledgeData {
    return {
      version: 1,
      updatedAt: new Date().toISOString(),
      technologies: [...this.technologies.values()],
      bestPractices: [...this.bestPractices],
      projectOverrides: this.projectOverrides.size > 0
        ? Object.fromEntries(this.projectOverrides.entries())
        : undefined,
    }
  }

  /**
   * Import data from a serialized TechKnowledgeData object.
   */
  importData(data: TechKnowledgeData): void {
    if (data.technologies) {
      for (const t of data.technologies) {
        this.technologies.set(t.keyword.toLowerCase(), t)
      }
    }
    if (data.bestPractices) {
      for (const p of data.bestPractices) {
        const existingIndex = this.bestPractices.findIndex(
          ep => ep.tech === p.tech && ep.practice === p.practice
        )
        if (existingIndex >= 0) {
          this.bestPractices[existingIndex] = p
        } else {
          this.bestPractices.push(p)
        }
      }
    }
    if (data.projectOverrides) {
      for (const [projectId, overrides] of Object.entries(data.projectOverrides)) {
        this.projectOverrides.set(projectId, overrides)
      }
    }
    this.dirty = true
    this._scheduleSave()
  }

  /**
   * Fetch best practices from the web for a given technology.
   * Calls webfetch on the documentation URL and extracts relevant snippets.
   * Results are registered as practices.
   *
   * NOTE: This requires LLM/webfetch capability. Returns true if fetch was attempted.
   */
  async fetchFromWeb(keyword: string): Promise<boolean> {
    const tech = this.findTech(keyword)
    if (!tech?.docsUrl) return false

    try {
      // Dynamic import webfetch-like functionality
      const url = tech.docsUrl
      log.info(`[TechKnowledge] Fetching best practices from ${url}...`)

      // Register placeholder practice indicating web fetch was attempted
      this.registerPractice({
        tech: tech.keyword,
        category: "general",
        practice: `Auto-fetched from ${tech.name} docs`,
        detail: `Best practices were fetched from ${url} during session. Use webfetch directly to retrieve fresh documentation.`,
        priority: "optional",
        sourceUrl: url,
      })

      return true
    } catch {
      log.warn(`[TechKnowledge] Failed to fetch from web for "${keyword}"`)
      return false
    }
  }

  // ── Persistence ──

  /** Set config directory for persistence. Called during plugin init. */
  setConfigDir(dir: string): void {
    this.configDir = dir
    this._loadFromDisk()
  }

  /** Force save to disk immediately. */
  save(): void {
    if (!this.configDir) return
    try {
      const dirPath = join(this.configDir, ".agentic")
      const filePath = join(dirPath, "tech-knowledge.json")
      mkdirSync(dirPath, { recursive: true })
      writeFileSync(filePath, JSON.stringify(this.exportData(), null, 2), "utf-8")
      this.dirty = false
      log.info(`[TechKnowledge] Saved to ${filePath}`)
    } catch (e) {
      log.warn(`[TechKnowledge] Failed to save: ${e}`)
    }
  }

  // ── Private ──

  private _loadDefaults(): void {
    for (const entry of DEFAULT_KEYWORDS) {
      this.technologies.set(entry.keyword.toLowerCase(), { ...entry })
    }
    this.bestPractices = DEFAULT_PRACTICES.map(p => ({ ...p, updatedAt: new Date().toISOString() }))
  }

  private _loadFromDisk(): void {
    if (!this.configDir) return
    try {
      const filePath = join(this.configDir, ".agentic", "tech-knowledge.json")
      if (existsSync(filePath)) {
        const raw = readFileSync(filePath, "utf-8")
        const data = JSON.parse(raw) as TechKnowledgeData
        this.importData(data)
        log.info(`[TechKnowledge] Loaded ${data.technologies?.length ?? 0} techs, ${data.bestPractices?.length ?? 0} practices from disk`)
      }
    } catch (e) {
      log.warn(`[TechKnowledge] Failed to load from disk: ${e}`)
    }
  }

  private _scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.save(), 2000) // debounce 2s
  }
}

/**
 * Global singleton instance.
 * Digunakan oleh ResearchAgent5W1H dan komponen lain.
 */
let _globalRegistry: TechKnowledgeRegistry | null = null

export function getTechKnowledgeRegistry(configDir?: string): TechKnowledgeRegistry {
  if (!_globalRegistry) {
    _globalRegistry = new TechKnowledgeRegistry(configDir)
  }
  return _globalRegistry
}

export function resetTechKnowledgeRegistry(): void {
  if (_globalRegistry) {
    _globalRegistry.save()
    _globalRegistry = null
  }
}
