// test/_runall.mjs — Part A orchestrator (dispatches to 10 focused sub-files)
import { assert, section, pluginDist, G, R, B, D, Y, RST, existsSync, join, tmpdir, mkdirSync, rmSync, writeFileSync, chmodSync, mkdtempSync, readFileSync, sdkMockClient, state, projectDir, mockCtx, freshSid } from "./_common.mjs"
import { runCoreTests } from "./_runall-core.mjs"
import { runVerifyTests } from "./_runall-verify.mjs"
import { runAdvancedTests } from "./_runall-adv.mjs"
import { runAdvancedVerifierTests } from "./_runall-adv-verifier.mjs"
import { runAdvancedBranchTests } from "./_runall-adv-branch.mjs"
import { runEvolutionTests } from "./_runall-evo.mjs"
import { runEdgeToolTests } from "./_runall-edge-tools.mjs"
import { runEdgeTrainingTests } from "./_runall-edge-training.mjs"
import { runEdgeVerifyTests } from "./_runall-edge-verify.mjs"
import { runEdgeGap4Tests } from "./_runall-edge-gap4.mjs"
import { runEdgeDeepTests } from "./_runall-edge-deep.mjs"
import { runEdgeConfigTests } from "./_runall-edge-config.mjs"
import { runGapTests } from "./_runall-gaps.mjs"
import { runRAGSelfImproveTests } from "./_runall-rag-selfimprove.mjs"

export async function runAll() {
  let mod
  try { mod = await import(pluginDist); assert(true, "plugin module loaded") }
  catch (e) { assert(false, `plugin module load: ${e.message}`) }
  assert(typeof mod.AgenticEngine === "function", "AgenticEngine is a function")

  await runCoreTests(mod)
  await runVerifyTests(mod)
  await runAdvancedTests(mod)
  await runAdvancedVerifierTests(mod)
  await runAdvancedBranchTests(mod)
  await runEvolutionTests(mod)
  await runEdgeToolTests(mod)
  await runEdgeTrainingTests(mod)
  await runEdgeVerifyTests(mod)
  await runEdgeGap4Tests(mod)
  await runEdgeDeepTests(mod)
  await runEdgeConfigTests(mod)
  await runGapTests(mod)
  await runRAGSelfImproveTests(mod)
}
