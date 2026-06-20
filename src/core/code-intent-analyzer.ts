import { readFileSync } from "node:fs"
import { basename, extname } from "node:path"
import type { CodebaseNavigator, ProjectIndex } from "./navigator.js"
import type { LLMEngine } from "./llm.js"
import type { DependencyTracker } from "../drift/dependency-tracker.js"

// ── Interfaces ──

export interface FunctionIntent {
  functionName: string
  filePath: string
  lineNumber: number
  signature: string
  inferredIntent: string
  confidence: number // 0.0 – 1.0
}

export interface FileIntent {
  filePath: string
  relativePath: string
  language: string
  exports: string[]
  imports: string[]
  functions: FunctionIntent[]
  summary: string
  complexity: "low" | "medium" | "high"
}

export interface CodeIntentMap {
  goal: string
  projectDir: string
  primaryLanguage: string | null
  files: FileIntent[]
  dependencyChain: string[] // files ordered by dependency (dependents first)
  overallSummary: string
  analysisTimestamp: number
}

// ── Per-language function detection patterns ──

interface LangPatterns {
  name: string
  extensions: string[]
  functionPattern: RegExp
  classPattern: RegExp
  methodPattern: RegExp
  commentPattern: RegExp
}

const FUNCTION_PATTERNS: LangPatterns[] = [
  {
    name: "typescript",
    extensions: [".ts", ".tsx", ".mts"],
    functionPattern: /export\s+(?:async\s+)?function\s+(\w+)|function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*[=:]\s*(?:async\s*)?(?:\([^)]*\)|[\w<>]+)\s*(?::\s*[\w<>[\]|,& ]+)?\s*=>|(?:const|let|var)\s+(\w+)\s*[=:]\s*(?:async\s*)?function/g,
    classPattern: /export\s+(?:default\s+)?(?:abstract\s+)?class\s+(\w+)|class\s+(\w+)/g,
    methodPattern: /(?:async\s+)?(\w+)\s*\([^)]*\)\s*(?::\s*[\w<>[\]|,& ]+)?\s*\{/g,
    commentPattern: /\/\/\s*(.*)/g,
  },
  {
    name: "javascript",
    extensions: [".js", ".jsx", ".mjs", ".cjs"],
    functionPattern: /(?:export\s+)?(?:async\s+)?function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*[=:]\s*(?:async\s*)?(?:\([^)]*\)|[\w<>]+)\s*(?::\s*[\w<>[\]|,& ]+)?\s*=>|(?:const|let|var)\s+(\w+)\s*[=:]\s*(?:async\s*)?function/g,
    classPattern: /(?:export\s+)?(?:default\s+)?class\s+(\w+)/g,
    methodPattern: /(\w+)\s*\([^)]*\)\s*\{/g,
    commentPattern: /\/\/\s*(.*)|(?:\/\*[\s\S]*?\*\/)/g,
  },
  {
    name: "python",
    extensions: [".py"],
    functionPattern: /(?:async\s+)?def\s+(\w+)\s*\(/g,
    classPattern: /class\s+(\w+)/g,
    methodPattern: /(?:async\s+)?def\s+(\w+)\s*\(/g,
    commentPattern: /#\s*(.*)|(?:\"\"\"[\s\S]*?\"\"\")/g,
  },
  {
    name: "go",
    extensions: [".go"],
    functionPattern: /func\s+(?:\([^)]*\)\s+)?(\w+)\s*\(/g,
    classPattern: /type\s+(\w+)\s+struct/g,
    methodPattern: /func\s+\([^)]*\)\s+(\w+)\s*\(/g,
    commentPattern: /\/\/\s*(.*)/g,
  },
  {
    name: "rust",
    extensions: [".rs"],
    functionPattern: /(?:pub\s+)?(?:async\s+)?fn\s+(\w+)\s*\(/g,
    classPattern: /(?:pub\s+)?(?:struct|enum|trait|impl)\s+(\w+)/g,
    methodPattern: /(?:pub\s+)?(?:async\s+)?fn\s+(\w+)\s*\(/g,
    commentPattern: /\/\/\s*(.*)|(?:\/\/![\s\S]*?)/g,
  },
  {
    name: "java",
    extensions: [".java"],
    functionPattern: /(?:public|private|protected)\s+(?:static\s+)?(?:[\w<>[\]]+\s+)?(\w+)\s*\(/g,
    classPattern: /(?:public\s+)?(?:abstract\s+)?(?:class|interface|enum|record)\s+(\w+)/g,
    methodPattern: /(?:public|private|protected)\s+(?:static\s+)?(?:[\w<>[\]]+\s+)?(\w+)\s*\(/g,
    commentPattern: /\/\/\s*(.*)|(?:\/\*[\s\S]*?\*\/)/g,
  },
  {
    name: "php",
    extensions: [".php"],
    functionPattern: /function\s+(\w+)\s*\(/g,
    classPattern: /class\s+(\w+)/g,
    methodPattern: /function\s+(\w+)\s*\(/g,
    commentPattern: /\/\/\s*(.*)|(?:\/\*[\s\S]*?\*\/)/g,
  },
]

// ── Intent inference heuristics ──

const INTENT_PREFIXES: Array<[RegExp, string]> = [
  [/^(get|fetch|load|find|query|search|retrieve)/i, "Read/query data: "],
  [/^(create|add|insert|new|build|construct|init)/i, "Create/initialize: "],
  [/^(update|set|save|put|patch|edit|modify|change)/i, "Update/modify: "],
  [/^(delete|remove|destroy|drop|clear|purge|clean)/i, "Delete/remove: "],
  [/^(validate|check|verify|assert|ensure|guard|sanitize)/i, "Validate/check: "],
  [/^(handle|process|on|event|trigger|notify|emit|dispatch)/i, "Handle event: "],
  [/^(parse|convert|transform|serialize|deserialize|format|encode|decode)/i, "Transform/convert: "],
  [/^(render|display|show|view|print|log|output)/i, "Render/display: "],
  [/^(is|has|can|should|contains|exists)/i, "Boolean check: "],
  [/^(config|setup|configure|register|bootstrap|initialize)/i, "Setup/configure: "],
  [/^(connect|disconnect|open|close|listen|accept)/i, "Connection/lifecycle: "],
  [/^(authorize|authenticate|login|logout|signIn|signUp)/i, "Authentication: "],
  [/^(send|push|publish|broadcast|forward|redirect)/i, "Send/output: "],
  [/^(receive|pull|pop|dequeue|collect|gather)/i, "Receive/collect: "],
  [/^(sort|filter|map|reduce|aggregate|group|batch)/i, "Data processing: "],
  [/^(calculate|compute|estimate|count|sum|average|stat)/i, "Calculation: "],
  [/^(test|spec|should|expect|assert|mock|stub)/i, "Test: "],
]

function inferIntentFromName(name: string): string {
  for (const [pattern, prefix] of INTENT_PREFIXES) {
    if (pattern.test(name)) {
      const rest = name.replace(pattern, "").replace(/([A-Z])/g, " $1").toLowerCase().trim()
      return prefix + (rest || "operation")
    }
  }
  // Fallback: split camelCase/PascalCase into words
  const words = name
    .replace(/([A-Z])/g, " $1")
    .replace(/[_\-]/g, " ")
    .toLowerCase()
    .trim()
  return words ? `Operation: ${words}` : "Unknown function"
}

function detectLanguage(ext: string): string {
  for (const lp of FUNCTION_PATTERNS) {
    if (lp.extensions.includes(ext)) return lp.name
  }
  return "unknown"
}

function getPatternsForExt(ext: string): LangPatterns | null {
  return FUNCTION_PATTERNS.find(lp => lp.extensions.includes(ext)) ?? null
}

// ── CodeIntentAnalyzer ──

export class CodeIntentAnalyzer {
  private navigator: CodebaseNavigator | null = null
  private depTracker: DependencyTracker | null = null
  private llm: LLMEngine | null = null
  private scanCache: { key: string; map: CodeIntentMap; timestamp: number } | null = null
  private readonly cacheTTL = 30_000 // 30 detik
  private cacheKey(projectDir: string): string {
    return projectDir.replace(/\/+$/, "")
  }

  setNavigator(nav: CodebaseNavigator): void {
    this.navigator = nav
    this.scanCache = null
  }

  setDependencyTracker(dt: DependencyTracker): void {
    this.depTracker = dt
    this.scanCache = null
  }

  setLLM(llm: LLMEngine): void {
    this.llm = llm
    this.scanCache = null
  }

  /** Invalidasi cache — panggil jika file project berubah */
  invalidateCache(): void {
    this.scanCache = null
  }

  /**
   * Analyze the intent of code relevant to a given goal.
   * Uses only internal tools (CodebaseNavigator, DependencyTracker) — NO MCP codegraph needed.
   */
  async analyze(goal: string, projectDir: string): Promise<CodeIntentMap> {
    const key = this.cacheKey(projectDir)
    // Check cache: key (projectDir) + TTL
    if (this.scanCache && this.scanCache.key === key && Date.now() - this.scanCache.timestamp < this.cacheTTL) {
      return this.scanCache.map
    }

    // Step 1: Scan project if navigator is available
    let projectIndex: ProjectIndex | null = null
    if (this.navigator) {
      try {
        projectIndex = await this.navigator.scan(projectDir)
      } catch {
        // Non-fatal — continue with partial data
      }
    }

    // Step 2: Find relevant files using navigator
    const relevantPaths: string[] = []
    if (this.navigator && projectIndex) {
      try {
        const found = this.navigator.findRelevantFiles(goal, 15)
        relevantPaths.push(...found)
      } catch {
        // Non-fatal
      }
    }

    // Step 3: If no relevant files found via navigator, try to find any source files
    if (relevantPaths.length === 0 && projectIndex) {
      // Fall back to all source modules
      for (const m of projectIndex.modules) {
        if (!m.ext.match(/\.(test|spec)\./i)) {
          relevantPaths.push(m.path)
        }
        if (relevantPaths.length >= 10) break
      }
    }

    // Step 4: Read files and extract functions
    const fileIntents: FileIntent[] = []
    const primaryLanguage = projectIndex?.primaryLanguage ?? null

    for (const filePath of relevantPaths) {
      const content = this.safeReadFile(filePath)
      if (!content) continue

      const ext = extname(filePath)
      const lang = detectLanguage(ext)
      const patterns = getPatternsForExt(ext)

      // Extract exports from module info
      const moduleInfo = projectIndex?.modules.find(m => m.path === filePath)
      const exports = moduleInfo?.exports ?? []
      const imports = moduleInfo?.imports ?? []

      // Extract functions
      const functions = patterns ? this.extractFunctions(content, filePath, patterns) : []

      // Generate summary
      const summary = this.generateFileSummary(filePath, content, exports, functions)

      // Determine complexity
      const complexity = this.determineComplexity(content, functions.length)

      fileIntents.push({
        filePath,
        relativePath: projectIndex ? filePath.replace(projectDir + "/", "") : filePath,
        language: lang,
        exports,
        imports,
        functions,
        summary,
        complexity,
      })
    }

    // Step 5: Build dependency chain
    let dependencyChain: string[] = []
    if (this.depTracker && projectIndex) {
      try {
        dependencyChain = this.buildDependencyChain(fileIntents, projectIndex)
      } catch {
        // Non-fatal
      }
    }

    // Step 6: Generate overall summary
    const overallSummary = this.generateOverallSummary(goal, fileIntents, primaryLanguage)

    // Step 7: Optionally enhance with LLM
    if (this.llm && fileIntents.length > 0) {
      try {
        await this.enhanceWithLLM(fileIntents, goal)
      } catch {
        // LLM enhancement is optional — non-fatal
      }
    }

    const map: CodeIntentMap = {
      goal,
      projectDir,
      primaryLanguage,
      files: fileIntents,
      dependencyChain,
      overallSummary,
      analysisTimestamp: Date.now(),
    }

    // Cache for TTL
    this.scanCache = { key, map, timestamp: Date.now() }

    return map
  }

  /**
   * Get a compact context string for injection into LLM prompts.
   */
  getContextSummary(intentMap: CodeIntentMap, maxFiles = 5): string {
    if (intentMap.files.length === 0) return ""

    const lines: string[] = [
      `<code-intent-analysis>`,
      `  <summary>${this.escapeXml(intentMap.overallSummary)}</summary>`,
      `  <primary-language>${intentMap.primaryLanguage ?? "unknown"}</primary-language>`,
    ]

    const filesToShow = intentMap.files.slice(0, maxFiles)
    for (const file of filesToShow) {
      lines.push(`  <file path="${this.escapeXml(file.relativePath)}" lang="${file.language}" complexity="${file.complexity}">`)
      lines.push(`    <summary>${this.escapeXml(file.summary)}</summary>`)

      if (file.functions.length > 0) {
        lines.push(`    <functions>`)
        const funcsToShow = file.functions.slice(0, 8) // cap per file
        for (const fn of funcsToShow) {
          lines.push(`      <function name="${this.escapeXml(fn.functionName)}" line="${fn.lineNumber}" confidence="${fn.confidence.toFixed(2)}">`)
          lines.push(`        <intent>${this.escapeXml(fn.inferredIntent)}</intent>`)
          lines.push(`        <signature>${this.escapeXml(fn.signature.slice(0, 120))}</signature>`)
          lines.push(`      </function>`)
        }
        if (file.functions.length > 8) {
          lines.push(`      <!-- ... and ${file.functions.length - 8} more functions -->`)
        }
        lines.push(`    </functions>`)
      }

      if (file.exports.length > 0) {
        lines.push(`    <exports>${this.escapeXml(file.exports.join(", "))}</exports>`)
      }

      if (intentMap.dependencyChain.length > 1) {
        lines.push(`    <dependents>${this.countDependents(file.relativePath, intentMap.dependencyChain)} dependents</dependents>`)
      }

      lines.push(`  </file>`)
    }

    if (intentMap.files.length > maxFiles) {
      lines.push(`  <!-- ${intentMap.files.length - maxFiles} more files omitted -->`)
    }

    // Dependency chain summary
    if (intentMap.dependencyChain.length > 1) {
      lines.push(`  <dependency-chain>${this.escapeXml(intentMap.dependencyChain.join(" → "))}</dependency-chain>`)
    }

    lines.push(`</code-intent-analysis>`)

    return lines.join("\n")
  }

  /** Get a plain-text compact summary (smaller than XML, for constrained contexts) */
  getCompactSummary(intentMap: CodeIntentMap, maxFiles = 3): string {
    if (intentMap.files.length === 0) return ""

    const parts: string[] = [`[Code Intent: ${intentMap.primaryLanguage ?? "?"}] ${intentMap.overallSummary}`]

    for (const file of intentMap.files.slice(0, maxFiles)) {
      const funcNames = file.functions.slice(0, 5).map(f => `${f.functionName}(${f.inferredIntent})`).join(", ")
      parts.push(`  ${file.relativePath}: ${file.summary}${funcNames ? ` → ${funcNames}` : ""}`)
    }

    if (intentMap.files.length > maxFiles) {
      parts.push(`  ... +${intentMap.files.length - maxFiles} more files`)
    }

    return parts.join("\n")
  }

  // ── Private helpers ──

  private safeReadFile(filePath: string): string | null {
    try {
      return readFileSync(filePath, "utf-8")
    } catch {
      return null
    }
  }

  private extractFunctions(content: string, filePath: string, patterns: LangPatterns): FunctionIntent[] {
    const functions: FunctionIntent[] = []
    const seen = new Set<string>()

    // Extract named function declarations
    let match: RegExpExecArray | null
    const funcRegex = new RegExp(patterns.functionPattern)
    while ((match = funcRegex.exec(content)) !== null) {
      const name = match[1] ?? match[2] ?? match[3] ?? match[4]
      if (!name || name === "if" || name === "for" || name === "while" || name === "switch") continue

      const lineNumber = this.getLineNumber(content, match.index)
      const sigEnd = content.indexOf("{", match.index)
      const signature = sigEnd !== -1
        ? content.slice(match.index, sigEnd + 1).trim()
        : content.slice(match.index, match.index + 80).trim()

      const intent = inferIntentFromName(name)
      const confidence = intent.startsWith("Unknown") ? 0.3 : 0.6

      const key = `${name}:${lineNumber}`
      if (!seen.has(key)) {
        seen.add(key)
        functions.push({ functionName: name, filePath, lineNumber, signature, inferredIntent: intent, confidence })
      }
    }

    // Also look for class methods if this is a class-based file
    // Extract class names first
    const classRegex = new RegExp(patterns.classPattern)
    while ((match = classRegex.exec(content)) !== null) {
      const className = match[1] ?? match[2]
      if (!className) continue

      // Find class body and extract methods (using indentation heuristic)
      const classStart = match.index
      const classBodyStart = content.indexOf("{", classStart)
      if (classBodyStart === -1) continue

      // Find the class body range
      const bodyEnd = this.findBlockEnd(content, classBodyStart)
      const classBody = content.slice(classBodyStart, bodyEnd)

      // Extract methods from class body
      const methodRegex = new RegExp(patterns.methodPattern)
      let methodMatch: RegExpExecArray | null
      while ((methodMatch = methodRegex.exec(classBody)) !== null) {
        const methodName = methodMatch[1]
        if (!methodName || methodName === "if" || methodName === "for" || methodName === "while" || methodName === "switch") continue
        if (seen.has(`${methodName}:${this.getLineNumber(content, classBodyStart + methodMatch.index)}`)) continue

        const absLine = this.getLineNumber(content, classBodyStart + methodMatch.index)
        const sig = classBody.slice(methodMatch.index, methodMatch.index + 80).trim()
        const intent = `${className}.${methodName}() — ${inferIntentFromName(methodName)}`
        const confidence = 0.5

        const key = `${methodName}:${absLine}`
        if (!seen.has(key)) {
          seen.add(key)
          functions.push({
            functionName: `${className}.${methodName}`,
            filePath,
            lineNumber: absLine,
            signature: sig,
            inferredIntent: intent,
            confidence,
          })
        }
      }
    }

    // Sort by line number
    functions.sort((a, b) => a.lineNumber - b.lineNumber)

    return functions
  }

  private getLineNumber(content: string, index: number): number {
    const before = content.slice(0, index)
    return before.split("\n").length
  }

  private findBlockEnd(content: string, openBraceIndex: number): number {
    let depth = 0
    let inString = false
    let stringChar = ""

    for (let i = openBraceIndex; i < content.length; i++) {
      const ch = content[i]

      if (inString) {
        if (ch === stringChar && content[i - 1] !== "\\") inString = false
        continue
      }

      if (ch === "'" || ch === '"' || ch === "`") {
        inString = true
        stringChar = ch
        continue
      }

      if (ch === "{") depth++
      else if (ch === "}") {
        depth--
        if (depth === 0) return i + 1
      }
    }

    return content.length
  }

  private generateFileSummary(filePath: string, content: string, exports: string[], functions: FunctionIntent[]): string {
    const name = basename(filePath)
    const lines = content.split("\n").length
    const funcCount = functions.length

    let summary = `${name} (${lines} lines, ${funcCount} functions)`

    if (exports.length > 0) {
      const expStr = exports.slice(0, 5).join(", ")
      summary += `. Exports: ${expStr}${exports.length > 5 ? ` +${exports.length - 5} more` : ""}`
    }

    // Check for common patterns
    if (/\binterface\b|\btype\b/.test(content) && (extname(filePath).match(/\.ts|\.tsx/))) {
      summary += ". Contains type definitions."
    }
    if (/\bclass\b/.test(content)) {
      summary += ". Contains class definitions."
    }
    if (/\bimport\s+(React|Vue|Angular)\b/.test(content)) {
      summary += ". UI component."
    }
    if (/\btest|describe|it\(|assert|expect\b/.test(content)) {
      summary += ". Test file."
    }

    return summary
  }

  private determineComplexity(content: string, funcCount: number): "low" | "medium" | "high" {
    const lines = content.split("\n").length
    if (lines > 300 || funcCount > 15) return "high"
    if (lines > 100 || funcCount > 5) return "medium"
    return "low"
  }

  private buildDependencyChain(fileIntents: FileIntent[], _projectIndex: ProjectIndex): string[] {
    // Build a simple dependency chain: files ordered by dependency
    // Files that depend on others come first (dependents first, then providers)
    const fileSet = new Set(fileIntents.map(f => f.relativePath))
    const ordered: string[] = []

    // First pass: files that import others (dependents)
    for (const file of fileIntents) {
      const localImports = file.imports.filter(i => fileSet.has(i))
      if (localImports.length > 0 && !ordered.includes(file.relativePath)) {
        ordered.push(file.relativePath)
      }
    }

    // Second pass: files that are imported but don't import others
    const allImportedButNotFirst = new Set<string>()
    for (const file of fileIntents) {
      for (const imp of file.imports) {
        if (fileSet.has(imp) && !ordered.includes(imp)) {
          allImportedButNotFirst.add(imp)
        }
      }
    }
    for (const imp of allImportedButNotFirst) {
      if (!ordered.includes(imp)) {
        // Insert after dependents
        const firstDependent = fileIntents.find(f => f.imports.includes(imp))
        const idx = firstDependent ? ordered.indexOf(firstDependent.relativePath) : -1
        if (idx >= 0) {
          ordered.splice(idx + 1, 0, imp)
        } else {
          ordered.push(imp)
        }
      }
    }

    // Remaining files that don't import or get imported
    for (const file of fileIntents) {
      if (!ordered.includes(file.relativePath)) {
        ordered.push(file.relativePath)
      }
    }

    return ordered
  }

  private countDependents(relativePath: string, dependencyChain: string[]): number {
    // Count how many files depend on this one in the chain
    const idx = dependencyChain.indexOf(relativePath)
    if (idx === -1) return 0
    // Files after this one in the chain likely depend on it
    return Math.max(0, dependencyChain.length - idx - 1)
  }

  private generateOverallSummary(goal: string, files: FileIntent[], primaryLanguage: string | null): string {
    const lang = primaryLanguage ?? "unknown"
    const totalFiles = files.length
    const totalFuncs = files.reduce((s, f) => s + f.functions.length, 0)

    return `Analyzed ${totalFiles} files, ${totalFuncs} functions in ${lang}. Goal: "${goal.slice(0, 80)}". Files ready for implementation with program-analysis grounding.`
  }

  private async enhanceWithLLM(files: FileIntent[], goal: string): Promise<void> {
    if (!this.llm) return

    // Only enhance files with low-confidence functions
    const lowConfFiles = files.filter(f =>
      f.functions.some(fn => fn.confidence < 0.5)
    )

    if (lowConfFiles.length === 0) return

    // Build a prompt with function signatures for LLM to analyze
    const funcsToEnhance = lowConfFiles.flatMap(f =>
      f.functions.filter(fn => fn.confidence < 0.5).map(fn => ({
        file: f.relativePath,
        name: fn.functionName,
        signature: fn.signature.slice(0, 200),
      }))
    ).slice(0, 20) // cap

    if (funcsToEnhance.length === 0) return

    const prompt = `Given the goal "${goal}", analyze the intended behavior of these functions based on their names and signatures. Return JSON array of {name, file, intent}.`

    const funcDetails = funcsToEnhance.map(f =>
      `- ${f.name} in ${f.file}: ${f.signature}`
    ).join("\n")

    const response = await this.llm.call({
      systemPrompt: "You are an intent inference engine. Given a software goal and function signatures, infer what each function is intended to do. Be specific and concise. Return JSON array only.",
      userPrompt: `${prompt}\n\nFunctions:\n${funcDetails}`,
      jsonMode: true,
      temperature: 0.2,
      maxTokens: 1000,
    })

    try {
      const parsed = JSON.parse(response.content)
      const enhancements = Array.isArray(parsed) ? parsed : (parsed.intents ?? parsed.functions ?? [])
      if (!Array.isArray(enhancements)) return

      for (const enh of enhancements) {
        const file = files.find(f => f.relativePath === enh.file || f.filePath === enh.file)
        if (!file) continue
        const fn = file.functions.find(f => f.functionName === enh.name)
        if (!fn) continue
        if (enh.intent && typeof enh.intent === "string") {
          fn.inferredIntent = enh.intent
          fn.confidence = Math.min(1.0, fn.confidence + 0.3)
        }
      }
    } catch {
      // LLM enhancement is optional — non-fatal
    }
  }

  private escapeXml(str: string): string {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;")
  }
}

/** Singleton instance */
export const codeIntentAnalyzer = new CodeIntentAnalyzer()
