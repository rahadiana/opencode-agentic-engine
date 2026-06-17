import { readdir, readFile, stat, access } from "node:fs/promises"
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
  language: "typescript" | "javascript" | "python" | "unknown"
  hasTests: boolean
  testDir: string | null
  srcDir: string | null
}

export class CodebaseNavigator {
  private index: ProjectIndex | null = null

  async scan(root: string): Promise<ProjectIndex> {
    if (this.index) return this.index

    const modules: ModuleInfo[] = []
    const srcDir = await this.findDir(root, ["src", "lib", "app", "source"])
    const testDir = await this.findDir(root, ["test", "tests", "spec", "__tests__"])

    const scanDir = srcDir ?? root
    await this.walk(scanDir, modules, root)

    const hasTests = testDir !== null
    const language = this.detectLanguage(modules)

    this.index = { root, modules, language, hasTests, testDir, srcDir }
    return this.index
  }

  findRelevantFiles(taskDescription: string, maxFiles = 10): string[] {
    if (!this.index) return []

    const keywords = taskDescription
      .toLowerCase()
      .split(/[\s,_\-.:/]+/)
      .filter(w => w.length > 2)

    const scored = this.index.modules.map(m => {
      let score = 0
      const name = m.name.toLowerCase()
      const path = m.path.toLowerCase()

      for (const kw of keywords) {
        if (name.includes(kw)) score += 10
        if (path.includes(kw)) score += 5
        if (m.imports.some(i => i.toLowerCase().includes(kw))) score += 3
        if (m.exports.some(e => e.toLowerCase().includes(kw))) score += 8
      }

      if (m.ext === ".test.ts" || m.ext === ".spec.ts") score -= 2

      return { path: m.path, score }
    })

    return scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxFiles)
      .map(s => s.path)
  }

  getTestFiles(sourceFile: string): string[] {
    if (!this.index) return []
    const stem = basename(sourceFile, extname(sourceFile))
    const dir = dirname(sourceFile)

    const candidates = [
      join(dir, `${stem}.test.ts`),
      join(dir, `${stem}.spec.ts`),
      join(dir, "__tests__", `${stem}.test.ts`),
    ]

    if (this.index.testDir) {
      const relDir = dir.replace(this.index.srcDir ?? this.index.root, "")
      candidates.push(join(this.index.testDir, relDir, `${stem}.test.ts`))
      candidates.push(join(this.index.testDir, `${stem}.test.ts`))
    }

    return candidates.filter(t => this.index!.modules.some(m => m.path === t))
  }

  getSummary(): string {
    if (!this.index) return "No index available. Run scan first."

    const i = this.index
    return [
      `**Root:** ${i.root}`,
      `**Language:** ${i.language}`,
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

  /**
   * Check if a path is a system/OS directory that should never be scanned.
   * Prevents navigator from scanning /lib, /usr, /var, etc. when root is "/".
   */
  private isSystemDirectory(dirPath: string): boolean {
    const systemPrefixes = [
      "/lib", "/usr", "/var", "/etc", "/boot", "/sys", "/proc",
      "/dev", "/run", "/snap", "/opt", "/sbin", "/bin",
    ]
    const normalized = dirPath.replace(/\/+$/, "")
    return systemPrefixes.some(prefix => normalized === prefix || normalized.startsWith(prefix + "/"))
  }

  private async findDir(root: string, names: string[]): Promise<string | null> {
    // Safety: never scan from root "/" or system directories
    if (this.isSystemDirectory(root)) return null

    for (const name of names) {
      const p = join(root, name)
      try {
        // Safety: reject if resolved path escapes root or is a system directory
        const resolved = await stat(p)
        if (!resolved.isDirectory()) continue
        if (this.isSystemDirectory(p)) continue
        return p
      } catch { /* skip */ }
    }
    return null
  }

  private async walk(dir: string, modules: ModuleInfo[], root: string, depth = 0): Promise<void> {
    // Safety: limit recursion depth to prevent scanning entire filesystem
    if (depth > 10) return

    // Safety: never walk into system directories
    if (this.isSystemDirectory(dir)) return

    // Safety: stop if we've escaped the root directory
    const resolvedDir = dir.replace(/\/+$/, "")
    const resolvedRoot = root.replace(/\/+$/, "")
    if (resolvedDir !== resolvedRoot && !resolvedDir.startsWith(resolvedRoot + "/")) {
      return
    }

    let entries: Dirent[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist" || entry.name === ".agentic") continue
        await this.walk(fullPath, modules, root, depth + 1)
      } else if (entry.isFile()) {
        const ext = extname(entry.name)
        if (![".ts", ".tsx", ".js", ".jsx", ".mjs", ".mts"].includes(ext)) continue

        let size = 0
        try { size = (await stat(fullPath)).size } catch { /* skip */ }

        const imports: string[] = []
        const exports: string[] = []
        try {
          const content = await readFile(fullPath, "utf-8")
          for (const line of content.split("\n")) {
            const impMatch = line.match(/import\s+.*?from\s+['"](.+?)['"]/)
            if (impMatch) imports.push(impMatch[1])
            const expMatch = line.match(/export\s+(const|function|class|interface|type|default)\s+(\w+)/)
            if (expMatch) exports.push(expMatch[2])
          }
        } catch { /* skip */ }

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

  private detectLanguage(modules: ModuleInfo[]): ProjectIndex["language"] {
    const ts = modules.filter(m => [".ts", ".tsx", ".mts"].includes(m.ext)).length
    const js = modules.filter(m => [".js", ".jsx", ".mjs"].includes(m.ext)).length
    if (ts > js) return "typescript"
    if (js > ts) return "javascript"
    if (ts + js > 0) return "unknown"
    return "unknown"
  }
}
