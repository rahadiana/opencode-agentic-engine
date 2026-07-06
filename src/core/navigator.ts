import { readdir, readFile, stat } from "node:fs/promises"
import type { Dirent } from "node:fs"
import { join, extname, basename, dirname } from "node:path"

export interface ModuleInfo {
  path: string
  name: string
  ext: string
  size: number
  exports: string[]
  imports: string[]
}

export interface ProjectIndex {
  root: string
  modules: ModuleInfo[]
  detectedLangs: string[]
  primaryLanguage: string | null
  hasTests: boolean
  testDir: string | null
  srcDir: string | null
}

export interface LanguageConfig {
  name: string
  projectFiles: string[]
  sourceExtensions: string[]
  testExtensions: string[]
  testDirNames: string[]
  srcDirNames: string[]
  skipDirs: string[]
  importPattern: RegExp
  exportPattern: RegExp
}

const BUILTIN_LANGUAGES: LanguageConfig[] = [
  {
    name: "typescript",
    projectFiles: ["tsconfig.json"],
    sourceExtensions: [".ts", ".tsx", ".mts"],
    testExtensions: [".test.ts", ".spec.ts", ".test.tsx", ".spec.tsx"],
    testDirNames: ["test", "tests", "spec", "__tests__"],
    srcDirNames: ["src", "lib", "app"],
    skipDirs: ["node_modules", "dist", ".git", ".agentic"],
    importPattern: /import\s+.*?from\s+['"](.+?)['"]/,
    exportPattern: /export\s+(const|function|class|interface|type|default)\s+(\w+)/,
  },
  {
    name: "javascript",
    projectFiles: ["package.json"],
    sourceExtensions: [".js", ".jsx", ".mjs", ".cjs"],
    testExtensions: [".test.js", ".spec.js", ".test.jsx", ".spec.jsx"],
    testDirNames: ["test", "tests", "spec", "__tests__"],
    srcDirNames: ["src", "lib", "app"],
    skipDirs: ["node_modules", "dist", ".git", ".agentic"],
    importPattern: /(?:import\s+.*?from\s+['"](.+?)['"])|(?:require\(['"](.+?)['"]\))/,
    exportPattern: /(?:module\.exports\s*=|export\s+(?:default\s+)?(?:const|function|class))\s+(\w+)/,
  },
  {
    name: "python",
    projectFiles: ["pyproject.toml", "setup.py", "requirements.txt"],
    sourceExtensions: [".py"],
    testExtensions: ["_test.py", "test_.py", "_test.py", ".test.py"],
    testDirNames: ["test", "tests"],
    srcDirNames: ["src", "app", "lib"],
    skipDirs: ["__pycache__", ".git", ".venv", "venv", "env", ".agentic"],
    importPattern: /(?:import\s+(\w+))|(?:from\s+(\w+)\s+import)/,
    exportPattern: /(?:def|class|async\s+def)\s+(\w+)/,
  },
  {
    name: "php",
    projectFiles: ["composer.json"],
    sourceExtensions: [".php"],
    testExtensions: ["Test.php"],
    testDirNames: ["test", "tests"],
    srcDirNames: ["src", "app", "lib"],
    skipDirs: ["vendor", ".git", ".agentic"],
    importPattern: /use\s+([\w\\]+)/,
    exportPattern: /(?:class|interface|trait|function)\s+(\w+)/,
  },
  {
    name: "go",
    projectFiles: ["go.mod"],
    sourceExtensions: [".go"],
    testExtensions: ["_test.go"],
    testDirNames: [],
    srcDirNames: ["cmd", "pkg", "internal", "lib"],
    skipDirs: [".git", ".agentic", "vendor"],
    importPattern: /(?:"([^"]+)"|`([^`]+)`)/,
    exportPattern: /func\s+(\w+)/,
  },
  {
    name: "rust",
    projectFiles: ["Cargo.toml"],
    sourceExtensions: [".rs"],
    testExtensions: [".test.rs"],
    testDirNames: ["test", "tests"],
    srcDirNames: ["src", "lib"],
    skipDirs: ["target", ".git", ".agentic"],
    importPattern: /use\s+(\w+(?:::\w+)*)/,
    exportPattern: /(?:pub\s+)?fn\s+(\w+)/,
  },
  {
    name: "java",
    projectFiles: ["pom.xml", "build.gradle", "build.gradle.kts"],
    sourceExtensions: [".java"],
    testExtensions: ["Test.java"],
    testDirNames: ["test", "tests", "src/test"],
    srcDirNames: ["src/main", "src", "app", "lib"],
    skipDirs: [".git", ".agentic", "target", "build", ".gradle"],
    importPattern: /import\s+([\w.]+)/,
    exportPattern: /(?:class|interface|enum|record)\s+(\w+)/,
  },
  {
    name: "generic",
    projectFiles: [],
    sourceExtensions: [".md", ".txt", ".yaml", ".yml", ".json", ".toml", ".csv", ".xml", ".html", ".css"],
    testExtensions: [],
    testDirNames: [],
    srcDirNames: [],
    skipDirs: [".git", ".agentic", "node_modules", "vendor", "target", "__pycache__"],
    importPattern: /./,
    exportPattern: /./,
  },
]

export class CodebaseNavigator {
  private index: ProjectIndex | null = null
  private languages: LanguageConfig[] = [...BUILTIN_LANGUAGES]
  /** Cache untuk scan — hindari re-scan penuh dalam 30 detik */
  private scanCache: { root: string; timestamp: number } | null = null
  // Graph Harness §5.4: Cache TTL 30s → 300s (5 menit) untuk mengurangi filesystem walk
  // yang tidak perlu. Setiap agentic_nav call sebelumnya memicu full scan karena TTL terlalu pendek.
  private readonly scanCacheTTL = 300_000 // 5 menit
  setLanguages(langs: LanguageConfig[]): void {
    this.languages = langs
    this.index = null
    this.scanCache = null
  }

  /** Invalidasi cache scan — panggil jika file project berubah */
  invalidateCache(): void {
    this.scanCache = null
  }

  async scan(root: string): Promise<ProjectIndex> {
    // Cache: jika root sama dan masih dalam TTL, balikkan index yang ada
    if (this.index && this.scanCache && this.scanCache.root === root &&
        Date.now() - this.scanCache.timestamp < this.scanCacheTTL) {
      return this.index
    }
    this.index = null
    const modules: ModuleInfo[] = []

    const detected = await this.detectProjectLanguages(root)
    const primary = detected.length > 0 ? detected[0] : null
    const langConfig = primary ? this.languages.find(l => l.name === primary) ?? this.languages[this.languages.length - 1] : this.languages[this.languages.length - 1]

    const srcDir = langConfig.srcDirNames.length > 0 ? await this.findDir(root, langConfig.srcDirNames) : null
    const testDir = langConfig.testDirNames.length > 0 ? await this.findDir(root, langConfig.testDirNames) : null

    const scanDir = srcDir ?? root
    await this.walk(scanDir, modules, root, langConfig)

    const hasTests = testDir !== null
    if (testDir && langConfig.sourceExtensions.length > 0) {
      await this.walk(testDir, modules, root, langConfig)
    }

    this.index = { root, modules, detectedLangs: detected, primaryLanguage: primary, hasTests, testDir, srcDir }
    this.scanCache = { root, timestamp: Date.now() }
    return this.index
  }

  private async detectProjectLanguages(root: string): Promise<string[]> {
    const detected: string[] = []
    const checks = this.languages.flatMap(lang =>
      lang.projectFiles.map(pf => ({ lang, pf }))
    )
    const results = await Promise.allSettled(
      checks.map(({ lang, pf }) =>
        stat(join(root, pf)).then(() => ({ lang, exists: true })).catch(() => ({ lang, exists: false }))
      )
    )
    for (const r of results) {
      if (r.status === "fulfilled" && r.value.exists && !detected.includes(r.value.lang.name)) {
        detected.push(r.value.lang.name)
      }
    }
    return detected
  }

  findRelevantFiles(taskDescription: string, maxFiles = 10): string[] {
    if (!this.index) return []

    const keywords = taskDescription
      .toLowerCase()
      .split(/[\s,_\-.:/]+/)
      .filter(w => w.length > 2)

    const isTestTask = /\b(test|spec|verify|assert|qa)\b/i.test(taskDescription)

    const totalModules = this.index.modules.length
    const kwDocFreq = new Map<string, number>()
    for (const kw of keywords) {
      let count = 0
      for (const m of this.index.modules) {
        if (m.name.toLowerCase().includes(kw) || m.path.toLowerCase().includes(kw)) count++
      }
      kwDocFreq.set(kw, count)
    }

    const scored = this.index.modules.map(m => {
      let score = 0
      const name = m.name.toLowerCase()
      const path = m.path.toLowerCase()

      for (const kw of keywords) {
        const df = kwDocFreq.get(kw) ?? 1
        const idf = Math.log(1 + totalModules / (1 + df))
        if (name.includes(kw)) score += 10 * idf
        if (path.includes(kw)) score += 5 * idf
        if (m.imports.some(i => i.toLowerCase().includes(kw))) score += 3 * idf
        if (m.exports.some(e => e.toLowerCase().includes(kw))) score += 8 * idf
      }

      if (!isTestTask && m.ext.match(/test|spec/)) score -= 2

      return { path: m.path, score }
    })

    return scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxFiles)
      .map(s => s.path)
  }

  getTestFiles(sourceFile: string): string[] {
    if (!this.index || !this.index.primaryLanguage) return []
    const langConfig = this.languages.find(l => l.name === this.index!.primaryLanguage)
    if (!langConfig || langConfig.testExtensions.length === 0) return []

    const stem = basename(sourceFile, extname(sourceFile))
    const dir = dirname(sourceFile)

    const candidates: string[] = []
    for (const testExt of langConfig.testExtensions) {
      if (testExt.startsWith("_")) {
        candidates.push(join(dir, `${stem}${testExt}`))
      } else if (testExt.endsWith(".php")) {
        candidates.push(join(dir, `${stem}${testExt}`))
      } else {
        candidates.push(join(dir, `${stem}${testExt}`))
        candidates.push(join(dir, "__tests__", `${stem}${testExt}`))
      }
    }

    if (this.index.testDir) {
      const relDir = dir.replace(this.index.srcDir ?? this.index.root, "")
      for (const testExt of langConfig.testExtensions) {
        candidates.push(join(this.index.testDir, relDir, `${stem}${testExt}`))
        candidates.push(join(this.index.testDir, `${stem}${testExt}`))
      }
    }

    return candidates.filter(t => this.index!.modules.some(m => m.path === t))
  }

  getSummary(): string {
    if (!this.index) return "No index available. Run scan first."

    const i = this.index
    return [
      `**Root:** ${i.root}`,
      `**Language:** ${i.primaryLanguage ?? "unknown"}${i.detectedLangs.length > 1 ? ` (also: ${i.detectedLangs.slice(1).join(", ")})` : ""}`,
      `**Modules:** ${i.modules.length} files`,
      `**Tests:** ${i.hasTests ? `Yes (${i.testDir})` : "No test directory found"}`,
      `**Source:** ${i.srcDir ?? i.root}`,
      ``,
      `**File breakdown:**`,
      ...this.groupByDir(i.modules).map(([dir, count]) => `  ${dir}: ${count} files`),
    ].join("\n")
  }

  private groupByDir(modules: ModuleInfo[]): Array<[string, number]> {
    const groups = new Map<string, number>()
    for (const m of modules) {
      const dir = dirname(m.path)
      groups.set(dir, (groups.get(dir) ?? 0) + 1)
    }
    return [...groups].sort((a, b) => b[1] - a[1])
  }

  private isSystemDirectory(dirPath: string): boolean {
    const normalized = dirPath.replace(/[/\\]+$/, "").replace(/\\/g, "/")
    if (normalized === "/") return true
    const systemPrefixes = [
      "/lib", "/usr", "/var", "/etc", "/boot", "/sys", "/proc",
      "/dev", "/run", "/snap", "/opt", "/sbin", "/bin",
    ]
    return systemPrefixes.some(prefix => normalized === prefix || normalized.startsWith(prefix + "/"))
  }

  private async findDir(root: string, names: string[]): Promise<string | null> {
    if (this.isSystemDirectory(root)) return null
    for (const name of names) {
      const p = join(root, name)
      try {
        const resolved = await stat(p)
        if (!resolved.isDirectory()) continue
        if (this.isSystemDirectory(p)) continue
        return p
      } catch { console.warn("catch: non-fatal") }
    }
    return null
  }

  private async walk(dir: string, modules: ModuleInfo[], root: string, lang: LanguageConfig, depth = 0): Promise<void> {
    if (depth > 10) return
    if (this.isSystemDirectory(dir)) return

    const resolvedDir = dir.replace(/\/+$/, "")
    const resolvedRoot = root.replace(/\/+$/, "")
    if (resolvedDir !== resolvedRoot && !resolvedDir.startsWith(resolvedRoot + "/")) return

    let entries: Dirent[]
    try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }

    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (lang.skipDirs.includes(entry.name)) continue
        await this.walk(fullPath, modules, root, lang, depth + 1)
      } else if (entry.isFile()) {
        const ext = extname(entry.name)
        if (!lang.sourceExtensions.includes(ext)) continue

        let size = 0
        try { size = (await stat(fullPath)).size } catch { console.warn("catch: skip") }

        const imports: string[] = []
        const exports: string[] = []
        try {
          const content = await readFile(fullPath, "utf-8")
          const headerLines = content.split("\n").slice(0, 50)
          for (const line of headerLines) {
            const impMatch = line.match(lang.importPattern)
            if (impMatch) {
              const captured = impMatch[1] ?? impMatch[2]
              if (captured) imports.push(captured)
            }
            const expMatch = line.match(lang.exportPattern)
            if (expMatch) exports.push(expMatch[expMatch.length - 1])
          }
        } catch { console.warn("catch: skip") }

        modules.push({
          path: fullPath,
          name: entry.name.replace(ext, ""),
          ext,
          size,
          exports,
          imports,
        })
      }
    }
  }
}
