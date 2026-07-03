// test/_common.mjs — Shared helpers, imports, and project setup for all test modules
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, chmodSync, mkdtempSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { state, runStart } from "./_state.mjs"
import { sdkMockClient } from "./mock-sdk-client.mjs"

export { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, chmodSync, mkdtempSync }
export { join } from "path"
export { tmpdir } from "os"
export { sdkMockClient }
export { state, runStart }

export const pluginDist = new URL("../dist/index.js", import.meta.url).pathname

// ── Color constants ──
export const G = "\x1b[32m"
export const R = "\x1b[31m"
export const Y = "\x1b[33m"
export const B = "\x1b[34m"
export const D = "\x1b[2m"
export const RST = "\x1b[0m"

// ── Helpers ──

export function freshSid() {
  return `test-session-${++state.sid}`
}

export function assert(condition, msg) {
  if (condition) {
    console.log(`  ${G}PASS${RST}: ${msg}`)
    state.passed++
  } else {
    console.error(`  ${R}FAIL${RST}: ${msg}`)
    state.failed++
    state.failedTests.push({ section: state.currentSection, msg })
  }
}

export function section(name) {
  if (state.sectionStart > 0) {
    const ms = Date.now() - state.sectionStart
    console.log(`  ${D}(${ms}ms)${RST}`)
  }
  state.currentSection = name
  state.sectionStart = Date.now()
}

export function mockCtx(sessionID) {
  return {
    sessionID,
    messageID: "msg-1",
    agent: "test",
    directory: "/tmp/test-project",
    worktree: "/tmp/test-project",
    abort: new AbortController().signal,
    metadata: () => {},
    ask: async () => {},
  }
}

// ── Project setup ──
export const projectDir = "/tmp/test-project"
try { rmSync(projectDir, { recursive: true, force: true }) } catch { /* volume mount inside */ }
mkdirSync(projectDir, { recursive: true })
mkdirSync(join(projectDir, "src"), { recursive: true })
mkdirSync(join(projectDir, "tests"), { recursive: true })
writeFileSync(join(projectDir, "tsconfig.json"), "{}")
writeFileSync(join(projectDir, "package.json"), JSON.stringify({ name: "test", type: "module" }))
writeFileSync(join(projectDir, "src/index.ts"), 'import { validate } from "./utils"\nexport function main() { return validate() }\n')
writeFileSync(join(projectDir, "src/utils.ts"), 'export function validate(): boolean { return true }\n')
writeFileSync(join(projectDir, "tests/index.test.ts"), 'import { main } from "../src/index"\n')
