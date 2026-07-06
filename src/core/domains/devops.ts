import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import type { DomainPack, VerifierStrategy, ErrorMatcher } from "../domain-registry.js"
import { createGenericContract } from "../formal-model.js"

// ─── Keywords ──────────────────────────────────────────────────────────

const devopsKeywords = [
  "docker", "kubernetes", "k8s", "helm", "terraform", "ansible",
  "ci/cd", "jenkins", "github actions", "gitlab ci", "deploy",
  "infrastructure", "iac", "cloud", "aws", "gcp", "azure",
  "nginx", "reverse proxy", "load balancer", "scaling",
  "monitoring", "grafana", "prometheus", "datadog", "new relic",
  "logging", "elk", "elasticsearch", "logstash", "kibana",
  "pipeline", "build", "release", "rollback", "canary",
  "blue-green", "container", "orchestration", "microservice",
  "service mesh", "istio", "envoy", "configmap", "secret",
  "devops", "infra", "ops", "sysadmin", "linux", "shell",
  "bash", "script", "automation", "provisioning",
]

// ─── Detection ─────────────────────────────────────────────────────────

const devopsDetect = (input: string): number => {
  const lower = input.toLowerCase()
  let score = 0
  for (const kw of devopsKeywords) {
    if (lower.includes(kw)) score += 0.05
  }
  // Check for devops config files
  const devopsFiles = ["Dockerfile", "docker-compose.yml", "docker-compose.yaml",
    ".github/workflows", ".gitlab-ci.yml", "Jenkinsfile",
    "terraform.tf", "main.tf", "playbook.yml", "values.yaml",
    "Chart.yaml", "k8s", "kubernetes",
  ]
  for (const f of devopsFiles) {
    try { if (existsSync(f)) score += 0.25 } catch { console.warn("catch: skip") }
  }
  return Math.min(score, 1.0)
}

// ─── Verifiers ─────────────────────────────────────────────────────────

const devopsVerifiers: VerifierStrategy[] = [
  {
    name: "dockerfile-lint",
    async verify(context) {
      const issues: string[] = []

      for (const file of context.filesModified) {
        if (!file.endsWith("Dockerfile") && !file.endsWith(".dockerfile")) continue
        try {
          const absPath = resolve(context.projectDir, file)
          const content = readFileSync(absPath, "utf-8")

          // Check common Dockerfile issues
          if (!content.includes("FROM ")) issues.push(`${file}: Missing FROM instruction`)
          if (content.includes(":latest")) issues.push(`${file}: Avoid 'latest' tag — use specific version`)
          if (!content.includes("WORKDIR") && !content.includes("COPY")) {
            // Small project, ok
          }
          if ((content.match(/RUN /g) || []).length > 10) issues.push(`${file}: Too many RUN layers — consider chaining with &&`)
          if (content.includes("apt-get upgrade") && !content.includes("--no-install-recommends")) {
            issues.push(`${file}: Add --no-install-recommends to apt-get`)
          }
        } catch { console.warn("catch: skip") }
      }

      // Try hadolint if available
      try {
        execFileSync("which", ["hadolint"], { stdio: "pipe" })
        const dockerFiles = context.filesModified.filter(f => f.endsWith("Dockerfile") || f.endsWith(".dockerfile"))
        for (const df of dockerFiles) {
          try {
            const output = execFileSync("hadolint", [resolve(context.projectDir, df)], {
              timeout: 15000, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"],
            })
            if (output.trim()) issues.push(`hadolint(${df}): ${output.slice(0, 300)}`)
          } catch (e: unknown) {
            const err = e as { stdout?: string; stderr?: string }
            const out = err.stdout || err.stderr || ""
            if (out.trim()) issues.push(`hadolint(${df}): ${out.slice(0, 300)}`)
          }
        }
      } catch { console.warn("catch: hadolint not available") }

      if (issues.length > 0) {
        return { passed: false, output: `Dockerfile issues:\n${issues.join("\n")}` }
      }
      return { passed: true, output: "Dockerfile checks passed" }
    },
  },
  {
    name: "yaml-validate",
    async verify(context) {
      const issues: string[] = []
      for (const file of context.filesModified) {
        if (!file.endsWith(".yml") && !file.endsWith(".yaml")) continue
        try {
          const absPath = resolve(context.projectDir, file)
          const content = readFileSync(absPath, "utf-8")
          if (!content.trim()) {
            issues.push(`${file}: Empty YAML file`)
            continue
          }
          try {
            JSON.parse(content)
            issues.push(`${file}: Looks like JSON, not YAML — use .json extension`)
          } catch { console.warn("catch: not JSON, good") }
          if (content.includes("\t") && (content.includes(":\n") || content.includes("-\n"))) {
            const lines = content.split("\n")
            for (let i = 0; i < lines.length; i++) {
              if (lines[i].startsWith("\t")) {
                issues.push(`${file}: Line ${i + 1} uses tab indentation — YAML requires spaces`)
                break
              }
            }
          }
        } catch { console.warn("catch: skip unreadable") }
      }
      if (issues.length > 0) {
        return { passed: false, output: `YAML issues:\n${issues.join("\n")}` }
      }
      return { passed: true, output: "YAML validation passed" }
    },
  },
]

// ─── Error Matchers ────────────────────────────────────────────────────

const devopsErrorMatchers: ErrorMatcher[] = [
  {
    name: "docker",
    match(msg) {
      const lower = msg.toLowerCase()
      if (lower.includes("docker") || lower.includes("container")) {
        if (lower.includes("not found") || lower.includes("failed") || lower.includes("error")) {
          return {
            matched: true, category: "docker",
            summary: "Docker/container error",
            likelyRootCause: "Missing container, image build failure, or network issue",
            suggestedFix: "Check Docker daemon, verify image exists, rebuild with --no-cache",
            severity: "high",
          }
        }
      }
      return null
    },
  },
  {
    name: "kubernetes",
    match(msg) {
      const lower = msg.toLowerCase()
      if (lower.includes("kubectl") || lower.includes("kubernetes") || lower.includes("pod") || lower.includes("deployment")) {
        if (lower.includes("error") || lower.includes("crash") || lower.includes("back-off") || lower.includes("imagepull")) {
          return {
            matched: true, category: "kubernetes",
            summary: "Kubernetes cluster error",
            likelyRootCause: "Pod crash, image pull failure, or resource constraints",
            suggestedFix: "Check pod logs via 'kubectl logs', verify image tag, check resource limits",
            severity: "high",
          }
        }
      }
      return null
    },
  },
  {
    name: "ci",
    match(msg) {
      const lower = msg.toLowerCase()
      if (lower.includes("ci") || lower.includes("pipeline") || lower.includes("build") || lower.includes("workflow")) {
        if (lower.includes("failed") || lower.includes("broken") || lower.includes("error")) {
          return {
            matched: true, category: "ci",
            summary: "CI/CD pipeline failure",
            likelyRootCause: "Build step failed, test failure, or configuration error",
            suggestedFix: "Check pipeline logs, verify configuration syntax, re-run with verbose output",
            severity: "high",
          }
        }
      }
      return null
    },
  },
]

// ─── Formal Contract ───────────────────────────────────────────────────

const devopsContract = createGenericContract()
devopsContract.postConditions = [
  {
    expr: "dockerfile_builds_successfully",
    severity: "error" as const,
    description: "All Dockerfiles must be syntactically valid",
  },
  {
    expr: "yaml_indentation_correct",
    severity: "warning" as const,
    description: "YAML files must use consistent indentation",
  },
]

export const devopsDomain: DomainPack = {
  name: "devops",
  description: "DevOps & infrastructure domain — Docker, K8s, CI/CD, Terraform, cloud provisioning",
  detect: devopsDetect,
  verifiers: devopsVerifiers,
  errorMatchers: devopsErrorMatchers,
  roles: [],
  skills: [],
  tools: ["read", "edit", "write", "bash", "glob", "grep", "agentic_nav", "agentic_verify", "agentic_score", "agentic_delegate", "agentic_pipeline", "agentic_skill", "agentic_plan", "agentic_execute", "agentic_episodes"],
  fileExtensions: [".yml", ".yaml", ".tf", ".hcl", "Dockerfile", ".dockerfile", ".tpl", ".helm"],
  formalContract: devopsContract,
}
