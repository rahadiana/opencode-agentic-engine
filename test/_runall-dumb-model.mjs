// test/_runall-dumb-model.mjs — Auto dumb-model harness (name + stats)
import { assert, section, pluginDist } from "./_common.mjs"

export async function runDumbModelTests(mod) {
  section("DumbModelHarness")

  const {
    resolveDumbHarness,
    isWeakModelName,
    isWeakByStats,
    workflowModeForDumb,
    formatDumbHarnessNotice,
    normalizeModelId,
    ModelRegistry,
  } = mod

  assert(typeof resolveDumbHarness === "function", "DM-1a: resolveDumbHarness exported")
  assert(typeof isWeakModelName === "function", "DM-1b: isWeakModelName exported")
  assert(typeof workflowModeForDumb === "function", "DM-1c: workflowModeForDumb exported")

  // Name heuristics — weak
  assert(isWeakModelName("gpt-4o-mini") === true, "DM-2a: gpt-4o-mini is weak")
  assert(isWeakModelName("opencode/mimo-v2.5-free") === true, "DM-2b: free tier is weak")
  assert(isWeakModelName("google/gemini-2.0-flash") === true, "DM-2c: flash is weak")
  assert(isWeakModelName("ollama/qwen2.5:0.5b") === true, "DM-2d: 0.5b is weak")
  assert(isWeakModelName("9router/FlashCombo") === true, "DM-2e: FlashCombo weak")

  // Name heuristics — strong / capable
  assert(isWeakModelName("anthropic/claude-sonnet-4-6") === false, "DM-3a: sonnet not weak")
  assert(isWeakModelName("openai/gpt-4o") === false, "DM-3b: gpt-4o not weak by name alone")
  assert(isWeakModelName("deepseek/deepseek-r1") === false, "DM-3c: r1 strong")
  assert(isWeakModelName("unknown") === false, "DM-3d: unknown not forced weak")
  assert(isWeakModelName(null) === false, "DM-3e: null not weak")

  // Forced modes
  const forcedOn = resolveDumbHarness({ dumbModelMode: true, model: "anthropic/claude-opus" })
  assert(forcedOn.active === true && forcedOn.source === "forced-on", "DM-4a: true forces ON even for strong model")

  const forcedOff = resolveDumbHarness({ dumbModelMode: false, model: "gpt-4o-mini" })
  assert(forcedOff.active === false && forcedOff.source === "forced-off", "DM-4b: false forces OFF even for weak name")

  // Auto by name
  const autoWeak = resolveDumbHarness({ dumbModelMode: "auto", model: "gpt-4o-mini" })
  assert(autoWeak.active === true && autoWeak.source === "auto-name", "DM-5a: auto+mini → ON by name")

  const autoStrong = resolveDumbHarness({ dumbModelMode: "auto", model: "anthropic/claude-sonnet-4" })
  assert(autoStrong.active === false && autoStrong.source === "auto-off", "DM-5b: auto+sonnet → OFF")

  // Default (undefined) behaves as auto
  const defaultAuto = resolveDumbHarness({ model: "gemini-flash" })
  assert(defaultAuto.active === true, "DM-5c: undefined mode defaults to auto detection")

  // Stats-based: degraded/unstable model
  const registry = new ModelRegistry()
  registry.addModel("custom/mystery-model")
  // Simulate poor performance: many failures
  for (let i = 0; i < 8; i++) {
    registry.recordCall("custom/mystery-model", false, 100)
  }
  registry.recordHallucination("custom/mystery-model")
  registry.recordHallucination("custom/mystery-model")
  registry.recordHallucination("custom/mystery-model")

  const score = registry.getScore("custom/mystery-model")
  assert(score && score.totalCalls >= 5, "DM-6a: enough samples for stats")
  const statsWeak = isWeakByStats("custom/mystery-model", registry, 0.4, 5)
  assert(statsWeak.weak === true, `DM-6b: poor stats → weak (${statsWeak.reason})`)

  const autoStats = resolveDumbHarness({
    dumbModelMode: "auto",
    model: "custom/mystery-model",
    modelRegistry: registry,
    softBlockReliability: 0.4,
    minSampleSize: 5,
  })
  assert(autoStats.active === true, "DM-6c: auto+bad stats → ON")
  assert(autoStats.source === "auto-stats" || autoStats.source === "auto-name", "DM-6d: source is stats or name")

  // Workflow mode mapping
  assert(workflowModeForDumb({ active: true, reason: "x", source: "auto-name" }, "advisory") === "strict", "DM-7a: active → strict")
  assert(workflowModeForDumb({ active: false, reason: "x", source: "auto-off" }, "advisory") === "advisory", "DM-7b: inactive → advisory")
  assert(workflowModeForDumb({ active: false, reason: "x", source: "auto-off" }, "strict") === "strict", "DM-7c: inactive keeps configured strict")

  // Notice formatting
  const notice = formatDumbHarnessNotice(autoWeak)
  assert(notice.includes("Dumb-Model Harness ACTIVE"), "DM-8a: notice when active")
  assert(formatDumbHarnessNotice(autoStrong) === "", "DM-8b: empty notice when inactive")

  assert(normalizeModelId("  OpenAI/GPT-4o-Mini  ") === "openai/gpt-4o-mini", "DM-9: normalize lowercases")

  // Config default includes auto
  if (typeof mod.DEFAULT_CONFIG === "object" || mod.ConfigLoader) {
    const { ConfigLoader, DEFAULT_CONFIG } = mod
    if (DEFAULT_CONFIG?.agent) {
      assert(
        DEFAULT_CONFIG.agent.dumbModelMode === "auto" || DEFAULT_CONFIG.agent.dumbModelMode === true,
        `DM-10a: default dumbModelMode is auto (got ${DEFAULT_CONFIG.agent.dumbModelMode})`,
      )
    } else {
      assert(true, "DM-10a: DEFAULT_CONFIG not exported — skip")
    }
  }
}

// Standalone worker
const _isMain = typeof process !== "undefined" && process.argv[1] && (
  process.argv[1] === import.meta.url || process.argv[1].endsWith("/_runall-dumb-model.mjs")
)
if (_isMain) {
  const { pluginDist: _pd } = await import("./_common.mjs")
  const _mod = await import(_pd)
  await runDumbModelTests(_mod)
  const { state } = await import("./_state.mjs")
  console.log(`__RESULT__:${JSON.stringify({ passed: state.passed, failed: state.failed })}`)
  process.exit(state.failed > 0 ? 1 : 0)
}
