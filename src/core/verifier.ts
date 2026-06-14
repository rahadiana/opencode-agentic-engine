import { execFileSync } from "node:child_process"

export interface VerificationResult {
  passed: boolean
  stepId: string
  checks: CheckResult[]
  errors: string[]
}

export interface CheckResult {
  name: string
  passed: boolean
  output: string
}

export class Verifier {
  verifyCompile(projectDir: string): CheckResult {
    try {
      const output = execFileSync("npx", ["tsc", "--noEmit", "--pretty", "false"], {
        cwd: projectDir,
        timeout: 30000,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      })
      return {
        name: "compile",
        passed: true,
        output: output || "Compilation successful",
      }
    } catch (e: unknown) {
      const err = e as { stdout?: string; stderr?: string; message?: string }
      return {
        name: "compile",
        passed: false,
        output: err.stderr || err.stdout || err.message || "Compilation failed",
      }
    }
  }

  verifyTests(projectDir: string, testPattern = ""): CheckResult {
    try {
      const args = ["vitest", "run", "--reporter", "verbose"]
      if (testPattern) args.push("--", testPattern)

      const output = execFileSync("npx", args, {
        cwd: projectDir,
        timeout: 60000,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      })
      return {
        name: testPattern ? `test:${testPattern}` : "test:all",
        passed: true,
        output: output || "Tests passed",
      }
    } catch (e: unknown) {
      const err = e as { stdout?: string; stderr?: string; message?: string }
      return {
        name: testPattern ? `test:${testPattern}` : "test:all",
        passed: false,
        output: err.stdout || err.stderr || err.message || "Tests failed",
      }
    }
  }

  verifyAll(stepId: string, projectDir: string): VerificationResult {
    const checks = [
      this.verifyCompile(projectDir),
      this.verifyTests(projectDir),
    ]
    const errors = checks.filter(c => !c.passed).map(c => c.output)

    return {
      passed: errors.length === 0,
      stepId,
      checks,
      errors,
    }
  }

  verifyRelated(stepId: string, projectDir: string, changedFiles: string[]): VerificationResult {
    const checks: CheckResult[] = [this.verifyCompile(projectDir)]

    const testFiles = changedFiles
      .filter(f => f.includes(".test.") || f.includes(".spec."))
      .concat(
        changedFiles
          .filter(f => !f.includes(".test.") && !f.includes(".spec."))
          .map(f => f.replace(/\.(ts|tsx|js)$/, ".test.$1"))
      )

    if (testFiles.length > 0) {
      checks.push({
        name: `test:${testFiles.length} related files`,
        passed: true,
        output: `Related test files: ${testFiles.join(", ")}`,
      })
      checks.push(this.verifyTests(projectDir))
    } else {
      checks.push(this.verifyTests(projectDir))
    }

    const errors = checks.filter(c => !c.passed).map(c => c.output)
    return {
      passed: errors.length === 0,
      stepId,
      checks,
      errors,
    }
  }
}
