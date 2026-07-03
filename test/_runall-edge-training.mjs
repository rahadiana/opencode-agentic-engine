// test/_runall-edge-training.mjs — Part A: Edge case tests (Skill→Training Data thru FineTuning)
import { assert, section, mockCtx, freshSid, pluginDist, G, R, B, D, Y, RST, existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, chmodSync, mkdtempSync, join, tmpdir, sdkMockClient, state, projectDir } from "./_common.mjs"

export async function runEdgeTrainingTests(mod) {
const mockInput = {
  client: {},
  project: { name: "test", path: projectDir },
  directory: projectDir,
  directoryName: "test",
  isProject: true,
  isTask: false,
  isEphemeral: true,
  getConfig: async () => ({
    experimental: { chat: { system: { transform: { tools: [] } } } },
  }),
  cwd: projectDir,
  on: () => {},
  run: async () => ({ exitCode: 0 }),
  exec: async () => ({ exitCode: 0, text: () => "", stdout: "" }),
}
let hooks
try { hooks = await mod.AgenticEngine(mockInput); assert(true, "AgenticEngine() executed") }
catch (e) { assert(false, `AgenticEngine() threw: ${e.message}`) }
assert(hooks && typeof hooks === "object", "hooks is an object")
assert(typeof hooks.dispose === "function", "dispose hook registered")
// 83. Skill → Training Data conversion
console.log("\n[83] Skill → Training Data conversion")
const { skillToTrainingExample, skillsToTrainingData, exportOpenAIJSONL, exportInstructionsJSON, trainingDatasetSummary } = mod

// Create a mock skill record
const mockSkillRecord = {
  definition: {
    meta: { format: "agentic-skill/v1", id: "test-skill-1", name: "Add Unit Test", version: 1, author: "agent" },
    trigger: { pattern: "Add unit tests for new function", keywords: ["test", "unit", "jest"], context: [] },
    workflow: {
      steps: [
        { order: 1, action: "create", description: "Create test file next to source", tool: "write", expectedOutput: "test file created", rollback: "Delete test file" },
        { order: 2, action: "verify", description: "Run jest on test file", tool: "bash", expectedOutput: "all tests pass", rollback: undefined },
      ],
      estimatedDuration: "4m",
      parallelizable: false,
    },
    quality: { successRate: 0.9, usageCount: 10, failureScenarios: ["Timeout on large dataset"] },
    audit: { createdAt: "2024-01-01", lastUsed: "2024-06-01", lastModified: "2024-06-01", modifiedBy: "agent" },
  },
  usageCount: 10,
  successRate: 0.9,
  lastUsed: "2024-06-01",
}

const example = skillToTrainingExample(mockSkillRecord)
assert(typeof example.instruction === "string" && example.instruction.length > 0, "training example has instruction")
assert(typeof example.response === "string" && example.response.length > 0, "training example has response")
assert(example.skillName === "Add Unit Test", "training example has skillName")
assert(example.quality === 0.9, "training example has quality score")
assert(example.response.includes("Add Unit Test"), "response contains skill name")
assert(example.response.includes("Create test file"), "response contains step descriptions")
assert(example.response.includes("Rollback"), "response includes rollback strategies")

// OpenAI format
const openaiData = exportOpenAIJSONL([example])
const openaiLines = openaiData.trim().split("\n")
assert(openaiLines.length === 1, "OpenAI format produces 1 line per example")
const openaiParsed = JSON.parse(openaiLines[0])
assert(openaiParsed.messages.length === 3, "OpenAI format has 3 messages")
assert(openaiParsed.messages[0].role === "system", "OpenAI format starts with system")
assert(openaiParsed.messages[1].role === "user", "OpenAI format has user message")
assert(openaiParsed.messages[2].role === "assistant", "OpenAI format has assistant message")

// Instructions JSON format
const jsonData = exportInstructionsJSON([example])
const jsonParsed = JSON.parse(jsonData)
assert(Array.isArray(jsonParsed), "instructions format is an array")
assert(jsonParsed.length === 1, "instructions format has 1 entry")
assert(jsonParsed[0].instruction === example.instruction, "instructions format preserves instruction")
assert(jsonParsed[0].output === example.response, "instructions format preserves response")
assert(jsonParsed[0].source === "Add Unit Test", "instructions format preserves source")

// skillsToTrainingData with filter
const dataset1 = skillsToTrainingData([mockSkillRecord], "openai", 0.5)
assert(dataset1.format === "openai", "format preserved")
assert(dataset1.totalExamples === 1, "skill included when success rate >= minSuccessRate")
assert(dataset1.data.length > 0, "training data has content")

const dataset2 = skillsToTrainingData([mockSkillRecord], "openai", 0.95)
assert(dataset2.totalExamples === 0, "skill excluded when success rate < minSuccessRate")

const lowQualitySkill = { ...mockSkillRecord, successRate: 0.3 }
const dataset3 = skillsToTrainingData([lowQualitySkill], "instructions", 0.4)
assert(dataset3.totalExamples === 0, "low quality skill excluded")

// Empty skills
const dataset4 = skillsToTrainingData([], "openai", 0.5)
assert(dataset4.totalExamples === 0, "empty skills produces 0 examples")
assert(dataset4.data.length === 0, "empty skills produces empty data")

// trainingDatasetSummary
const summary = trainingDatasetSummary([example, { ...example, skillName: "Refactor Module", quality: 0.7 }])
assert(summary.includes("Summary") || summary.includes("Total examples"), "summary shows total")
assert(summary.includes("2"), "summary counts correctly")
assert(summary.includes("Add Unit Test"), "summary lists skill names")

const emptySummary = trainingDatasetSummary([])
assert(emptySummary.includes("No training examples"), "empty summary handled")

assert(true, "Skill Training Data conversion tests passed")

// 84. agentic_evolve — export-training-data action
console.log("\n[84] agentic_evolve — export-training-data")
const trCtx = mockCtx(freshSid())
const trR = await hooks.tool.agentic_evolve.execute({ action: "export-training-data" }, trCtx)
const trOut = typeof trR === "string" ? trR : (trR.output || "")
assert(trOut.includes("Training Data") || trOut.includes("training"), "export-training-data produces output")
assert(trOut.includes("Total examples") || trOut.includes("total") || trOut.includes("No training"), "export-training-data shows count or empty message")
assert(trOut.includes("openai") || trOut.includes("OpenAI"), "export-training-data shows format")

// Specific format
const trR2 = await hooks.tool.agentic_evolve.execute({ action: "export-training-data", format: "instructions" }, trCtx)
const trOut2 = typeof trR2 === "string" ? trR2 : (trR2.output || "")
assert(trOut2.includes("instructions") || trOut2.includes("instruction"), "export-training-data with instructions format works")

// With minSuccessRate filter
const trR3 = await hooks.tool.agentic_evolve.execute({ action: "export-training-data", minSuccessRate: 0.9 }, trCtx)
const trOut3 = typeof trR3 === "string" ? trR3 : (trR3.output || "")
assert(typeof trOut3 === "string" && trOut3.length > 0, "export-training-data with minSuccessRate works")

assert(true, "agentic_evolve export-training-data tests passed")

// 84-B. Episode → Training Data conversion
console.log("\n[84-B] Episode → Training Data conversion")
const { episodeToTrainingExample: ep2tr, episodesToTrainingData: eps2tr, prepareFineTuningDataset: prepFT, saveTrainingDataToFile: saveFT } = mod

// Mock episode
const mockEpisode = {
  id: "ep-test-1",
  sessionId: "sess-1",
  planGoal: "Add authentication middleware",
  summary: "Completed: Add authentication middleware",
  outcome: "success",
  decisions: ["Used JWT library", "Created middleware function", "Added token validation"],
  filesChanged: ["src/auth.ts", "src/middleware.ts"],
  domain: "security",
  timestamp: "2026-06-01T00:00:00Z",
  tags: ["auth", "jwt", "middleware"],
}

const epExample = ep2tr(mockEpisode)
assert(typeof epExample.instruction === "string" && epExample.instruction.length > 0, "episode example has instruction")
assert(typeof epExample.response === "string" && epExample.response.length > 0, "episode example has response")
assert(epExample.instruction.includes("authentication"), "episode instruction from planGoal")
assert(epExample.response.includes("JWT"), "episode response contains decisions")
assert(epExample.quality === 1.0, "successful episode has quality 1.0")

// Failed episode
const failedEpisode = { ...mockEpisode, outcome: "failed", decisions: [] }
const failEx = ep2tr(failedEpisode)
assert(failEx.quality === 0.0, "failed episode has quality 0.0")
assert(failEx.response.includes("No decision trace"), "handles empty decisions gracefully")

// episodesToTrainingData
const epDataset = eps2tr([mockEpisode, failedEpisode], "openai", 0.5)
assert(epDataset.format === "openai", "episodes format preserved")
assert(epDataset.totalExamples === 1, "only successful episode passes minQuality=0.5")

const epAll = eps2tr([mockEpisode, failedEpisode], "instructions", 0.0)
assert(epAll.totalExamples === 2, "minQuality=0.0 includes all episodes")

// prepareFineTuningDataset — combined
const mockSkill = {
  definition: {
    meta: { format: "agentic-skill/v1", id: "test-skill", name: "Test Skill" },
    trigger: { pattern: "test something", keywords: ["test"] },
    workflow: { steps: [{ order: 1, action: "run", description: "Run tests" }], estimatedDuration: "1m", parallelizable: false },
    quality: { successRate: 0.8, usageCount: 1, failureScenarios: [] },
    audit: { createdAt: "2024-01-01", lastUsed: "2024-06-01", lastModified: "2024-06-01", modifiedBy: "agent" },
  },
  usageCount: 1, successRate: 0.8, lastUsed: "2024-06-01",
}
const combined = prepFT([mockSkill], [mockEpisode], "openai", 0.5, 0.0)
assert(combined.totalExamples === 2, "combined dataset includes skill + episode")
assert(combined.format === "openai", "combined format preserved")

// saveTrainingDataToFile
const testDataDir = join(projectDir, "tmp-ft-test")
try { mkdirSync(testDataDir, { recursive: true }) } catch {}
const testFilePath = join(testDataDir, "test-training.jsonl")
const saved = saveFT(combined, testFilePath)
assert(saved === testFilePath, "save returns correct file path")
assert(existsSync(testFilePath), "file was created")
const savedContent = readFileSync(testFilePath, "utf-8").trim()
assert(savedContent.length > 0, "saved file has content")
const ftLines = savedContent.split("\n")
assert(ftLines.length === 2, "saved file has 2 lines (one per example)")
// Cleanup
try { unlinkSync(testFilePath) } catch {}
try { rmSync(testDataDir, { recursive: true, force: true }) } catch {}

assert(true, "Episode → Training Data conversion tests passed")

// 84-C. FineTuningClient — unit tests (mock fetch)
console.log("\n[84-C] FineTuningClient — unit tests")
const { FineTuningClient: FTC } = mod

const unconfiguredClient = new FTC({})
assert(!unconfiguredClient.isConfigured(), "client without key is not configured")

let threw = false
try { await unconfiguredClient.uploadFile("test.jsonl") } catch (e) { threw = true; assert(e.message.includes("API key"), "uploadFile throws about API key") }
assert(threw, "uploadFile throws without API key")

threw = false
try { await unconfiguredClient.createJob("file-123") } catch (e) { threw = true; assert(e.message.includes("API key"), "createJob throws about API key") }
assert(threw, "createJob throws without API key")

threw = false
try { await unconfiguredClient.getJobStatus("job-123") } catch (e) { threw = true; assert(e.message.includes("API key"), "getJobStatus throws about API key") }
assert(threw, "getJobStatus throws without API key")

threw = false
try { await unconfiguredClient.listJobs() } catch (e) { threw = true; assert(e.message.includes("API key"), "listJobs throws about API key") }
assert(threw, "listJobs throws without API key")

threw = false
try { await unconfiguredClient.cancelJob("job-123") } catch (e) { threw = true; assert(e.message.includes("API key"), "cancelJob throws about API key") }
assert(threw, "cancelJob throws without API key")

assert(true, "FineTuningClient unit tests passed")

// 84-D. agentic_finetune tool
console.log("\n[84-D] agentic_finetune tool")
const ftCtx = mockCtx(freshSid())
const ftPrepare = await hooks.tool.agentic_finetune.execute({ action: "prepare", source: "skills" }, ftCtx)
const ftPrepareOut = typeof ftPrepare === "string" ? ftPrepare : (ftPrepare.output || "")
assert(typeof ftPrepareOut === "string" && ftPrepareOut.length > 0, "finetune prepare returns output")
assert(ftPrepareOut.includes("Fine-Tuning") || ftPrepareOut.includes("Dataset"), "finetune prepare shows dataset info")

const ftSaveNoPath = await hooks.tool.agentic_finetune.execute({ action: "save" }, ftCtx)
const ftSaveNoPathOut = typeof ftSaveNoPath === "string" ? ftSaveNoPath : (ftSaveNoPath.output || "")
assert(ftSaveNoPathOut.includes("outputPath") || ftSaveNoPathOut.includes("required"), "finetune save without path shows error")

const ftList = await hooks.tool.agentic_finetune.execute({ action: "list" }, ftCtx)
const ftListOut = typeof ftList === "string" ? ftList : (ftList.output || "")
assert(ftListOut.includes("API key") || ftListOut.includes("not configured"), "finetune list without key shows error")

const ftStatusNoId = await hooks.tool.agentic_finetune.execute({ action: "status" }, ftCtx)
const ftStatusNoIdOut = typeof ftStatusNoId === "string" ? ftStatusNoId : (ftStatusNoId.output || "")
assert(ftStatusNoIdOut.includes("jobId") || ftStatusNoIdOut.includes("required"), "finetune status without jobId shows error")

const ftUnknown = await hooks.tool.agentic_finetune.execute({ action: "unknown" }, ftCtx)
const ftUnknownOut = typeof ftUnknown === "string" ? ftUnknown : (ftUnknown.output || "")
assert(ftUnknownOut.includes("Unknown"), "finetune unknown action shows error")

assert(true, "agentic_finetune tool tests passed")

}
// ── Standalone execution ──
const _isMain = typeof process !== "undefined" && process.argv[1] && (process.argv[1] === import.meta.url || process.argv[1].endsWith("/_runall-edge-training.mjs"))
if (_isMain) {
  const { pluginDist: _pd } = await import("./_common.mjs")
  const _mod = await import(_pd)
  await runEdgeTrainingTests(_mod)
  const { state } = await import("./_state.mjs")
  console.log(`__RESULT__:${JSON.stringify({ passed: state.passed, failed: state.failed })}`)
  process.exit(state.failed > 0 ? 1 : 0)
}
