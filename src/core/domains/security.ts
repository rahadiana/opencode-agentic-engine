import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import type { DomainPack, VerifierStrategy, ErrorMatcher } from "../domain-registry.js"
import { createGenericContract } from "../formal-model.js"

// ─── Keywords ──────────────────────────────────────────────────────────

const securityKeywords = [
  "security", "vulnerability", "cve", "sast", "dast", "owasp",
  "penetration", "pentest", "auth", "oauth", "jwt", "csrf",
  "xss", "sqli", "injection", "authentikasi", "otorisasi",
  "encrypt", "decrypt", "hash", "bcrypt", "argon2", "ssl",
  "tls", "certificate", "firewall", "waf", "ids", "ips",
  "cors", "helmet", "sanitize", "escape", "privacy", "gdpr",
  "csp", "rbac", "acl", "secret", "token", "api.key",
  "keamanan", "secure", "threat", "malware", "ransomware",
  "audit", "compliance", "soc2", "iso27001", "pci",
]

// ─── Detection ─────────────────────────────────────────────────────────

const securityDetect = (input: string): number => {
  const lower = input.toLowerCase()
  let score = 0
  for (const kw of securityKeywords) {
    if (lower.includes(kw)) score += 0.06
  }
  const projectDir = process.cwd()
  const securityFiles = [".sast.config", "security.txt", "csp.json", "owasp.json"]
  for (const f of securityFiles) {
    try {
      const fullPath = resolve(projectDir, f)
      if (existsSync(fullPath)) score += 0.3
    } catch { console.warn("catch: skip") }
  }
  try {
    const pkgPath = resolve(projectDir, "package.json")
    if (!existsSync(pkgPath)) return Math.min(score, 1.0)
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"))
    const secDeps = ["helmet", "cors", "bcrypt", "jsonwebtoken", "csurf", "express-rate-limit", "sanitize-html", "dompurify"]
    const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }
    for (const dep of Object.keys(allDeps)) {
      if (secDeps.includes(dep)) score += 0.15
    }
  } catch { console.warn("catch: no package.json or parse error") }
  return Math.min(score, 1.0)
}

// ─── Verifiers ─────────────────────────────────────────────────────────

const securityVerifiers: VerifierStrategy[] = [
  {
    name: "secret-scan",
    async verify(context) {
      const issues: string[] = []
      for (const file of context.filesModified) {
        try {
          const absPath = resolve(context.projectDir, file)
          if (!existsSync(absPath)) continue
          const content = readFileSync(absPath, "utf-8")

          // Check for hardcoded secrets patterns
          const secretPatterns = [
            { pattern: /(?:api[_-]?key|apikey|secret|password|passwd|pwd|token|auth)[\s]*[:=][\s]*['"][A-Za-z0-9_\-/=+]{16,}['"]/i, name: "Hardcoded API key/secret" },
            { pattern: /-----BEGIN (RSA |EC |DSA )?PRIVATE KEY-----/, name: "Private key embedded in code" },
            { pattern: /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,}/, name: "GitHub token" },
            { pattern: /sk-[A-Za-z0-9]{32,}/, name: "OpenAI API key" },
            { pattern: /AKIA[0-9A-Z]{16}/, name: "AWS access key" },
          ]

          const isExampleOrTest = /example|test|mock|dummy|placeholder|your-/i.test(content.slice(0, 200))
          for (const { pattern, name } of secretPatterns) {
            if (pattern.test(content) && !isExampleOrTest) {
              issues.push(`${file}: ${name}`)
            }
          }
        } catch { console.warn("catch: skip unreadable") }
      }

      // Also run trivy/grype if available
      try {
        execFileSync("which", ["trivy"], { stdio: "pipe" })
        const output = execFileSync("trivy", ["fs", "--quiet", "--severity", "HIGH,CRITICAL", context.projectDir], {
          timeout: 60000, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"],
        })
        if (output.length > 0) issues.push(`Trivy: ${output.slice(0, 500)}`)
      } catch { console.warn("catch: trivy not available") }

      if (issues.length > 0) {
        return { passed: false, output: `Security issues found:\n${issues.join("\n")}` }
      }
      return { passed: true, output: "No secrets or vulnerabilities detected" }
    },
  },
]

// ─── Error Matchers ────────────────────────────────────────────────────

const securityErrorMatchers: ErrorMatcher[] = [
  {
    name: "auth",
    match(msg) {
      const lower = msg.toLowerCase()
      if (lower.includes("unauthorized") || lower.includes("forbidden") || lower.includes("401") || lower.includes("403")) {
        return {
          matched: true, category: "auth",
          summary: "Authentication or authorization error",
          likelyRootCause: "Missing or invalid credentials, insufficient permissions",
          suggestedFix: "Verify authentication tokens, API keys, and role-based access controls",
          severity: "critical",
        }
      }
      return null
    },
  },
  {
    name: "csp",
    match(msg) {
      if (msg.includes("Content-Security-Policy") || msg.includes("CSP") || msg.includes("blocked by policy")) {
        return {
          matched: true, category: "csp",
          summary: "Content Security Policy violation",
          likelyRootCause: "Inline script/style blocked or disallowed resource load",
          suggestedFix: "Update CSP headers or move inline code to external files",
          severity: "high",
        }
      }
      return null
    },
  },
]

export const securityDomain: DomainPack = {
  name: "security",
  description: "Security engineering domain — vulnerability scanning, secret detection, auth, CSP, and compliance",
  detect: securityDetect,
  verifiers: securityVerifiers,
  errorMatchers: securityErrorMatchers,
  roles: [],
  skills: [],
  tools: ["read", "edit", "write", "bash", "glob", "grep", "agentic_nav", "agentic_verify", "agentic_score", "agentic_delegate", "agentic_skill", "agentic_plan", "agentic_execute", "agentic_episodes"],
  fileExtensions: [".csp.json", ".sast.config", ".security.txt", ".hcl", ".tf"],
  formalContract: createGenericContract(),
}
