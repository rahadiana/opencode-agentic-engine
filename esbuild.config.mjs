import esbuild from "esbuild"

const watch = process.argv.includes("--watch")

const ctx = await esbuild.context({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  banner: {
    js: "// opencode-agentic-engine v0.1.0\n// Bundled for zero-install drop-in",
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
