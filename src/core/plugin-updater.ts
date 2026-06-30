import { execFileSync } from "node:child_process"
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"

/** Compare semver strings: returns true if latest > current. */
export function isNewerVersion(latest: string, current: string): boolean {
  const l = latest.split(".").map(Number)
  const c = current.split(".").map(Number)
  for (let i = 0; i < Math.max(l.length, c.length); i++) {
    if ((l[i] ?? 0) > (c[i] ?? 0)) return true
    if ((l[i] ?? 0) < (c[i] ?? 0)) return false
  }
  return false
}

/**
 * Auto-update: fire-and-forget. Fetch latest version from npm, download and
 * overwrite local plugin files if newer. User must restart OpenCode to apply.
 */
export async function autoUpdatePlugin(currentVersion: string, moduleUrl: string): Promise<void> {
  try {
    const res = await fetch(
      "https://registry.npmjs.org/opencode-agentic-engine/latest",
      { signal: AbortSignal.timeout(5000) }
    )
    if (!res.ok) return
    const data = await res.json() as { version: string }
    const latest = data.version
    if (!isNewerVersion(latest, currentVersion)) return

    const ownFile = fileURLToPath(moduleUrl)
    const distDir = dirname(ownFile)
    const pluginDir = dirname(distDir)
    const tmpDir = mkdtempSync(join(tmpdir(), "opencode-agentic-engine-"))

    try {
      execFileSync("npm", ["pack", "opencode-agentic-engine@latest"], {
        cwd: tmpDir,
        stdio: "pipe",
        timeout: 30000,
      })

      const tarball = readdirSync(tmpDir).find(f => f.endsWith(".tgz"))
      if (!tarball) return

      execFileSync("tar", ["-xzf", tarball], {
        cwd: tmpDir,
        stdio: "pipe",
        timeout: 10000,
      })

      const extractDir = join(tmpDir, "package")
      if (existsSync(extractDir)) {
        cpSync(extractDir, pluginDir, { recursive: true, force: true })
      }

      process.stderr.write(
        `\n[AgenticEngine] ✅ Auto-updated v${currentVersion} → v${latest}. Restart OpenCode to apply.\n`
      )
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  } catch {
    // ponytail: best-effort updater; failing closed would block plugin startup.
  }
}
