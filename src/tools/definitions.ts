/**
 * Tool registry barrel — builds all agentic_* tools from ToolContext.
 * Individual tool implementations live in sibling modules (makeXTool).
 */
import { tool } from "@opencode-ai/plugin"
import type { ToolContext } from "./tool-context.js"
import {
  setSchemaValidator,
  setConsolidationScheduler,
  setDslExecutor,
  setSchemaVersion,
  setBlueprintParser,
  setBlueprintResolver,
} from "../core/shared-instances.js"
import { makeStatusTool } from "./status.js"
import { makeCleanTool } from "./clean.js"
import { makeSnapshotTool } from "./snapshot.js"
import { makeBudgetTool } from "./budget.js"
import { makeExecuteTool } from "./execute.js"
import { makeAutoTool } from "./auto.js"
import { makeEvolveTool } from "./evolve.js"
import { makeRagTool } from "./rag.js"
import { makeDelegateTool } from "./delegate.js"
import { makeModelTool } from "./model.js"
import { makeFinetuneTool } from "./finetune.js"
import { makePlanTool } from "./plan.js"
import { makeNavTool } from "./nav.js"
import { makeReflectTool } from "./reflect.js"
import { makeVerifyTool } from "./verify.js"
import { makeContextTool } from "./context.js"
import { makePipelineTool } from "./pipeline.js"
import { makePrTool } from "./pullRequest.js"
import { makeScoreTool } from "./score.js"
import { makeMessageTool } from "./message.js"
import { makeSkillTool } from "./skill.js"
import { makeEpisodesTool } from "./episodes.js"
import { makeParallelTool } from "./parallel.js"
import { makeGuardTool } from "./guard.js"
import { makeDebateTool } from "./debate.js"
import { makeRouterTool } from "./router.js"
import { makeMcpTool } from "./mcp.js"
import { makeA2aTool } from "./a2a.js"
import { makeToolsTool } from "./tools.js"
import { makeDbTool } from "./db.js"
import { makeMemoTool } from "./memo.js"
import { makeFetchTool } from "./fetch.js"
import { MemorySchemaVersion } from "../memory/schema-version.js"
import { BlueprintParser, BlueprintResolver } from "../core/agent-blueprint.js"
import { SchemaValidator } from "../core/skill-schema.js"
import { ConsolidationScheduler } from "../memory/consolidation-scheduler.js"
import { DslExecutor } from "../core/dsl-executor.js"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildAllTools(ctx: ToolContext): Record<string, any> {
  const {
    log,
    llmEngine,
    modelRegistry,
    dynamicToolRegistry,
    logErrorToFile,
  } = ctx

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const schemaValidator = new (SchemaValidator as any)()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const consolidationScheduler = new (ConsolidationScheduler as any)()
  setSchemaValidator(schemaValidator)
  setConsolidationScheduler(consolidationScheduler)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const registryTool = (name: string, def: any, registryMeta?: { version?: string; category?: string; keywords?: string[] }) => {
    const wrappedExecute = async (args: Record<string, unknown>, context: Record<string, unknown>) => {
      if (!context?.sessionID) {
        return { output: '❌ **' + name + '** requires an active session.', metadata: { error: "no-session", tool: name } }
      }
      try {
        llmEngine.setSessionId(context.sessionID as string)
        llmEngine.setToolContext(name)
        return await (def.execute as (...args: unknown[]) => unknown)(args, context)
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err)
        const errStack = err instanceof Error ? err.stack : ""
        log.error('[Agentic] ❌ Tool "' + name + '" execution failed: ' + errMsg)
        logErrorToFile(name, errMsg, errStack)
        return { output: '❌ **' + name + '** execution failed: ' + errMsg, metadata: { error: errMsg, tool: name } }
      }
    }
    try {
      const zodObj = tool.schema.object(def.args as Record<string, unknown>)
      const jsonSchema = tool.schema.toJSONSchema(zodObj, { target: "draft-7", unrepresentable: "any" })
      dynamicToolRegistry.registerFromTool(name, def.description, jsonSchema as Record<string, unknown>, wrappedExecute as (...args: unknown[]) => Promise<unknown>, registryMeta)
    } catch (e) {
      log.error('[Agentic] ❌ Tool registration FAILED for "' + name + '": ' + (e instanceof Error ? e.message : String(e)))
    }
    return tool({ description: def.description, args: def.args, execute: wrappedExecute as (args: Record<string, unknown>, context: Record<string, unknown>) => Promise<{ output: string }> })
  }

  const dslExecutor = new DslExecutor()
  const schemaVersion = new MemorySchemaVersion()
  const blueprintParser = new BlueprintParser()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const blueprintResolver = new (BlueprintResolver as any)(modelRegistry, new Map())
  setDslExecutor(dslExecutor)
  setSchemaVersion(schemaVersion)
  setBlueprintParser(blueprintParser)
  setBlueprintResolver(blueprintResolver)

  return {
    agentic_plan: registryTool("agentic_plan", makePlanTool(ctx)),
    agentic_nav: registryTool("agentic_nav", makeNavTool(ctx)),
    agentic_execute: registryTool("agentic_execute", makeExecuteTool(ctx)),
    agentic_reflect: registryTool("agentic_reflect", makeReflectTool(ctx)),
    agentic_verify: registryTool("agentic_verify", makeVerifyTool(ctx)),
    agentic_status: registryTool("agentic_status", makeStatusTool(ctx)),
    agentic_context: registryTool("agentic_context", makeContextTool(ctx)),
    agentic_snapshot: registryTool("agentic_snapshot", makeSnapshotTool(ctx)),
    agentic_pipeline: registryTool("agentic_pipeline", makePipelineTool(ctx)),
    agentic_pr: registryTool("agentic_pr", makePrTool(ctx)),
    agentic_score: registryTool("agentic_score", makeScoreTool(ctx)),
    agentic_delegate: registryTool("agentic_delegate", makeDelegateTool(ctx)),
    agentic_message: registryTool("agentic_message", makeMessageTool(ctx)),
    agentic_skill: registryTool("agentic_skill", makeSkillTool(ctx)),
    agentic_model: registryTool("agentic_model", makeModelTool(ctx)),
    agentic_budget: registryTool("agentic_budget", makeBudgetTool(ctx)),
    agentic_episodes: registryTool("agentic_episodes", makeEpisodesTool(ctx)),
    agentic_parallel: registryTool("agentic_parallel", makeParallelTool(ctx)),
    agentic_guard: registryTool("agentic_guard", makeGuardTool(ctx)),
    agentic_evolve: registryTool("agentic_evolve", makeEvolveTool(ctx)),
    agentic_debate: registryTool("agentic_debate", makeDebateTool(ctx)),
    agentic_router: registryTool("agentic_router", makeRouterTool(ctx)),
    agentic_clean: registryTool("agentic_clean", makeCleanTool(ctx)),
    agentic_rag: registryTool("agentic_rag", makeRagTool(ctx)),
    agentic_mcp: registryTool("agentic_mcp", makeMcpTool(ctx)),
    agentic_a2a: registryTool("agentic_a2a", makeA2aTool(ctx)),
    agentic_tools: registryTool("agentic_tools", makeToolsTool(ctx)),
    agentic_finetune: registryTool("agentic_finetune", makeFinetuneTool(ctx)),
    agentic_db: registryTool("agentic_db", makeDbTool(ctx)),
    agentic_auto: registryTool("agentic_auto", makeAutoTool(ctx)),
    agentic_memo: registryTool("agentic_memo", makeMemoTool(ctx)),
    agentic_fetch: registryTool("agentic_fetch", makeFetchTool(ctx)),
  }
}

export default buildAllTools
