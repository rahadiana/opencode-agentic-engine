// _b_dag.mjs — Part B: DAG Engine tests (sync: DAG-1..DAG-10b)
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

console.log(`  DAG: ${dag} passed, ${dagf} failed`)
state.passed += dag; state.failed += dagf
console.log(`__RESULT__:${JSON.stringify({passed:state.passed,failed:state.failed})}`)
