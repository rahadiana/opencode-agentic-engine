// test/_runall.mjs — Part A orchestrator (dispatches to 8 focused sub-files)
import { assert, section, pluginDist, G, R, B, D, Y, RST, existsSync, join, tmpdir, mkdirSync, rmSync, writeFileSync, chmodSync, mkdtempSync, readFileSync, sdkMockClient, state, projectDir, mockCtx, freshSid } from "./_common.mjs"
import { runCoreTests } from "./_runall-core.mjs"
import { runVerifyTests } from "./_runall-verify.mjs"
import { runAdvancedTests } from "./_runall-adv.mjs"
import { runEvolutionTests } from "./_runall-evo.mjs"
import { runEdgeToolTests } from "./_runall-edge-tools.mjs"
import { runEdgeTrainingTests } from "./_runall-edge-training.mjs"
import { runEdgeVerifyTests } from "./_runall-edge-verify.mjs"
import { runGapTests } from "./_runall-gaps.mjs"

export async function runAll() {
  let mod
  try { mod = await import(pluginDist); assert(true, "plugin module loaded") }
  catch (e) { assert(false, `plugin module load: ${e.message}`) }
  assert(typeof mod.AgenticEngine === "function", "AgenticEngine is a function")

  await runCoreTests(mod)
  await runVerifyTests(mod)
  await runAdvancedTests(mod)
  await runEvolutionTests(mod)
  await runEdgeToolTests(mod)
  await runEdgeTrainingTests(mod)
  await runEdgeVerifyTests(mod)
  await runGapTests(mod)
}
