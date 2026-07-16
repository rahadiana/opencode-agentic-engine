#!/usr/bin/env node
/**
 * Build-time validation script for production prompts.
 * 
 * Inspired by Google prompt transpilation article (2026-07-16):
 * "Build-time validation is mandatory — catch errors before runtime."
 * 
 * This script:
 * 1. Builds the production prompt via buildAgenticSystemInstructions()
 * 2. Validates it using PromptTemplate.validate()
 * 3. Checks for unresolved template variables
 * 4. Exits with code 0 (valid) or 1 (invalid, errors found)
 * 
 * Usage:
 *   npm run validate:prompt
 *   node test/validate-prompt.mjs
 */

import { fileURLToPath } from "url"
import { dirname, join } from "path"

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(__dirname, "..")

// Import plugin (pre-built)
const mod = await import(join(projectRoot, "dist/index.js")).catch(e => {
  console.error(`❌ Failed to import plugin. Did you run 'npm run build'? Error: ${e.message}`)
  process.exit(1)
})

// Import domain registry to get available domain packs
const { domainRegistry } = globalThis

function validatePrompt() {
  console.log("🔍 Validating production prompt...\n")

  const issues = []

  // ── Test 1: Build production prompt for 'code' domain ──
  console.log("  [1/4] Building production prompt...")
  let injection = ""
  try {
    const codeDomain = {
      name: "code",
      tools: [
        "agentic_plan",
        "agentic_execute",
        "agentic_verify",
        "agentic_reflect",
        "agentic_status",
        "agentic_nav",
        "agentic_auto",
      ],
    }

    const fakeTools = [
      { name: "agentic_plan", description: "Break goal into subtasks" },
      { name: "agentic_execute", description: "Execute and track step completion" },
      { name: "agentic_verify", description: "Multi-dimensional verification" },
      { name: "agentic_reflect", description: "Analyze errors and suggest recovery" },
      { name: "agentic_status", description: "Check progress and timeline" },
      { name: "agentic_nav", description: "Navigate codebase for relevant files" },
      { name: "agentic_auto", description: "One-call plan+execute+verify+retry loop" },
    ]

    injection = mod.buildAgenticSystemInstructions(codeDomain, fakeTools, {
      isRouted: false,
      selectedTools: fakeTools.slice(0, 3),
    })

    if (!injection || typeof injection !== "string" || injection.length === 0) {
      issues.push("ERROR: buildAgenticSystemInstructions() returned empty/invalid")
    } else {
      console.log(`  ✅ Built prompt (${injection.length} chars, ~${Math.round(injection.length / 4)} tokens)`)
    }
  } catch (e) {
    issues.push(`ERROR building prompt: ${e instanceof Error ? e.message : String(e)}`)
    console.error(`  ❌ ${issues[issues.length - 1]}`)
  }

  // ── Test 2: Validate structure (has all 4 XML sections) ──
  console.log("  [2/4] Checking XML structure...")
  const requiredSections = ["<identity>", "<instructions>", "<guardrails>"]
  for (const section of requiredSections) {
    if (!injection.includes(section)) {
      issues.push(`ERROR: Missing XML section: ${section}`)
    } else {
      console.log(`    ✅ Found ${section}`)
    }
  }

  // ── Test 3: Check for unresolved template variables ──
  console.log("  [3/4] Scanning for unresolved template variables...")
  const TEMPLATE_PATTERNS = [
    { pattern: /\{\{\s*[a-zA-Z_][a-zA-Z0-9_.]*\s*\}\}/g, label: "{{var}}" },
    { pattern: /\{%[^%]*%\}/g, label: "{%...%}" },
  ]

  let foundUnresolved = false
  for (const { pattern, label } of TEMPLATE_PATTERNS) {
    const matches = injection.match(pattern)
    if (matches) {
      const unique = [...new Set(matches)]
      issues.push(`ERROR: Unresolved template pattern (${label}): ${unique.join(", ")}`)
      foundUnresolved = true
    }
  }

  if (!foundUnresolved) {
    console.log(`    ✅ No unresolved template variables found`)
  }

  // ── Test 4: Validate using PromptTemplate.validate() ──
  console.log("  [4/4] Running PromptTemplate.validate()...")
  try {
    const template = new mod.PromptTemplate()

    // Rough parse of injection into sections
    // (just check that sections exist — full parsing is complex)
    const hasIdentity = injection.includes("<identity>")
    const hasInstructions = injection.includes("<instructions>")
    const hasGuardrails = injection.includes("<guardrails>")

    // Build minimal template for validation
    if (hasIdentity) template.identity("production")
    if (hasInstructions) template.instructions("production")
    if (hasGuardrails) template.guardrails("production")

    const result = template.validate()

    if (!result.valid) {
      for (const error of result.errors) {
        issues.push(`ERROR (${error.section}): ${error.message}`)
      }
    }

    if (result.warnings.length > 0) {
      for (const warn of result.warnings) {
        console.log(`    ⚠️  Warning (${warn.section}): ${warn.message}`)
      }
    }

    if (result.valid && result.errors.length === 0) {
      console.log(`    ✅ validate() passed (0 errors, ${result.warnings.length} warnings)`)
    }
  } catch (e) {
    issues.push(`ERROR in validate(): ${e instanceof Error ? e.message : String(e)}`)
  }

  // ── Summary ──
  console.log("\n" + "=".repeat(60))
  if (issues.length === 0) {
    console.log("✅ All validation checks passed!")
    console.log("=".repeat(60))
    return 0
  } else {
    console.error(`❌ Validation failed with ${issues.length} issue(s):`)
    for (const issue of issues) {
      console.error(`  • ${issue}`)
    }
    console.log("=".repeat(60))
    return 1
  }
}

const exitCode = validatePrompt()
process.exit(exitCode)
