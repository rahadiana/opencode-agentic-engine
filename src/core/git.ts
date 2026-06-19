import { execFileSync } from "node:child_process"

export interface CommitInfo {
  hash: string
  message: string
  files: string[]
  timestamp: string
}

export interface PRDescription {
  title: string
  summary: string
  changes: string[]
  testPlan: string
  breakingChanges: boolean
  notes?: string
}

export interface PRCreationResult {
  url: string
  number: number
  title: string
  branch: string
}

export class GitIntegration {
  private cwd: string

  constructor(cwd: string) {
    this.cwd = cwd
  }

  isAvailable(): boolean {
    try {
      execFileSync("git", ["rev-parse", "--git-dir"], { cwd: this.cwd, stdio: "ignore" })
      return true
    } catch {
      return false
    }
  }

  stage(files: string[]): boolean {
    if (!this.isAvailable()) return false
    try {
      execFileSync("git", ["add", ...files], { cwd: this.cwd, stdio: "ignore" })
      return true
    } catch {
      return false
    }
  }

  commit(message: string, files: string[]): CommitInfo | null {
    if (!this.isAvailable()) return null
    try {
      if (files.length > 0) {
        execFileSync("git", ["add", ...files], { cwd: this.cwd, stdio: "ignore" })
      }
      execFileSync("git", ["commit", "-m", message], { cwd: this.cwd, stdio: "ignore" })
      const hash = execFileSync("git", ["rev-parse", "HEAD"], { cwd: this.cwd, encoding: "utf-8" }).trim()
      const timestamp = execFileSync("git", ["log", "-1", "--format=%aI"], { cwd: this.cwd, encoding: "utf-8" }).trim()
      return { hash, message, files, timestamp }
    } catch {
      return null
    }
  }

  getHistory(count = 10): CommitInfo[] {
    if (!this.isAvailable()) return []
    try {
      const output = execFileSync(
        "git",
        ["log", `-${count}`, "--format=%H|||%s|||%aI", "--name-only"],
        { cwd: this.cwd, encoding: "utf-8" }
      )
      const commits: CommitInfo[] = []
      let current: CommitInfo | null = null

      for (const line of output.split("\n")) {
        if (line.includes("|||")) {
          if (current) commits.push(current)
          const [hash, message, timestamp] = line.split("|||")
          current = { hash, message, timestamp, files: [] }
        } else if (line && current) {
          current.files.push(line.trim())
        }
      }
      if (current) commits.push(current)
      return commits
    } catch {
      return []
    }
  }

  getCurrentBranch(): string {
    try {
      return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
        cwd: this.cwd, encoding: "utf-8",
      }).trim()
    } catch {
      return "main"
    }
  }

  push(branch?: string): boolean {
    if (!this.isAvailable()) return false
    try {
      const args = ["push"]
      if (branch) args.push("origin", branch)
      execFileSync("git", args, { cwd: this.cwd, stdio: "ignore" })
      return true
    } catch {
      return false
    }
  }

  createBranch(name: string): boolean {
    if (!this.isAvailable()) return false
    try {
      execFileSync("git", ["checkout", "-b", name], { cwd: this.cwd, stdio: "ignore" })
      return true
    } catch {
      return false
    }
  }

  createPR(title: string, body: string, base = "main"): PRCreationResult | null {
    if (!this.isAvailable()) return null
    try {
      const branch = this.getCurrentBranch()
      this.push(branch)

      const output = execFileSync("gh", [
        "pr", "create",
        "--title", title,
        "--body", body,
        "--base", base,
        "--head", branch,
      ], { cwd: this.cwd, encoding: "utf-8" }).trim()

      const urlMatch = output.match(/https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/(\d+)/)
      if (urlMatch) {
        return {
          url: urlMatch[0],
          number: parseInt(urlMatch[1], 10),
          title,
          branch,
        }
      }

      return { url: output, number: 0, title, branch }
    } catch {
      return null
    }
  }

  getDiff(base = "main"): string {
    if (!this.isAvailable()) return ""
    try {
      return execFileSync("git", ["diff", base], { cwd: this.cwd, encoding: "utf-8" })
    } catch {
      return ""
    }
  }

  generatePRDescription(
    goal: string,
    steps: Array<{ id: string; description: string; success: boolean }>,
    filesChanged: string[],
  ): PRDescription {
    const completedSteps = steps.filter(s => s.success)
    const failedSteps = steps.filter(s => !s.success)
    const allSuccess = failedSteps.length === 0

    const title = goal.length > 72 ? goal.slice(0, 69) + "..." : goal

    const summary = allSuccess
      ? `Implements: ${goal}\n\nCompleted ${completedSteps.length} steps across ${filesChanged.length} files.`
      : `Partially implements: ${goal}\n\nCompleted ${completedSteps.length}/${steps.length} steps. ${failedSteps.length} steps need follow-up.`

    const changes = completedSteps.map(s => `- ${s.description}`)

    const testPlan = [
      `- [ ] Verify all changes compile without errors`,
      `- [ ] Run full test suite`,
      `- [ ] Manual review of ${filesChanged.slice(0, 5).join(", ")}`,
    ].join("\n")

    return {
      title,
      summary,
      changes,
      testPlan,
      breakingChanges: !allSuccess,
    }
  }
}
