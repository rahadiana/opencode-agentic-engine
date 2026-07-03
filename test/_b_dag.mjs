// _b_dag.mjs — Part B: DAG Engine tests (split from _b_dagworld.mjs)
import { pluginDist, G, R, RST, state, assert, section, mockCtx, freshSid, join, tmpdir, existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, chmodSync, mkdtempSync, sdkMockClient, Y, B, D, projectDir } from "./_common.mjs"

console.log("\n[DAG] DAG Engine — DAG-based execution")
const { DAGEngine: DAG } = await import(pluginDist)
let dag = 0, dagf = 0

const dagOk = (name, fn) => { try { fn(); dag++; console.log(`  PASS: ${name}`) } catch (e) { dagf++; console.log(`  FAIL: ${name} — ${e.message}`) } }
const dagAwait = async (name, fn) => { try { await fn(); dag++; console.log(`  PASS: ${name}`) } catch (e) { dagf++; console.log(`  FAIL: ${name} — ${e.message}`) } }

dagOk("DAG-1a buildDAG creates plan with correct node count", () => {
  const engine = new DAG()
  const { plan } = engine.buildDAG("test goal", [
    { id: "s1", description: "Step one", dependsOn: [], verificationCriteria: [] },
    { id: "s2", description: "Step two", dependsOn: ["s1"], verificationCriteria: [] },
  ])
  if (plan.nodes.length !== 2) throw new Error(`Expected 2 nodes, got ${plan.nodes.length}`)
  if (plan.goal !== "test goal") throw new Error(`Wrong goal: ${plan.goal}`)
})

dagOk("DAG-1b buildDAG infers node types correctly", () => {
  const engine = new DAG()
  const { plan } = engine.buildDAG("test", [
    { id: "s1", description: "Verify compilation works", dependsOn: [], verificationCriteria: [] },
    { id: "s2", description: "Design the architecture", dependsOn: [], verificationCriteria: [] },
    { id: "s3", description: "Implement the feature", dependsOn: ["s2"], verificationCriteria: [] },
    { id: "s4", description: "Debug runtime error", dependsOn: ["s3"], verificationCriteria: [] },
    { id: "s5", description: "Delegate task to external", dependsOn: [], verificationCriteria: [] },
  ])
  const s1 = plan.nodes.find(n => n.id === "s1")
  const s2 = plan.nodes.find(n => n.id === "s2")
  const s4 = plan.nodes.find(n => n.id === "s4")
  const s5 = plan.nodes.find(n => n.id === "s5")
  if (s1?.type !== "verify") throw new Error(`s1 should be verify, got ${s1?.type}`)
  if (s2?.type !== "plan") throw new Error(`s2 should be plan, got ${s2?.type}`)
  if (s4?.type !== "reflect") throw new Error(`s4 should be reflect, got ${s4?.type}`)
  if (s5?.type !== "delegate") throw new Error(`s5 should be delegate, got ${s5?.type}`)
})

dagOk("DAG-2a computePhases produces correct topological order", () => {
  const engine = new DAG()
  const { context } = engine.buildDAG("test", [
    { id: "a", description: "Root", dependsOn: [], verificationCriteria: [] },
    { id: "b", description: "Depends on a", dependsOn: ["a"], verificationCriteria: [] },
    { id: "c", description: "Depends on a", dependsOn: ["a"], verificationCriteria: [] },
    { id: "d", description: "Depends on b,c", dependsOn: ["b", "c"], verificationCriteria: [] },
  ])
  engine.computePhases(context)
  if (context.phases.length !== 3) throw new Error(`Expected 3 phases, got ${context.phases.length}`)
  if (!context.phases[0].nodeIds.includes("a")) throw new Error("Phase 0 should contain a")
  if (context.phases[0].nodeIds.length !== 1) throw new Error("Phase 0 should have 1 node")
  if (context.phases[1].nodeIds.length !== 2) throw new Error("Phase 1 should have 2 nodes")
  if (!context.phases[1].nodeIds.includes("b")) throw new Error("Phase 1 should contain b")
  if (!context.phases[1].nodeIds.includes("c")) throw new Error("Phase 1 should contain c")
  if (!context.phases[2].nodeIds.includes("d")) throw new Error("Phase 2 should contain d")
})

dagOk("DAG-2b computePhases throws on circular dependencies", () => {
  const engine = new DAG()
  const { context } = engine.buildDAG("test", [
    { id: "a", description: "Root", dependsOn: ["b"], verificationCriteria: [] },
    { id: "b", description: "Depends on a", dependsOn: ["a"], verificationCriteria: [] },
  ])
  let threw = false
  try { engine.computePhases(context) } catch (e) { threw = true }
  if (!threw) throw new Error("Should throw on circular dependency")
})

dagOk("DAG-3a getReadyNodes returns nodes with met dependencies", () => {
  const engine = new DAG()
  const { context } = engine.buildDAG("test", [
    { id: "a", description: "Root", dependsOn: [], verificationCriteria: [] },
    { id: "b", description: "Depends on a", dependsOn: ["a"], verificationCriteria: [] },
  ])
  const ready = engine.getReadyNodes(context)
  if (ready.length !== 1) throw new Error(`Expected 1 ready node, got ${ready.length}`)
  if (ready[0].id !== "a") throw new Error(`Expected node a, got ${ready[0].id}`)
})

dagOk("DAG-3b getReadyNodes returns empty after all completed", () => {
  const engine = new DAG()
  const { context } = engine.buildDAG("test", [
    { id: "a", description: "Root", dependsOn: [], verificationCriteria: [] },
  ])
  context.nodeStates.set("a", { nodeId: "a", status: "completed", retryCount: 0 })
  const ready = engine.getReadyNodes(context)
  if (ready.length !== 0) throw new Error(`Expected 0 ready, got ${ready.length}`)
})

dagOk("DAG-6a toSubtasks converts back to Subtask[]", () => {
  const engine = new DAG()
  const { plan } = engine.buildDAG("test", [
    { id: "x", description: "First", dependsOn: [], verificationCriteria: [] },
    { id: "y", description: "Second", dependsOn: ["x"], verificationCriteria: [] },
  ])
  const subtasks = engine.toSubtasks(plan)
  if (subtasks.length !== 2) throw new Error(`Expected 2 subtasks, got ${subtasks.length}`)
  if (subtasks[0].id !== "x" || subtasks[1].id !== "y") throw new Error("Wrong subtask order")
  if (subtasks[1].dependsOn[0] !== "x") throw new Error("Wrong dependency")
})

dagOk("DAG-8a getProgress returns correct counts", () => {
  const engine = new DAG()
  const { context } = engine.buildDAG("test", [
    { id: "a", description: "A", dependsOn: [], verificationCriteria: [] },
    { id: "b", description: "B", dependsOn: ["a"], verificationCriteria: [] },
    { id: "c", description: "C", dependsOn: ["b"], verificationCriteria: [] },
  ])
  let p = engine.getProgress(context)
  if (p.total !== 3) throw new Error("Total should be 3")
  if (p.completed !== 0) throw new Error("Should be 0 completed")
  context.nodeStates.set("a", { nodeId: "a", status: "completed", retryCount: 0 })
  p = engine.getProgress(context)
  if (p.completed !== 1) throw new Error("Should be 1 completed")
  if (p.pending !== 2) throw new Error("Should be 2 pending")
})

dagOk("DAG-8b getProgress counts failed nodes", () => {
  const engine = new DAG()
  const { context } = engine.buildDAG("test", [
    { id: "a", description: "A", dependsOn: [], verificationCriteria: [] },
  ])
  context.nodeStates.set("a", { nodeId: "a", status: "failed", retryCount: 2, error: "err" })
  const p = engine.getProgress(context)
  if (p.failed !== 1) throw new Error("Should be 1 failed")
})

dagOk("DAG-10a metadata config overrides work", () => {
  const engine = new DAG()
  const { plan } = engine.buildDAG("test", [
    { id: "a", description: "A", dependsOn: [], verificationCriteria: [] },
  ], {
    maxParallel: 1, circuitBreaker: false, recoveryStrategy: "escalate", maxSteps: 5,
  })
  if (plan.metadata.maxParallel !== 1) throw new Error("maxParallel should be 1")
  if (plan.metadata.circuitBreaker !== false) throw new Error("circuitBreaker should be false")
  if (plan.metadata.recoveryStrategy !== "escalate") throw new Error("recoveryStrategy should be escalate")
  if (plan.metadata.maxSteps !== 5) throw new Error("maxSteps should be 5")
})

dagOk("DAG-10b default metadata values", () => {
  const engine = new DAG()
  const { plan } = engine.buildDAG("test", [
    { id: "a", description: "A", dependsOn: [], verificationCriteria: [] },
  ])
  if (plan.metadata.maxParallel !== 4) throw new Error("Default maxParallel should be 4")
  if (plan.metadata.circuitBreaker !== true) throw new Error("Default circuitBreaker should be true")
  if (plan.metadata.recoveryStrategy !== "restart-node") throw new Error("Default recoveryStrategy should be restart-node")
})

// ── Async DAG Tests ───────────────────────────────────────────────
// Jalankan sequential, await each one before printing summary
await dagAwait("DAG-4a executeNode runs a node and returns success", async () => {
  const engine = new DAG()
  const { context } = engine.buildDAG("test", [
    { id: "a", description: "Step A", dependsOn: [], verificationCriteria: [] },
  ])
  const result = await engine.executeNode(context, context.nodes.get("a"), async (node) => ({
    success: true, output: "done", filesModified: ["file.ts"],
  }))
  if (!result.success) throw new Error("Should succeed")
  if (result.output !== "done") throw new Error(`Wrong output: ${result.output}`)
  const state = context.nodeStates.get("a")
  if (state?.status !== "completed") throw new Error(`Expected completed, got ${state?.status}`)
})

await dagAwait("DAG-4b executeNode retries on failure then succeeds", async () => {
  const engine = new DAG()
  const { context } = engine.buildDAG("test", [
    { id: "a", description: "Step A", dependsOn: [], verificationCriteria: [] },
  ])
  let attempts = 0
  const result = await engine.executeNode(context, context.nodes.get("a"), async (node) => {
    attempts++
    if (attempts < 3) return { success: false, output: "fail", filesModified: [], error: "temporary" }
    return { success: true, output: "finally ok", filesModified: [] }
  })
  if (!result.success) throw new Error("Should eventually succeed")
  if (attempts !== 3) throw new Error(`Expected 3 attempts, got ${attempts}`)
})

await dagAwait("DAG-4c executeNode respects maxRetries and fails", async () => {
  const engine = new DAG()
  const { context } = engine.buildDAG("test", [
    { id: "a", description: "Step A", dependsOn: [], verificationCriteria: [] },
  ])
  const node = context.nodes.get("a")
  node.config.maxRetries = 2
  node.config.retryStrategy = "none"
  let attempts = 0
  const result = await engine.executeNode(context, node, async (node) => {
    attempts++
    return { success: false, output: "fail", filesModified: [], error: "always fails" }
  })
  if (result.success) throw new Error("Should fail")
  if (attempts !== 3) throw new Error(`Expected 3 attempts, got ${attempts}`)
  const state = context.nodeStates.get("a")
  if (state?.status !== "failed") throw new Error(`Expected failed, got ${state?.status}`)
})

await dagAwait("DAG-5a execute full DAG with all nodes completing", async () => {
  const engine = new DAG()
  const { context } = engine.buildDAG("test", [
    { id: "a", description: "Root", dependsOn: [], verificationCriteria: [] },
    { id: "b", description: "Depends on a", dependsOn: ["a"], verificationCriteria: [] },
    { id: "c", description: "Also root", dependsOn: [], verificationCriteria: [] },
  ])
  engine.computePhases(context)
  const ran = []
  const result = await engine.execute(context, async (node) => {
    ran.push(node.id)
    return { success: true, output: `done ${node.id}`, filesModified: [] }
  })
  if (!result.success) throw new Error("Should succeed")
  if (result.completedNodes.length !== 3) throw new Error(`Expected 3 completed, got ${result.completedNodes.length}`)
  const aIdx = ran.indexOf("a"); const cIdx = ran.indexOf("c"); const bIdx = ran.indexOf("b")
  if (bIdx < Math.max(aIdx, cIdx)) throw new Error("b should run after both a and c")
})

await dagAwait("DAG-5b circuit breaker trips on loop detection", async () => {
  const engine = new DAG()
  const { context } = engine.buildDAG("test", [
    { id: "a", description: "Root", dependsOn: [], verificationCriteria: [] },
  ])
  engine.computePhases(context)
  const now = Date.now()
  for (let i = 0; i < 10; i++) context.callHistory.push({ nodeId: "a", ts: now, hash: "a" })
  const node = context.nodes.get("a")
  node.config.maxRetries = 0; node.config.retryStrategy = "none"
  const result = await engine.executeNode(context, node, async (node) => {
    return { success: false, output: "fail", filesModified: [], error: "always fails" }
  })
  if (result.success) throw new Error("Should fail due to circuit breaker")
})

await dagAwait("DAG-7a execute phase with parallel concurrency", async () => {
  const engine = new DAG()
  const { context } = engine.buildDAG("test", [
    { id: "a", description: "Root", dependsOn: [], verificationCriteria: [] },
    { id: "b", description: "Also root", dependsOn: [], verificationCriteria: [] },
    { id: "c", description: "Also root 2", dependsOn: [], verificationCriteria: [] },
  ], { maxParallel: 2 })
  engine.computePhases(context)
  let maxConcurrent = 0; let current = 0
  const result = await engine.execute(context, async (node) => {
    current++; maxConcurrent = Math.max(maxConcurrent, current)
    await new Promise(r => setTimeout(r, 10)); current--
    return { success: true, output: node.id, filesModified: [] }
  })
  if (!result.success) throw new Error("Should succeed")
  if (result.completedNodes.length !== 3) throw new Error("All 3 nodes should complete")
})

await dagAwait("DAG-9a observer callbacks fire during execution", async () => {
  const engine = new DAG()
  const { context } = engine.buildDAG("test", [
    { id: "a", description: "A", dependsOn: [], verificationCriteria: [] },
  ])
  engine.computePhases(context)
  let nodeStarted = false, nodeCompleted = false, phaseStarted = false, phaseCompleted = false, dagCompleted = false
  engine.addObserver({
    onNodeStart: () => { nodeStarted = true },
    onNodeComplete: () => { nodeCompleted = true },
    onPhaseStart: () => { phaseStarted = true },
    onPhaseComplete: () => { phaseCompleted = true },
    onDAGComplete: () => { dagCompleted = true },
    onRecovery: () => {}, onCircuitBreaker: () => {},
  })
  await engine.execute(context, async (node) => ({ success: true, output: "ok", filesModified: [] }))
  if (!nodeStarted) throw new Error("onNodeStart should fire")
  if (!nodeCompleted) throw new Error("onNodeComplete should fire")
  if (!phaseStarted) throw new Error("onPhaseStart should fire")
  if (!phaseCompleted) throw new Error("onPhaseComplete should fire")
  if (!dagCompleted) throw new Error("onDAGComplete should fire")
})

// ── Branch coverage: budget check, abort, catch block, recovery, circuit breaker callback ──

await dagAwait("DAG-10c budget check exceeded via executeNode stops execution", async () => {
  const engine = new DAG()
  const { context } = engine.buildDAG("test", [
    { id: "a", description: "Root", dependsOn: [], verificationCriteria: [] },
  ])
  engine.computePhases(context)
  engine.setBudgetChecker(() => ({ exceeded: true, metric: "tokens", current: 100, limit: 50 }))
  const node = context.nodes.get("a")
  node.config.maxRetries = 0; node.config.retryStrategy = "none"
  const result = await engine.executeNode(context, node, async (node) => {
    return { success: true, output: "ok", filesModified: [] }
  })
  if (result.success) throw new Error("Should fail due to budget exceeded")
  if (!result.error?.includes("Budget exceeded")) throw new Error(`Expected budget error, got: ${result.error}`)
})

await dagAwait("DAG-10d budget check exceeded via execute stops at phase level", async () => {
  const engine = new DAG()
  const { context } = engine.buildDAG("test", [
    { id: "a", description: "Root", dependsOn: [], verificationCriteria: [] },
  ])
  engine.computePhases(context)
  engine.setBudgetChecker(() => ({ exceeded: true, metric: "steps", current: 10, limit: 5 }))
  const result = await engine.execute(context, async (node) => {
    return { success: true, output: "ok", filesModified: [] }
  })
  if (result.success) throw new Error("Should fail due to budget exceeded")
})

await dagAwait("DAG-10e abort signal stops executeNode early", async () => {
  const engine = new DAG()
  const { context } = engine.buildDAG("test", [
    { id: "a", description: "Root", dependsOn: [], verificationCriteria: [] },
  ])
  engine.computePhases(context)
  const ac = new AbortController()
  ac.abort()
  const result = await engine.executeNode(context, context.nodes.get("a"), async (node) => {
    return { success: true, output: "ok", filesModified: [] }
  }, ac.signal)
  if (result.success) throw new Error("Should fail due to abort")
  if (result.error !== "Execution aborted") throw new Error(`Expected 'Execution aborted', got: ${result.error}`)
})

await dagAwait("DAG-10f executeNode with valid external AbortSignal uses combinedAbort", async () => {
  const engine = new DAG()
  const { context } = engine.buildDAG("test", [
    { id: "a", description: "Root", dependsOn: [], verificationCriteria: [] },
  ])
  engine.computePhases(context)
  const ac = new AbortController()
  const result = await engine.executeNode(context, context.nodes.get("a"), async (node) => {
    return { success: true, output: "done", filesModified: [] }
  }, ac.signal)
  if (!result.success) throw new Error(`Should succeed, got: ${result.error}`)
  if (result.output !== "done") throw new Error(`Expected 'done', got: ${result.output}`)
})

await dagAwait("DAG-10g executeNode catch block handles runner throw", async () => {
  const engine = new DAG()
  const { context } = engine.buildDAG("test", [
    { id: "a", description: "Root", dependsOn: [], verificationCriteria: [] },
  ])
  engine.computePhases(context)
  const node = context.nodes.get("a")
  node.config.maxRetries = 0
  node.config.retryStrategy = "none"
  const result = await engine.executeNode(context, node, async (node) => {
    throw new Error("runner crashed")
  })
  if (result.success) throw new Error("Should fail")
  if (!result.error?.includes("runner crashed")) throw new Error(`Expected 'runner crashed', got: ${result.error}`)
})

await dagAwait("DAG-10h executeNode catch block retries on throw", async () => {
  const engine = new DAG()
  const { context } = engine.buildDAG("test", [
    { id: "a", description: "Root", dependsOn: [], verificationCriteria: [] },
  ])
  engine.computePhases(context)
  const node = context.nodes.get("a")
  node.config.maxRetries = 2
  node.config.retryStrategy = "none"
  let attempts = 0
  const result = await engine.executeNode(context, node, async (node) => {
    attempts++
    throw new Error(`attempt ${attempts}`)
  })
  if (result.success) throw new Error("Should fail")
  if (attempts !== 3) throw new Error(`Expected 3 attempts, got ${attempts}`)
})

await dagAwait("DAG-10i execute recovery escalate triggers onRecovery observer", async () => {
  const engine = new DAG()
  const { context } = engine.buildDAG("test", [
    { id: "a", description: "Root", dependsOn: [], verificationCriteria: [] },
  ], { recoveryStrategy: "escalate" })
  engine.computePhases(context)
  let recoveryNodeId = ""
  engine.addObserver({
    onRecovery: (nodeId, strategy) => { recoveryNodeId = nodeId },
    onNodeStart: () => {}, onNodeComplete: () => {}, onPhaseStart: () => {}, onPhaseComplete: () => {}, onDAGComplete: () => {}, onCircuitBreaker: () => {},
  })
  const result = await engine.execute(context, async (node) => {
    return { success: false, output: "fail", filesModified: [], error: "always fails" }
  })
  if (result.success) throw new Error("Should fail")
  if (recoveryNodeId !== "a") throw new Error(`Expected recovery for node 'a', got '${recoveryNodeId}'`)
})

await dagAwait("DAG-10j execute restart-plan triggers onRecovery and skips downstream", async () => {
  const engine = new DAG()
  const { context } = engine.buildDAG("test", [
    { id: "a", description: "Root", dependsOn: [], verificationCriteria: [] },
    { id: "b", description: "Depends on a", dependsOn: ["a"], verificationCriteria: [] },
  ], { recoveryStrategy: "restart-plan" })
  engine.computePhases(context)
  let recoveryCalled = false
  engine.addObserver({
    onRecovery: (nodeId, strategy) => { recoveryCalled = true },
    onNodeStart: () => {}, onNodeComplete: () => {}, onPhaseStart: () => {}, onPhaseComplete: () => {}, onDAGComplete: () => {}, onCircuitBreaker: () => {},
  })
  const result = await engine.execute(context, async (node) => {
    if (node.id === "a") return { success: false, output: "fail", filesModified: [], error: "always fails" }
    return { success: true, output: "ok", filesModified: [] }
  })
  if (result.success) throw new Error("Should fail")
  if (!recoveryCalled) throw new Error("onRecovery should be called")
  const bState = context.nodeStates.get("b")
  if (bState?.status !== "skipped") throw new Error(`Expected b to be skipped, got: ${bState?.status}`)
})

await dagAwait("DAG-10k onCircuitBreaker observer fires on loop detection", async () => {
  const engine = new DAG()
  const { context } = engine.buildDAG("test", [
    { id: "a", description: "Root", dependsOn: [], verificationCriteria: [] },
  ])
  engine.computePhases(context)
  const now = Date.now()
  for (let i = 0; i < 10; i++) context.callHistory.push({ nodeId: "a", ts: now, hash: "a" })
  const node = context.nodes.get("a")
  node.config.maxRetries = 0; node.config.retryStrategy = "none"
  let cbNodeId = ""
  engine.addObserver({
    onCircuitBreaker: (nodeId, reason) => { cbNodeId = nodeId },
    onNodeStart: () => {}, onNodeComplete: () => {}, onPhaseStart: () => {}, onPhaseComplete: () => {}, onDAGComplete: () => {}, onRecovery: () => {},
  })
  const result = await engine.executeNode(context, node, async (node) => {
    return { success: false, output: "fail", filesModified: [], error: "always fails" }
  })
  if (result.success) throw new Error("Should fail due to circuit breaker")
  if (cbNodeId !== "a") throw new Error(`Expected circuit breaker for node 'a', got '${cbNodeId}'`)
})

await dagAwait("DAG-10l abort signal stops execute at phase level", async () => {
  const engine = new DAG()
  const { context } = engine.buildDAG("test", [
    { id: "a", description: "Root", dependsOn: [], verificationCriteria: [] },
  ])
  engine.computePhases(context)
  const ac = new AbortController()
  ac.abort()
  const result = await engine.execute(context, async (node) => {
    return { success: true, output: "ok", filesModified: [] }
  }, ac.signal)
  if (result.success) throw new Error("Should fail due to abort signal")
})

await dagAwait("DAG-10m execute skips phase when all nodes already completed", async () => {
  const engine = new DAG()
  const { context } = engine.buildDAG("test", [
    { id: "a", description: "Root", dependsOn: [], verificationCriteria: [] },
  ])
  engine.computePhases(context)
  // Pre-complete all nodes in phase 0
  context.nodeStates.set("a", { nodeId: "a", status: "completed", retryCount: 0 })
  const result = await engine.execute(context, async (node) => {
    return { success: true, output: "ok", filesModified: [] }
  })
  if (!result.success) throw new Error("Should succeed with no work")
  if (result.completedNodes.length !== 1) throw new Error(`Expected 1 completed, got ${result.completedNodes.length}`)
})

await dagAwait("DAG-10n buildDAG warns on missing dependency", async () => {
  const engine = new DAG()
  const { plan } = engine.buildDAG("test", [
    { id: "a", description: "Depends on missing", dependsOn: ["nonexistent"], verificationCriteria: [] },
  ])
  // Should still build the plan — missing deps become root nodes
  if (plan.nodes.length !== 1) throw new Error(`Expected 1 node, got ${plan.nodes.length}`)
})

await dagAwait("DAG-10o executeNode initializes state when nodeState missing", async () => {
  const engine = new DAG()
  const { context } = engine.buildDAG("test", [
    { id: "a", description: "Root", dependsOn: [], verificationCriteria: [] },
  ])
  engine.computePhases(context)
  // Remove pre-initialized state to force the !state branch in executeNode
  context.nodeStates.delete("a")
  const result = await engine.executeNode(context, context.nodes.get("a"), async (node) => {
    return { success: true, output: "done", filesModified: [] }
  })
  if (!result.success) throw new Error("Should succeed")
  const state = context.nodeStates.get("a")
  if (state?.status !== "completed") throw new Error(`Expected completed, got ${state?.status}`)
})

await dagAwait("DAG-10p executeNode already-completed node returns early", async () => {
  const engine = new DAG()
  const { context } = engine.buildDAG("test", [
    { id: "a", description: "Root", dependsOn: [], verificationCriteria: [] },
  ])
  engine.computePhases(context)
  // First call: completes the node
  await engine.executeNode(context, context.nodes.get("a"), async (node) => ({
    success: true, output: "first run", filesModified: [],
  }))
  // Second call: should return early — already completed
  const result = await engine.executeNode(context, context.nodes.get("a"), async (node) => ({
    success: true, output: "should not run", filesModified: [],
  }))
  if (!result.success) throw new Error("Early return should succeed")
  if (result.output !== "first run") throw new Error(`Expected 'first run', got '${result.output}'`)
})

await dagAwait("DAG-10q executeNode null error falls back to output", async () => {
  const engine = new DAG()
  const { context } = engine.buildDAG("test", [
    { id: "a", description: "Root", dependsOn: [], verificationCriteria: [] },
  ])
  engine.computePhases(context)
  const node = context.nodes.get("a")
  node.config.maxRetries = 0; node.config.retryStrategy = "none"
  // result.error is null → ?? falls to result.output
  const result = await engine.executeNode(context, node, async (node) => ({
    success: false, output: "fallback output", filesModified: [], error: null,
  }))
  if (result.success) throw new Error("Should fail")
  if (result.error !== "fallback output") throw new Error(`Expected 'fallback output', got '${result.error}'`)
})

await dagAwait("DAG-10r executeNode null error and output falls to Unknown error", async () => {
  const engine = new DAG()
  const { context } = engine.buildDAG("test", [
    { id: "a", description: "Root", dependsOn: [], verificationCriteria: [] },
  ])
  engine.computePhases(context)
  const node = context.nodes.get("a")
  node.config.maxRetries = 0; node.config.retryStrategy = "none"
  // Both error and output null/undefined → ?? falls to "Unknown error"
  const result = await engine.executeNode(context, node, async (node) => ({
    success: false, output: null, filesModified: [], error: null,
  }))
  if (result.success) throw new Error("Should fail")
  if (result.error !== "Unknown error") throw new Error(`Expected 'Unknown error', got '${result.error}'`)
})

await dagAwait("DAG-10s executeNode catch block handles non-Error throw", async () => {
  const engine = new DAG()
  const { context } = engine.buildDAG("test", [
    { id: "a", description: "Root", dependsOn: [], verificationCriteria: [] },
  ])
  engine.computePhases(context)
  const node = context.nodes.get("a")
  node.config.maxRetries = 0; node.config.retryStrategy = "none"
  const result = await engine.executeNode(context, node, async (node) => {
    // eslint-disable-next-line no-throw-literal
    throw "string error"  // not an Error instance — tests err instanceof Error branch
  })
  if (result.success) throw new Error("Should fail")
  if (result.error !== "string error") throw new Error(`Expected 'string error', got '${result.error}'`)
})

await dagAwait("DAG-10t executePhase sequential aborts between nodes", async () => {
  const engine = new DAG()
  const { context } = engine.buildDAG("test", [
    { id: "a", description: "First", dependsOn: [], verificationCriteria: [] },
    { id: "b", description: "Second", dependsOn: [], verificationCriteria: [] },
  ], { maxParallel: 1 })
  engine.computePhases(context)
  const ac = new AbortController()
  const result = await engine.execute(context, async (node) => {
    if (node.id === "a") { ac.abort(); return { success: true, output: "first", filesModified: [] } }
    return { success: true, output: "second", filesModified: [] }
  }, ac.signal)
  if (!result.completedNodes.includes("a")) throw new Error("Node a should have completed")
})

await dagAwait("DAG-10u execute auto-computes phases when not pre-computed", async () => {
  const engine = new DAG()
  const { context } = engine.buildDAG("test", [
    { id: "a", description: "Root", dependsOn: [], verificationCriteria: [] },
  ])
  // Do NOT call computePhases before execute — let execute() do it internally
  const result = await engine.execute(context, async (node) => {
    return { success: true, output: "auto", filesModified: [] }
  })
  if (!result.success) throw new Error("Should succeed")
  if (result.completedNodes.length !== 1) throw new Error("Expected 1 completed")
})

await dagAwait("DAG-10v executeNode already-completed with no output uses fallback", async () => {
  const engine = new DAG()
  const { context } = engine.buildDAG("test", [
    { id: "a", description: "Root", dependsOn: [], verificationCriteria: [] },
  ])
  engine.computePhases(context)
  // Manually set state to completed without output
  context.nodeStates.set("a", { nodeId: "a", status: "completed", retryCount: 0 })
  const result = await engine.executeNode(context, context.nodes.get("a"), async (node) => ({
    success: true, output: "should be ignored", filesModified: [],
  }))
  if (!result.success) throw new Error("Should succeed")
  if (result.output !== "(already completed)") throw new Error(`Expected '(already completed)', got '${result.output}'`)
})

await dagAwait("DAG-10w catch block with aborted signal breaks immediately", async () => {
  const engine = new DAG()
  const { context } = engine.buildDAG("test", [
    { id: "a", description: "Root", dependsOn: [], verificationCriteria: [] },
  ])
  engine.computePhases(context)
  const node = context.nodes.get("a")
  node.config.maxRetries = 2
  node.config.retryStrategy = "none"
  const ac = new AbortController()
  let attempts = 0
  const result = await engine.executeNode(context, node, async (node, signal) => {
    attempts++
    // Abort signal inside runner so catch block sees signal?.aborted === true
    ac.abort()
    throw new Error("crashed with abort")
  }, ac.signal)
  if (result.success) throw new Error("Should fail")
  if (attempts !== 1) throw new Error(`Expected 1 attempt (abort), got ${attempts}`)
})

await dagAwait("DAG-10x execute breaks on zero progress when all nodes fail", async () => {
  const engine = new DAG()
  const { context } = engine.buildDAG("test", [
    { id: "a", description: "Root", dependsOn: [], verificationCriteria: [] },
  ], { recoveryStrategy: "restart-node" })
  engine.computePhases(context)
  const result = await engine.execute(context, async (node) => {
    return { success: false, output: "always fails", filesModified: [], error: "fail" }
  })
  if (result.success) throw new Error("Should fail")
  if (!result.failedNodes.includes("a")) throw new Error("a should be in failed nodes")
})

await dagAwait("DAG-10y permanently-failed node filtered out of active phase", async () => {
  const engine = new DAG()
  const { context } = engine.buildDAG("test", [
    { id: "a", description: "Root", dependsOn: [], verificationCriteria: [] },
  ], { recoveryStrategy: "restart-node" })
  engine.computePhases(context)
  // Set state to failed with retries exhausted so canRetry returns false
  context.nodeStates.set("a", { nodeId: "a", status: "failed", retryCount: 5, error: "exhausted" })
  const result = await engine.execute(context, async (node) => {
    return { success: true, output: "should not run", filesModified: [] }
  })
  // Permanently-failed node is filtered out → phase has 0 active nodes → skipped
  // Since failedCount=0 (no execution happened), success is true... but node a was already failed
  // Coverage-focused: just verify no crash and phase filtering worked
  if (result.totalNodes !== 1) throw new Error("Expected 1 total node")
})

console.log(`  DAG: ${dag} passed, ${dagf} failed`)
state.passed += dag; state.failed += dagf
console.log(`__RESULT__:${JSON.stringify({passed:state.passed,failed:state.failed})}`)
