/**
 * Code Sandbox — Safe code generation, execution, and module registry.
 *
 * Comparison 24 (Code Generation Sandbox):
 * - LLM generates real JavaScript/TypeScript module (bukan DSL instructions)
 * - Static validation: banned tokens checker
 * - Sandbox VM: Node.js vm.createContext + vm.Script + timeout
 * - Pure function: single entrypoint handler(input), no global/network/fs access
 * - Test runner: execute with test cases, calculate pass rate
 * - Fallback chain: if code fails → fallback to DSL
 * - Code Module Registry: store reusable code modules
 */

import vm from "node:vm"
import crypto from "node:crypto"

// ── Banned Token Definitions ───────────────────────────────────────

/**
 * A banned token pattern to detect dangerous code.
 */
export interface BannedToken {
  /** Human-readable name */
  name: string
  /** Regex pattern to detect */
  pattern: RegExp
  /** Severity level */
  severity: "error" | "warning"
  /** Explanation of why this is banned */
  reason: string
}

/**
 * Result of a banned token check.
 */
export interface BannedTokenIssue {
  token: string
  severity: "error" | "warning"
  reason: string
  line?: number
}

/**
 * Default set of banned tokens for safe code execution.
 * Prevents access to file system, network, process, and code injection.
 */
export const DEFAULT_BANNED_TOKENS: BannedToken[] = [
  { name: "require", pattern: /\brequire\s*\(/g, severity: "error", reason: "File system access via require()" },
  { name: "import expression", pattern: /\bimport\s*\(/g, severity: "error", reason: "Dynamic import — file system access" },
  { name: "process", pattern: /\bprocess\./g, severity: "error", reason: "Node.js process/env access" },
  { name: "fs module", pattern: /\bfs\./g, severity: "error", reason: "File system operations" },
  { name: "eval", pattern: /\beval\s*\(/g, severity: "error", reason: "Arbitrary code injection" },
  { name: "Function constructor", pattern: /\bnew\s+Function\s*\(/g, severity: "error", reason: "Code injection via Function constructor" },
  { name: "child_process", pattern: /child_process/g, severity: "error", reason: "Process spawning" },
  { name: "exec", pattern: /\b(exec|execSync|execFile|execFileSync|spawn|spawnSync|fork)\s*\(/g, severity: "error", reason: "Command execution" },
  { name: "fetch / XMLHttpRequest", pattern: /\b(fetch|XMLHttpRequest)\s*\(/g, severity: "warning", reason: "Network access (may be intentional)" },
  { name: "WebSocket", pattern: /\bWebSocket\s*\(/g, severity: "warning", reason: "Network access via WebSocket" },
  { name: "setTimeout infinite", pattern: /\bset(Timeout|Interval)\s*\(\s*(0|[1-9]\d{0,2})\s*\)/g, severity: "warning", reason: "Possible infinite or very short timeout" },
  { name: "global / globalThis mutation", pattern: /\b(global|globalThis)\.\s*[a-zA-Z_$]/g, severity: "error", reason: "Global scope mutation" },
  { name: "Reflect / Proxy dangerous", pattern: /\b(Reflect\.construct|Proxy)\s*\(/g, severity: "warning", reason: "Meta-programming may bypass sandbox" },
  { name: "constructor override", pattern: /\.constructor\s*=/g, severity: "error", reason: "Prototype pollution attempt" },
  { name: "__proto__", pattern: /__proto__/g, severity: "error", reason: "Prototype pollution attempt" },
]

// ── Interfaces ─────────────────────────────────────────────────────

/**
 * Schema field definition for code module input/output.
 */
export interface SandboxSchemaField {
  type: "string" | "number" | "boolean" | "array" | "object"
  description?: string
}

/**
 * A reusable code module generated and validated by the sandbox.
 */
export interface CodeModule {
  /** Unique identifier */
  id: string
  /** Human-readable name */
  name: string
  /** Programming language */
  language: "javascript" | "typescript"
  /** The generated source code */
  code: string
  /** Function name to call as entrypoint */
  entry: string
  /** Input schema for validation */
  inputSchema: Record<string, SandboxSchemaField>
  /** Output schema for validation */
  outputSchema: Record<string, SandboxSchemaField>
  /** When this module was created */
  createdAt: string
  /** Success rate from test runs (0-1) */
  successRate: number
  /** How many times this module has been used */
  usageCount: number
}

/**
 * Result of executing code in the sandbox.
 */
export interface SandboxExecutionResult {
  success: boolean
  output: unknown
  error?: string
  durationMs: number
}

/**
 * Result of generating and testing code.
 */
export interface CodeGenerationResult {
  success: boolean
  module?: CodeModule
  issues?: BannedTokenIssue[]
  executionResult?: SandboxExecutionResult
  error?: string
}

/**
 * A test case for code validation.
 */
export interface SandboxTestCase {
  name: string
  input: Record<string, unknown>
  expected: unknown
}

/**
 * Test run result.
 */
export interface SandboxTestResult {
  passed: number
  total: number
  failures: Array<{ name: string; expected: unknown; actual: unknown; error?: string }>
  passRate: number
}

// ── Banned Token Checker ───────────────────────────────────────────

/**
 * Check code for banned tokens.
 * Returns array of issues found (empty = clean).
 */
export function checkBannedTokens(
  code: string,
  customTokens?: BannedToken[],
): BannedTokenIssue[] {
  const tokens = customTokens ?? DEFAULT_BANNED_TOKENS
  const issues: BannedTokenIssue[] = []
  const lines = code.split("\n")

  for (const token of tokens) {
    // Reset lastIndex for global regex
    token.pattern.lastIndex = 0

    // Check each line for the pattern
    for (let i = 0; i < lines.length; i++) {
      token.pattern.lastIndex = 0
      const match = token.pattern.exec(lines[i])
      if (match) {
        issues.push({
          token: token.name,
          severity: token.severity,
          reason: token.reason,
          line: i + 1,
        })
      }
    }
  }

  return issues
}

/**
 * Determine if banned token issues contain errors (not just warnings).
 */
export function hasBannedTokenErrors(issues: BannedTokenIssue[]): boolean {
  return issues.some(i => i.severity === "error")
}

// ── Sandbox Execution ──────────────────────────────────────────────

/** Default sandbox timeout in milliseconds */
const DEFAULT_SANDBOX_TIMEOUT = 500

/**
 * Create a safe sandbox context object with only whitelisted globals.
 * No fs, no process, no require, no network — only pure computation.
 */
export function createSandboxContext(): Record<string, unknown> {
  return {
    // Safe built-ins
    Array,
    Object,
    String,
    Number,
    Boolean,
    Math,
    JSON,
    Date,
    RegExp,
    Map,
    Set,
    WeakMap,
    WeakSet,
    Promise,
    Error,
    TypeError,
    RangeError,
    SyntaxError,
    ReferenceError,
    URIError,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    decodeURI,
    encodeURI,
    decodeURIComponent,
    encodeURIComponent,
    console: {
      log: (..._args: unknown[]) => { /* silently ignore — no I/O in sandbox */ },
      warn: (..._args: unknown[]) => { /* silently ignore */ },
      error: (..._args: unknown[]) => { /* silently ignore */ },
    },
    // Explicitly NOT included:
    // - require, import, module, exports
    // - process, global, globalThis
    // - Buffer, setTimeout, setInterval, setImmediate
    // - fetch, WebSocket, XMLHttpRequest
    // - fs, path, os, child_process, crypto
    // - Proxy, Reflect
    // - Atomics, SharedArrayBuffer
  }
}

/**
 * Execute code in a safe VM sandbox.
 *
 * The code must export a function via `function handler(input) { ... }` or
 * `const handler = (input) => { ... }`.
 * The function is called with the provided input and the result is returned.
 *
 * @param code Source code to execute (must define a `handler` function)
 * @param input Input data to pass to the handler function
 * @param timeout Maximum execution time in ms (default: 500)
 * @returns Execution result with output or error
 */
export function sandboxExecute(
  code: string,
  input: Record<string, unknown> = {},
  timeout: number = DEFAULT_SANDBOX_TIMEOUT,
): SandboxExecutionResult {
  const startTime = Date.now()

  try {
    // 1. Check banned tokens first
    const issues = checkBannedTokens(code)
    if (hasBannedTokenErrors(issues)) {
      const errorTokens = issues.filter(i => i.severity === "error")
      return {
        success: false,
        output: undefined,
        error: `Banned tokens detected: ${errorTokens.map(t => `${t.token} (line ${t.line})`).join(", ")}`,
        durationMs: Date.now() - startTime,
      }
    }

    // 2. Create sandbox context
    const context = createSandboxContext()
    vm.createContext(context)

    // 3. Wrap code to call handler and capture result
    const wrappedCode = `
      ${code}
      if (typeof handler !== 'function') {
        throw new Error('Code must define a function named "handler"'); // ponytail: inside VM sandbox string, not TS scope — typed errors inapplicable
      }
      handler(INPUT_PLACEHOLDER);
    `

    // 4. Inject input via safe serialization
    const safeInput = JSON.stringify(input)
    const finalCode = wrappedCode.replace('INPUT_PLACEHOLDER', safeInput)

    // 5. Compile and run in sandbox with timeout
    const script = new vm.Script(finalCode)
    const result = script.runInContext(context, { timeout })

    return {
      success: true,
      output: result,
      durationMs: Date.now() - startTime,
    }
  } catch (err) {
    return {
      success: false,
      output: undefined,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startTime,
    }
  }
}

// ── Test Runner ────────────────────────────────────────────────────

/**
 * Run a set of test cases against code in the sandbox.
 */
export function runSandboxTests(
  code: string,
  testCases: SandboxTestCase[],
  timeout?: number,
): SandboxTestResult {
  const failures: SandboxTestResult["failures"] = []

  for (const test of testCases) {
    const result = sandboxExecute(code, test.input, timeout)

    if (!result.success) {
      failures.push({
        name: test.name,
        expected: test.expected,
        actual: undefined,
        error: result.error,
      })
      continue
    }

    // Compare result with expected
    const actual = result.output
    const expected = test.expected

    // Deep equality check via JSON
    const isEqual = JSON.stringify(actual) === JSON.stringify(expected)

    if (!isEqual) {
      failures.push({
        name: test.name,
        expected,
        actual,
      })
    }
  }

  return {
    passed: testCases.length - failures.length,
    total: testCases.length,
    failures,
    passRate: testCases.length > 0
      ? (testCases.length - failures.length) / testCases.length
      : 0,
  }
}

// ── Code Module Registry ───────────────────────────────────────────

/**
 * Simple in-memory registry for generated code modules.
 * Modules can be found by keyword/name and reused across sessions.
 */
export class CodeModuleRegistry {
  private modules = new Map<string, CodeModule>()

  /**
   * Register a new code module.
   * Returns the module ID.
   */
  register(module: Omit<CodeModule, "id" | "createdAt" | "successRate" | "usageCount">): CodeModule {
    const id = `cm_${crypto.randomUUID().slice(0, 8)}`
    const newModule: CodeModule = {
      ...module,
      id,
      createdAt: new Date().toISOString(),
      successRate: 1.0,
      usageCount: 0,
    }
    this.modules.set(id, newModule)
    return newModule
  }

  /**
   * Get a module by ID.
   */
  getById(id: string): CodeModule | undefined {
    return this.modules.get(id)
  }

  /**
   * Find modules matching a query (searches name and code).
   */
  find(query: string): CodeModule[] {
    const lower = query.toLowerCase()
    const results: CodeModule[] = []
    for (const mod of this.modules.values()) {
      if (
        mod.name.toLowerCase().includes(lower) ||
        mod.code.toLowerCase().includes(lower)
      ) {
        results.push(mod)
      }
    }
    return results
  }

  /**
   * Get all registered modules.
   */
  getAll(): CodeModule[] {
    return Array.from(this.modules.values())
  }

  /**
   * Record a successful execution.
   */
  recordSuccess(id: string): void {
    const mod = this.modules.get(id)
    if (mod) {
      mod.usageCount++
      mod.successRate = (mod.successRate * (mod.usageCount - 1) + 1) / mod.usageCount
    }
  }

  /**
   * Record a failed execution.
   */
  recordFailure(id: string): void {
    const mod = this.modules.get(id)
    if (mod) {
      mod.usageCount++
      mod.successRate = (mod.successRate * (mod.usageCount - 1) + 0) / mod.usageCount
    }
  }

  /**
   * Remove a module by ID.
   */
  remove(id: string): boolean {
    return this.modules.delete(id)
  }

  /**
   * Get total number of modules.
   */
  get size(): number {
    return this.modules.size
  }
}

// ── CodeSandbox — Main Orchestrator ────────────────────────────────

/**
 * CodeSandbox orchestrator.
 * Coordinates code generation validation, sandbox execution, and module registration.
 */
export class CodeSandbox {
  private moduleRegistry: CodeModuleRegistry
  private customBannedTokens?: BannedToken[]

  constructor(registry?: CodeModuleRegistry) {
    this.moduleRegistry = registry ?? new CodeModuleRegistry()
  }

  /** Get the module registry */
  getRegistry(): CodeModuleRegistry {
    return this.moduleRegistry
  }

  /** Set custom banned tokens (overrides defaults) */
  setBannedTokens(tokens: BannedToken[]): void {
    this.customBannedTokens = tokens
  }

  /** Get active banned tokens */
  getBannedTokens(): BannedToken[] {
    return this.customBannedTokens ?? DEFAULT_BANNED_TOKENS
  }

  /**
   * Check code for banned tokens.
   */
  checkCode(code: string): BannedTokenIssue[] {
    return checkBannedTokens(code, this.getBannedTokens())
  }

  /**
   * Execute code in the sandbox.
   */
  execute(
    code: string,
    input: Record<string, unknown> = {},
    timeout?: number,
  ): SandboxExecutionResult {
    return sandboxExecute(code, input, timeout)
  }

  /**
   * Run tests against code in the sandbox.
   */
  runTests(
    code: string,
    testCases: SandboxTestCase[],
    timeout?: number,
  ): SandboxTestResult {
    return runSandboxTests(code, testCases, timeout)
  }

  /**
   * Full pipeline: validate → execute → test → register.
   * Returns the final result with optional module registration.
   */
  processCode(
    code: string,
    name: string,
    input: Record<string, unknown> = {},
    testCases?: SandboxTestCase[],
    language: "javascript" | "typescript" = "javascript",
  ): CodeGenerationResult {
    // 1. Banned token check
    const issues = this.checkCode(code)
    if (hasBannedTokenErrors(issues)) {
      return {
        success: false,
        issues,
        error: `Code contains banned tokens (${issues.filter(i => i.severity === "error").length} errors)`,
      }
    }

    // 2. Execute in sandbox
    const execResult = this.execute(code, input)
    if (!execResult.success) {
      return {
        success: false,
        issues,
        executionResult: execResult,
        error: `Sandbox execution failed: ${execResult.error}`,
      }
    }

    // 3. Run tests if provided
    if (testCases && testCases.length > 0) {
      const testResult = this.runTests(code, testCases)
      if (testResult.passRate < 1.0) {
        return {
          success: false,
          issues,
          executionResult: execResult,
          error: `Tests failed: ${testResult.passed}/${testResult.total} passed`,
        }
      }
    }

    // 4. Register as a code module
    const module = this.moduleRegistry.register({
      name,
      code,
      language,
      entry: "handler",
      inputSchema: inferSchema(input),
      outputSchema: inferSchema(
        (execResult.output as Record<string, unknown>) ?? {},
      ),
    })

    return {
      success: true,
      module,
      issues,
      executionResult: execResult,
    }
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Infer a simple schema from a data object.
 */
function inferSchema(data: Record<string, unknown>): Record<string, SandboxSchemaField> {
  const schema: Record<string, SandboxSchemaField> = {}
  for (const [key, value] of Object.entries(data)) {
    const type = Array.isArray(value) ? "array"
      : value === null ? "object"
      : typeof value as SandboxSchemaField["type"]
    schema[key] = { type, description: `Auto-inferred from sample data` }
  }
  return schema
}

// ── (types are exported inline with their definitions) ──
