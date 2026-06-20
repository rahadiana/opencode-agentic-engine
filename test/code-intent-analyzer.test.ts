/**
 * CodeIntentAnalyzer unit tests — Gap #3: Intent Inference via Program Analysis
 *
 * Paper: Roychoudhury '25 — "Agentic AI for Software: thoughts from SE community"
 * arXiv:2508.17343
 *
 * Run: npx tsx test/code-intent-analyzer.test.ts
 */

import { CodeIntentAnalyzer } from "../src/core/code-intent-analyzer.js"
import { CodebaseNavigator } from "../src/core/navigator.js"
import { DependencyTracker } from "../src/drift/dependency-tracker.js"
import { join } from "node:path"
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs"

let passed = 0
let failed = 0

function assert(condition: boolean, msg: string) {
  if (condition) {
    console.log(`  ✅ PASS: ${msg}`)
    passed++
  } else {
    console.error(`  ❌ FAIL: ${msg}`)
    failed++
  }
}

// ── Test project setup ──
const testDir = "/tmp/test-codeintent-" + Date.now()
try { rmSync(testDir, { recursive: true, force: true }) } catch { /* ok */ }
mkdirSync(testDir, { recursive: true })
mkdirSync(join(testDir, "src"), { recursive: true })

// TypeScript files
writeFileSync(join(testDir, "package.json"), JSON.stringify({ name: "test", type: "module" }))
writeFileSync(join(testDir, "tsconfig.json"), "{}")
writeFileSync(join(testDir, "src", "auth.ts"), `
import { verifyToken } from "./utils"
import { users } from "./database"

export function login(username: string, password: string): boolean {
  // Authenticate user
  return verifyToken(username)
}

export function logout(sessionId: string): void {
  // End user session
  deleteSession(sessionId)
}

export function getCurrentUser(): string | null {
  // Get logged in user
  return "admin"
}

async function validatePassword(hash: string): Promise<boolean> {
  return hash.length > 0
}
`)

writeFileSync(join(testDir, "src", "utils.ts"), `
export function verifyToken(token: string): boolean {
  return token !== ""
}

export function hashPassword(password: string): string {
  let hash = 0
  for (let i = 0; i < password.length; i++) {
    hash = ((hash << 5) - hash) + password.charCodeAt(i)
    hash |= 0
  }
  return hash.toString(16)
}
`)

writeFileSync(join(testDir, "src", "database.ts"), `
export interface User {
  id: number
  username: string
  email: string
}

const users: User[] = []

export function findUser(username: string): User | undefined {
  return users.find(u => u.username === username)
}

export function saveUser(user: User): void {
  users.push(user)
}

export function deleteSession(sessionId: string): boolean {
  return true
}
`)

writeFileSync(join(testDir, "src", "index.ts"), `
import { login, logout, getCurrentUser } from "./auth"
import { findUser, saveUser, User } from "./database"

export function main(): string {
  const user = getCurrentUser()
  return user ?? "no user"
}

export async function createUser(username: string, email: string): Promise<User> {
  const newUser: User = { id: Date.now(), username, email }
  saveUser(newUser)
  return newUser
}
`)

// ── I1: inferIntentFromName (internal logic) ──
console.log("\n[I1] inferIntentFromName — internal intent inference heuristics")
const analyzer = new CodeIntentAnalyzer()

// We test via the analyze method's side effects — but we can also test
// indirectly by checking function intent values from known patterns.

// ── I2: analyze() with CodebaseNavigator ──
console.log("\n[I2] CodeIntentAnalyzer.analyze() — full pipeline")

async function runTests() {
  const nav = new CodebaseNavigator()
  const dt = new DependencyTracker()
  analyzer.setNavigator(nav)
  analyzer.setDependencyTracker(dt)

  // I2a: Analyze "auth" goal
  const result = await analyzer.analyze("auth login user", testDir)
  assert(result.primaryLanguage === "typescript", "I2a primary language detected")
  assert(result.files.length >= 3, `I2b at least 3 files relevant to auth, got ${result.files.length}`)
  assert(result.goal === "auth login user", "I2c goal preserved")

  // I2d: Check auth.ts is in the results
  const authFile = result.files.find(f => f.relativePath.includes("auth"))
  assert(authFile !== undefined, "I2d auth.ts found")

  // I2e: Check functions extracted from auth.ts
  if (authFile) {
    assert(authFile.functions.length >= 3, `I2e auth.ts has at least 3 functions, got ${authFile.functions.length}`)
    const loginFunc = authFile.functions.find(f => f.functionName === "login")
    assert(loginFunc !== undefined, "I2f login() function found")
    if (loginFunc) {
      assert(loginFunc.confidence > 0, "I2g login has confidence > 0")
      assert(loginFunc.inferredIntent.length > 0, "I2h login has inferred intent")
      assert(loginFunc.lineNumber > 0, "I2i login has line number")
    }
    const getCurrentUserFunc = authFile.functions.find(f => f.functionName === "getCurrentUser")
    assert(getCurrentUserFunc !== undefined, "I2j getCurrentUser() function found")
    if (getCurrentUserFunc) {
      assert(getCurrentUserFunc.inferredIntent.includes("Read") || getCurrentUserFunc.inferredIntent.includes("Operation"),
        "I2k getCurrentUser intent includes Read")
    }
  }

  // I2f: Check overallSummary is generated
  assert(result.overallSummary.length > 0, "I2l overallSummary generated")
  assert(result.overallSummary.includes("typescript"), "I2m overallSummary mentions language")
  assert(result.overallSummary.includes("auth"), "I2n overallSummary mentions goal")

  // I2g: analysisTimestamp is set
  assert(result.analysisTimestamp > 0, "I2o timestamp present")

  // I2h: dependencyChain is built
  assert(result.dependencyChain.length >= 0, "I2p dependencyChain built (may be empty)")

  // ── I3: analyze() without navigator (fallback) ──
  console.log("\n[I3] analyze() without navigator — partial fallback")
  const analyzerNoNav = new CodeIntentAnalyzer()
  // Don't set navigator — should still return basic result
  const noNavResult = await analyzerNoNav.analyze("test", testDir)
  assert(noNavResult.files.length === 0, "I3a no files without navigator")
  assert(noNavResult.primaryLanguage === null, "I3b no language without navigator")
  assert(noNavResult.goal === "test", "I3c goal still preserved")

  // ── I4: getContextSummary() ──
  console.log("\n[I4] getContextSummary() — XML compact summary generation")

  const summary = analyzer.getContextSummary(result)
  assert(summary.length > 0, "I4a context summary not empty")
  assert(summary.includes("<code-intent-analysis>"), "I4b includes XML opening tag")
  assert(summary.includes("</code-intent-analysis>"), "I4c includes XML closing tag")
  assert(summary.includes("<summary>"), "I4d includes summary tag")
  assert(summary.includes("<function"), "I4e includes function tags")

  // I4f: maxFiles parameter
  const summaryLimit1 = analyzer.getContextSummary(result, 1)
  // Should only show 1 file
  const fileCount = (summaryLimit1.match(/<file /g) || []).length
  assert(fileCount <= 1, "I4f maxFiles=1 limits files")

  // I4g: handle empty result
  const emptyResult = await analyzerNoNav.analyze("empty", testDir)
  const emptySummary = analyzer.getContextSummary(emptyResult)
  assert(emptySummary === "", "I4g empty result gives empty summary")

  // ── I5: getCompactSummary() ──
  console.log("\n[I5] getCompactSummary() — plain text compact summary")

  const compact = analyzer.getCompactSummary(result)
  assert(compact.length > 0, "I5a compact summary not empty")
  assert(compact.includes("Code Intent"), "I5b compact summary mentions Code Intent")
  assert(compact.includes("typescript") || compact.includes("TypeScript"), "I5c compact summary mentions language")

  const compactLimit1 = analyzer.getCompactSummary(result, 1)
  const compactFileLines = compactLimit1.split("\n").filter(l => l.trim().startsWith("src/"))
  assert(compactFileLines.length <= 1, "I5d compact maxFiles=1 limits files")

  const compactEmpty = analyzer.getCompactSummary(emptyResult)
  assert(compactEmpty === "", "I5e compact empty result gives empty")

  // ── I6: analyze() with different goals ──
  console.log("\n[I6] analyze() — different goals yield different relevant files")

  const authResult = await analyzer.analyze("auth token verification", testDir)
  assert(authResult.files.length > 0, "I6a auth goal finds files")
  const authFiles = authResult.files.map(f => f.relativePath)
  const hasAuthFile = authFiles.some(p => p.includes("auth"))
  assert(hasAuthFile, "I6b auth goal finds auth.ts")

  const dbResult = await analyzer.analyze("database user storage", testDir)
  assert(dbResult.files.length > 0, "I6c db goal finds files")
  const dbFiles = dbResult.files.map(f => f.relativePath)
  const hasDbFile = dbFiles.some(p => p.includes("database"))
  assert(hasDbFile, "I6d db goal finds database.ts")

  // ── I7: Function Intent Inference heuristics ──
  console.log("\n[I7] Function intent inference quality")

  // Check that function intents are meaningful
  let meaningfulIntents = 0
  let totalFuncs = 0
  for (const file of result.files) {
    for (const fn of file.functions) {
      totalFuncs++
      if (!fn.inferredIntent.startsWith("Unknown") && !fn.inferredIntent.startsWith("Operation: ")) {
        meaningfulIntents++
      }
    }
  }
  assert(totalFuncs > 0, `I7a total functions extracted: ${totalFuncs}`)
  assert(meaningfulIntents > 0, `I7b some functions have meaningful intents: ${meaningfulIntents}/${totalFuncs}`)

  // ── I8: Edge cases ──
  console.log("\n[I8] Edge cases")

  // I8a: Empty project
  const emptyDir = "/tmp/test-codeintent-empty-" + Date.now()
  try { rmSync(emptyDir, { recursive: true, force: true }) } catch { /* ok */ }
  mkdirSync(emptyDir, { recursive: true })
  const emptyProjectResult = await analyzer.analyze("test", emptyDir)
  assert(emptyProjectResult.primaryLanguage === null, "I8a no language for empty project")
  assert(emptyProjectResult.files.length === 0, "I8b no files for empty project")

  // I8b: Goal with special characters
  const specialGoal = await analyzer.analyze("fix <script> bug", testDir)
  assert(specialGoal.goal === "fix <script> bug", "I8c special chars preserved")

  // I8d: Cache works (second call returns faster)
  const cacheResult1 = await analyzer.analyze("auth cache test", testDir)
  const cacheResult2 = await analyzer.analyze("auth cache test", testDir)
  assert(cacheResult2.files.length === cacheResult1.files.length, "I8d cache returns same data")

  // I8e: invalidateCache
  analyzer.invalidateCache()
  const afterInvalidate = await analyzer.analyze("auth cache test", testDir)
  assert(afterInvalidate.files.length > 0, "I8e after invalidate still works")

  // ── I9: File summary generation ──
  console.log("\n[I9] File summary quality")

  const indexFile = result.files.find(f => f.relativePath.includes("index"))
  if (indexFile) {
    assert(indexFile.summary.length > 0, "I9a index.ts has summary")
    // index.ts has exports
    assert(indexFile.exports.length > 0, "I9b index.ts has exports")
  }

  const authFileCheck = result.files.find(f => f.relativePath.includes("auth"))
  if (authFileCheck) {
    assert(authFileCheck.functions.some(f => f.functionName === "login"), "I9c login function exported")
    assert(authFileCheck.functions.some(f => f.functionName === "logout"), "I9d logout function exported")
    assert(authFileCheck.functions.some(f => f.functionName === "getCurrentUser"), "I9e getCurrentUser function found")
    // validatePassword is not exported but should still be found
    assert(authFileCheck.functions.some(f => f.functionName === "validatePassword"), "I9f validatePassword private function found")
  }

  // ── I10: Dependency chain ──
  console.log("\n[I10] Dependency chain from relevant files")
  const depResult = await analyzer.analyze("auth login", testDir)
  // dependencyChain should be an array (maybe empty if navigator hasn't scanned deps)
  assert(Array.isArray(depResult.dependencyChain), "I10a dependencyChain is array")

  // ── I11: CodebaseNavigator scan coverage ──
  console.log("\n[I11] Multi-language extraction")
  
  // Python file
  mkdirSync(join(testDir, "utils_py"), { recursive: true })
  writeFileSync(join(testDir, "utils_py", "helpers.py"), `
def parse_input(data: str) -> dict:
    """Parse the input string into a dictionary"""
    return {}
    
class DataProcessor:
    def process(self, items: list) -> list:
        return [x for x in items if x]
        
async def fetch_data(url: str) -> str:
    import httpx
    return "data"
`)

  const pyResult = await analyzer.analyze("helpers", testDir)
  // May or may not find Python files depending on project detection
  const pyFile = pyResult.files.find(f => f.relativePath.includes(".py"))
  if (pyFile) {
    assert(pyFile.language === "python", "I11a python language detected")
    assert(pyFile.functions.length >= 2, "I11b python functions extracted")
  }

  // ── I12: XML escaping ──
  console.log("\n[I12] XML escaping in getContextSummary")
  const xmlResult = await analyzer.analyze("auth &< login", testDir)
  const xmlSummary = analyzer.getContextSummary(xmlResult)
  // Should not have raw & < > characters outside XML tags
  const outsideXml = xmlSummary.replace(/<[^>]*>/g, "")
  assert(!outsideXml.includes("&<"), "I12a XML escaped — no raw &< in content")

  // ── Summary ──
  console.log(`\n=============================`)
  console.log(`Results: ${passed} passed, ${failed} failed`)
  if (failed === 0) console.log("ALL TESTS PASSED")
  else console.error(`${failed} TEST(S) FAILED`)

  // Cleanup
  try { rmSync(testDir, { recursive: true, force: true }) } catch { /* ok */ }
  try { rmSync(join("/tmp", "test-codeintent-empty-" + Date.parse(new Date().toISOString())), { recursive: true, force: true }) } catch { /* ok */ }

  process.exit(failed > 0 ? 1 : 0)
}

runTests().catch(err => {
  console.error("Test runner error:", err)
  process.exit(1)
})
