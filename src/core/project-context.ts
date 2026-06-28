import * as fs from "node:fs"
import * as path from "node:path"
import { createLogger } from "../observability/logger.js"

const log = createLogger("ProjectContext")

// ── Types ──

export interface DetectedLanguage {
  lang: string
  confidence: number // 0–1
  evidence: string[]
}

export interface DetectedFramework {
  name: string
  confidence: number
  evidence: string[]
}

export interface ProjectContext {
  languages: DetectedLanguage[]
  frameworks: DetectedFramework[]
  packageManager: string | null
  testPatterns: string[]
  entryPoints: string[]
  ambiguity: "LOW" | "MEDIUM" | "HIGH"
  /** Timestamp cache dibuat */
  cachedAt: string
}

// ── Framework signatures ──

interface FWSignatures {
  [dep: string]: { name: string; lang: string }
}

const FW_SIGNATURES: FWSignatures = {
  next: { name: "Next.js", lang: "TypeScript" },
  react: { name: "React", lang: "TypeScript" },
  "react-dom": { name: "React", lang: "JavaScript" },
  vue: { name: "Vue", lang: "TypeScript" },
  angular: { name: "Angular", lang: "TypeScript" },
  svelte: { name: "Svelte", lang: "TypeScript" },
  express: { name: "Express", lang: "JavaScript" },
  nest: { name: "NestJS", lang: "TypeScript" },
  fastify: { name: "Fastify", lang: "JavaScript" },
  django: { name: "Django", lang: "Python" },
  flask: { name: "Flask", lang: "Python" },
  fastapi: { name: "FastAPI", lang: "Python" },
  starlette: { name: "Starlette", lang: "Python" },
  gin: { name: "Gin", lang: "Go" },
  echo: { name: "Echo", lang: "Go" },
  fiber: { name: "Fiber", lang: "Go" },
  actix: { name: "Actix", lang: "Rust" },
  axum: { name: "Axum", lang: "Rust" },
  rocket: { name: "Rocket", lang: "Rust" },
  laravel: { name: "Laravel", lang: "PHP" },
  symfony: { name: "Symfony", lang: "PHP" },
  spring: { name: "Spring", lang: "Java" },
  "spring-boot": { name: "Spring Boot", lang: "Java" },
}

// ── Helpers ──

/** Safe JSON parse — returns null on failure */
function readJsonSafe(filePath: string): Record<string, unknown> | null {
  try {
    const raw = fs.readFileSync(filePath, "utf-8")
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }
}

/** Parse package.json → languages, frameworks, package manager */
function fromPackageJson(dir: string): {
  languages: DetectedLanguage[]
  frameworks: DetectedFramework[]
  pkgManager: string | null
} {
  const pkg = readJsonSafe(path.join(dir, "package.json"))
  if (!pkg) return { languages: [], frameworks: [], pkgManager: null }

  const languages: DetectedLanguage[] = []
  const frameworks: DetectedFramework[] = []

  // Detect package manager
  const pkgManager = fs.existsSync(path.join(dir, "pnpm-lock.yaml"))
    ? "pnpm"
    : fs.existsSync(path.join(dir, "yarn.lock"))
      ? "yarn"
      : fs.existsSync(path.join(dir, "package-lock.json"))
        ? "npm"
        : null

  // Language detection from devDependencies
  const devDeps = (pkg.devDependencies ?? pkg.devDependencies) as Record<string, string> | undefined
  if (devDeps?.typescript) {
    languages.push({ lang: "TypeScript", confidence: 0.95, evidence: ["package.json → devDependencies.typescript"] })
  } else if (!devDeps?.typescript && (pkg.scripts as Record<string, string> | undefined)?.["build"]) {
    languages.push({ lang: "JavaScript", confidence: 0.7, evidence: ["package.json → scripts.build exists"] })
  }

  // If no ts dep but package.json exists, likely JS
  if (languages.length === 0) {
    languages.push({ lang: "JavaScript", confidence: 0.5, evidence: ["package.json exists"] })
  }

  // Framework detection from dependencies
  const deps = (pkg.dependencies ?? pkg.dependencies) as Record<string, string> | undefined
  const allDeps = { ...deps, ...devDeps } as Record<string, string>
  for (const [dep, sig] of Object.entries(FW_SIGNATURES)) {
    if (allDeps[dep]) {
      frameworks.push({ name: sig.name, confidence: 0.9, evidence: [`package.json → dependencies.${dep}`] })
      // Override language if framework specifies one
      const existing = languages.find(l => l.lang === sig.lang)
      if (!existing) {
        languages.push({ lang: sig.lang, confidence: 0.8, evidence: [`framework ${sig.name} → ${sig.lang}`] })
      }
    }
  }

  return { languages, frameworks, pkgManager }
}

/** Scan entry point files at root */
function scanEntryPoints(dir: string): string[] {
  const candidates = ["index.ts", "index.js", "index.mjs", "main.ts", "main.js", "app.ts", "app.js",
    "server.ts", "server.js", "main.py", "app.py", "cli.py", "main.go", "cmd/main.go",
    "src/main.rs", "src/lib.rs", "index.php"]
  const found: string[] = []
  for (const c of candidates) {
    const fp = path.join(dir, c)
    if (fs.existsSync(fp)) found.push(c)
    // Also check src/ prefix
    if (!c.startsWith("src/")) {
      const sp = path.join(dir, "src", c)
      if (fs.existsSync(sp)) found.push(`src/${c}`)
    }
  }
  return found
}

/** Scan file extensions for language clues */
function scanExtensions(dir: string): DetectedLanguage[] {
  const counts: Record<string, { count: number; lang: string }> = {
    ".ts": { count: 0, lang: "TypeScript" },
    ".tsx": { count: 0, lang: "TypeScript" },
    ".js": { count: 0, lang: "JavaScript" },
    ".jsx": { count: 0, lang: "JavaScript" },
    ".py": { count: 0, lang: "Python" },
    ".go": { count: 0, lang: "Go" },
    ".rs": { count: 0, lang: "Rust" },
    ".php": { count: 0, lang: "PHP" },
    ".java": { count: 0, lang: "Java" },
    ".rb": { count: 0, lang: "Ruby" },
    ".cs": { count: 0, lang: "C#" },
    ".swift": { count: 0, lang: "Swift" },
    ".kt": { count: 0, lang: "Kotlin" },
  }

  const exts = new Set(Object.keys(counts))

  // Scan src/ first, then root (limit to avoid huge projects)
  const dirsToScan = [
    path.join(dir, "src"),
    path.join(dir, "lib"),
    path.join(dir, "app"),
    dir,
  ]

    for (const sd of dirsToScan) {
    if (!fs.existsSync(sd)) continue
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(sd, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.isFile()) {
        const ext = path.extname(entry.name)
        if (exts.has(ext)) counts[ext].count++
      }
    }
  }

  const total = Object.values(counts).reduce((s, c) => s + c.count, 0)
  if (total === 0) return []

  const result: DetectedLanguage[] = []
  for (const [, info] of Object.entries(counts)) {
    if (info.count > 0) {
      const proportion = info.count / total
      // Confidence based on proportion — >50% is strong signal
      const confidence = Math.min(0.5 + proportion * 0.5, 0.95)
      if (confidence >= 0.3) {
        result.push({ lang: info.lang, confidence, evidence: [`${info.count} × ${info.lang} files in project`] })
      }
    }
  }

  return result.sort((a, b) => b.confidence - a.confidence)
}

/** Check other project config files for language clues */
function fromOtherConfigs(dir: string): { languages: DetectedLanguage[]; pkgManager: string | null } {
  const languages: DetectedLanguage[] = []
  let pkgManager: string | null = null

  // Python
  if (fs.existsSync(path.join(dir, "pyproject.toml"))) {
    languages.push({ lang: "Python", confidence: 0.9, evidence: ["pyproject.toml"] })
    pkgManager = "pip"
  } else if (fs.existsSync(path.join(dir, "requirements.txt"))) {
    languages.push({ lang: "Python", confidence: 0.8, evidence: ["requirements.txt"] })
    pkgManager = "pip"
  } else if (fs.existsSync(path.join(dir, "Pipfile"))) {
    languages.push({ lang: "Python", confidence: 0.8, evidence: ["Pipfile"] })
    pkgManager = "pipenv"
  } else if (fs.existsSync(path.join(dir, "poetry.lock"))) {
    languages.push({ lang: "Python", confidence: 0.85, evidence: ["poetry.lock"] })
    pkgManager = "poetry"
  }

  // Go
  if (fs.existsSync(path.join(dir, "go.mod"))) {
    languages.push({ lang: "Go", confidence: 0.95, evidence: ["go.mod"] })
    pkgManager = "go"
  }

  // Rust
  if (fs.existsSync(path.join(dir, "Cargo.toml"))) {
    languages.push({ lang: "Rust", confidence: 0.95, evidence: ["Cargo.toml"] })
    pkgManager = "cargo"
  }

  // PHP
  if (fs.existsSync(path.join(dir, "composer.json"))) {
    languages.push({ lang: "PHP", confidence: 0.9, evidence: ["composer.json"] })
    pkgManager = "composer"
  }

  // Ruby
  if (fs.existsSync(path.join(dir, "Gemfile"))) {
    languages.push({ lang: "Ruby", confidence: 0.9, evidence: ["Gemfile"] })
    pkgManager = "bundler"
  }

  // Java / Kotlin
  if (fs.existsSync(path.join(dir, "pom.xml"))) {
    languages.push({ lang: "Java", confidence: 0.9, evidence: ["pom.xml"] })
    pkgManager = "maven"
  }

  return { languages, pkgManager }
}

/** Detect test directories */
function detectTestPatterns(dir: string): string[] {
  const patterns: string[] = []
  const testDirs = ["test/", "tests/", "__tests__/", "spec/"]
  for (const td of testDirs) {
    if (fs.existsSync(path.join(dir, td))) patterns.push(td)
  }
  // Check for test config files
  if (fs.existsSync(path.join(dir, "jest.config.js")) || fs.existsSync(path.join(dir, "jest.config.ts"))) patterns.push("jest")
  if (fs.existsSync(path.join(dir, "vitest.config.ts")) || fs.existsSync(path.join(dir, "vitest.config.js"))) patterns.push("vitest")
  if (fs.existsSync(path.join(dir, "pytest.ini")) || fs.existsSync(path.join(dir, "pyproject.toml"))) {
    // pyproject.toml is TOML format — existence is enough signal
    patterns.push("pytest")
  }
  if (fs.existsSync(path.join(dir, "Cargo.toml"))) {
    // Cargo has built-in test support
    patterns.push("cargo-test")
  }
  if (fs.existsSync(path.join(dir, "go.mod"))) patterns.push("go-test")
  return [...new Set(patterns)]
}

/** Merge languages — dedupe by name, keep highest confidence + aggregate evidence */
function mergeLanguages(...sources: DetectedLanguage[][]): DetectedLanguage[] {
  const map = new Map<string, DetectedLanguage>()
  for (const list of sources) {
    for (const lang of list) {
      const existing = map.get(lang.lang)
      if (!existing || lang.confidence > existing.confidence) {
        map.set(lang.lang, {
          lang: lang.lang,
          confidence: Math.max(existing?.confidence ?? 0, lang.confidence),
          evidence: [...new Set([...(existing?.evidence ?? []), ...lang.evidence])],
        })
      }
    }
  }
  return [...map.values()].sort((a, b) => b.confidence - a.confidence)
}

// ── Cache ──

interface CacheEntry {
  cachedAt: string
  configSnapshots: Record<string, number> // filename → mtime ms
  context: Omit<ProjectContext, "cachedAt">
}

function getCachePath(projectDir: string): string {
  return path.join(projectDir, ".agentic", "project-context.json")
}

function getConfigFiles(projectDir: string): string[] {
  return [
    "package.json",
    "pyproject.toml",
    "Cargo.toml",
    "go.mod",
    "composer.json",
    "requirements.txt",
    "Pipfile",
    "Gemfile",
    "pom.xml",
    "build.gradle",
    "tsconfig.json",
    "next.config.js",
    "next.config.ts",
    "vite.config.ts",
    "vite.config.js",
  ].map(f => path.join(projectDir, f))
}

function readCache(projectDir: string): CacheEntry | null {
  try {
    const raw = fs.readFileSync(getCachePath(projectDir), "utf-8")
    return JSON.parse(raw) as CacheEntry
  } catch {
    return null
  }
}

function writeCache(projectDir: string, ctx: ProjectContext): void {
  const cachePath = getCachePath(projectDir)
  const configSnapshots: Record<string, number> = {}
  for (const fp of getConfigFiles(projectDir)) {
    try {
      configSnapshots[path.basename(fp)] = fs.statSync(fp).mtimeMs
    } catch { /* file may not exist */ }
  }
  const { cachedAt: _ca, ...contextRest } = ctx
  const entry: CacheEntry = {
    cachedAt: _ca,
    configSnapshots,
    context: contextRest,
  }
  try {
    const agenticDir = path.dirname(cachePath)
    if (!fs.existsSync(agenticDir)) fs.mkdirSync(agenticDir, { recursive: true })
    fs.writeFileSync(cachePath, JSON.stringify(entry, null, 2), "utf-8")
  } catch (e) {
    log.warn(`[ProjectContext] Failed to write cache: ${(e as Error).message}`)
  }
}

function isCacheValid(projectDir: string, cache: CacheEntry): boolean {
  for (const fp of getConfigFiles(projectDir)) {
    try {
      const mtime = fs.statSync(fp).mtimeMs
      const basename = path.basename(fp)
      if (cache.configSnapshots[basename] !== mtime) return false
    } catch {
      // File disappeared — check if it was in cache
      const basename = path.basename(fp)
      if (basename in cache.configSnapshots) return false
    }
  }
  return true
}

// ── Main detection ──

/**
 * Detect project language, framework, package manager, test patterns, and entry points.
 * Results are cached in `.agentic/project-context.json` and auto-invalidated
 * when config files change (detected via mtime).
 */
export function detectProjectContext(projectDir: string): ProjectContext {
  // 1. Try cache first
  const cache = readCache(projectDir)
  if (cache && isCacheValid(projectDir, cache)) {
    return { ...cache.context, cachedAt: cache.cachedAt }
  }

  // 2. Detect from all signals
  const fromPkg = fromPackageJson(projectDir)
  const fromConfigs = fromOtherConfigs(projectDir)
  const fromExts = scanExtensions(projectDir)
  const entryPoints = scanEntryPoints(projectDir)
  const testPatterns = detectTestPatterns(projectDir)

  // 3. Merge languages — config files are most reliable, then package.json, then extensions
  const languages = mergeLanguages(fromConfigs.languages, fromPkg.languages, fromExts)

  // 4. Frameworks — from package.json dependencies
  const frameworks = fromPkg.frameworks

  // 5. Package manager
  const pkgManager = fromPkg.pkgManager ?? fromConfigs.pkgManager

  // 6. Ambiguity score
  let ambiguity: "LOW" | "MEDIUM" | "HIGH"
  if (languages.length === 0) {
    ambiguity = "HIGH"
  } else if (languages.length === 1 && languages[0].confidence >= 0.8) {
    ambiguity = "LOW"
  } else if (languages.length <= 2 && languages.every(l => l.confidence >= 0.6)) {
    ambiguity = "MEDIUM"
  } else {
    ambiguity = "HIGH"
  }

  // Filter to only keep confidence >= 0.3
  const filteredLang = languages.filter(l => l.confidence >= 0.3)
  const filteredFw = frameworks.filter(f => f.confidence >= 0.3)

  const ctx: ProjectContext = {
    languages: filteredLang,
    frameworks: filteredFw,
    packageManager: pkgManager,
    testPatterns,
    entryPoints,
    ambiguity,
    cachedAt: new Date().toISOString(),
  }

  // 7. Write cache
  writeCache(projectDir, ctx)

  return ctx
}
