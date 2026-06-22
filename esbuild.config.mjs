import esbuild from "esbuild"
import { readFileSync } from "node:fs"

const watch = process.argv.includes("--watch")
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf-8"))
const version = pkg.version

const ctx = await esbuild.context({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  minify: true,
  treeShaking: true,
  keepNames: true,
  legalComments: "external",
  external: ["@opencode-ai/plugin", "better-sqlite3"],
  define: {
    __VERSION__: JSON.stringify(version),
  },
  banner: {
    js: `// opencode-agentic-engine v${version}\n// Bundled for zero-install drop-in`,
  },
})

if (watch) {
  await ctx.watch()
  console.log("Watching for changes...")
} else {
  await ctx.rebuild()
  await ctx.dispose()
  console.log("Build complete: dist/index.js")
}
