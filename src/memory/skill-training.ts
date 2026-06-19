import { writeFileSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"
import type { SkillRecord } from "./skill-store.js"
import type { Episode } from "./episodic-store.js"

export interface TrainingExample {
  instruction: string
  response: string
  skillName: string
  quality: number
}

export interface TrainingDataset {
  format: "openai" | "instructions"
  totalExamples: number
  qualityFilter: number
  data: string
}

/**
 * Convert a single skill into a training example.
 * instruction = trigger pattern + name → what the agent should do
 * response   = structured workflow steps → how the agent should do it
 */
export function skillToTrainingExample(skill: SkillRecord): TrainingExample {
  const def = skill.definition
  const stepsText = def.workflow.steps
    .map(s => `${s.order}. ${s.action}: ${s.description}${s.tool ? ` (tool: ${s.tool})` : ""}`)
    .join("\n")

  const response = [
    `## Workflow: ${def.meta.name}`,
    stepsText,
    def.workflow.steps.length > 0 ? `\nEstimated duration: ${def.workflow.estimatedDuration}` : "",
    def.quality.failureScenarios.length > 0
      ? `\nCommon failure scenarios:\n${def.quality.failureScenarios.map(f => `- ${f}`).join("\n")}`
      : "",
    def.workflow.steps.some(s => s.rollback)
      ? `\nRollback strategies:\n${def.workflow.steps.filter(s => s.rollback).map(s => `- ${s.action}: ${s.rollback}`).join("\n")}`
      : "",
  ].filter(Boolean).join("\n")

  const instruction = def.trigger.pattern || def.meta.name

  return {
    instruction,
    response,
    skillName: def.meta.name,
    quality: skill.successRate,
  }
}

/**
 * Export skills as OpenAI fine-tuning JSONL format.
 * Each line: {"messages": [{"role": "system", "content": "..."}, {"role": "user", "content": "..."}, {"role": "assistant", "content": "..."}]}
 */
export function exportOpenAIJSONL(examples: TrainingExample[]): string {
  return examples.map(ex => {
    const entry = {
      messages: [
        { role: "system", content: "You are a senior software engineer implementing features following reusable patterns." },
        { role: "user", content: ex.instruction },
        { role: "assistant", content: ex.response },
      ],
    }
    return JSON.stringify(entry)
  }).join("\n")
}

/**
 * Export skills as simple instruction-response JSON array.
 */
export function exportInstructionsJSON(examples: TrainingExample[]): string {
  return JSON.stringify(examples.map(ex => ({
    instruction: ex.instruction,
    output: ex.response,
    source: ex.skillName,
    quality: ex.quality,
  })), null, 2)
}

/**
 * Generate a summary of the training dataset quality.
 */
export function trainingDatasetSummary(examples: TrainingExample[]): string {
  if (examples.length === 0) return "No training examples generated."

  const avgQuality = examples.reduce((s, e) => s + e.quality, 0) / examples.length
  const highQuality = examples.filter(e => e.quality >= 0.8).length
  const mediumQuality = examples.filter(e => e.quality >= 0.5 && e.quality < 0.8).length
  const lowQuality = examples.filter(e => e.quality < 0.5).length

  let out = `## 📊 Training Dataset Summary\n\n`
  out += `**Total examples:** ${examples.length}\n`
  out += `**Average quality score:** ${(avgQuality * 100).toFixed(0)}%\n`
  out += `**Quality distribution:**\n`
  out += `- High (≥80%): ${highQuality}\n`
  out += `- Medium (50-79%): ${mediumQuality}\n`
  out += `- Low (<50%): ${lowQuality}\n\n`
  out += `### Examples\n`
  for (const ex of examples.slice(0, 5)) {
    out += `- **${ex.skillName}** (quality: ${(ex.quality * 100).toFixed(0)}%)\n`
    out += `  Instruction: ${ex.instruction.slice(0, 100)}${ex.instruction.length > 100 ? "…" : ""}\n`
  }
  if (examples.length > 5) {
    out += `  … and ${examples.length - 5} more\n`
  }
  return out
}

/**
 * Convert a single episode into a training example.
 * instruction = plan goal → what the agent was asked to do
 * response   = decisions + outcome → how the agent reasoned and what happened
 */
export function episodeToTrainingExample(episode: Episode): TrainingExample {
  const decisionsText = episode.decisions.length > 0
    ? episode.decisions.map((d, i) => `${i + 1}. ${d}`).join("\n")
    : "No decision trace available."

  const response = [
    `## Task: ${episode.planGoal}`,
    `**Outcome:** ${episode.outcome}`,
    episode.filesChanged && episode.filesChanged.length > 0
      ? `**Files changed:** ${episode.filesChanged.join(", ")}`
      : "",
    `\n**Decision trace:**`,
    decisionsText,
  ].filter(Boolean).join("\n")

  const quality = episode.outcome === "success" ? 1.0
    : episode.outcome === "partial" ? 0.5
    : 0.0

  return {
    instruction: episode.planGoal,
    response,
    skillName: `episode:${episode.id}`,
    quality,
  }
}

/**
 * Convert all episodes to training examples, filtered by minimum quality.
 */
export function episodesToTrainingData(
  episodes: Episode[],
  format: "openai" | "instructions" = "openai",
  minQuality = 0.0,
): TrainingDataset {
  const examples = episodes
    .filter(e => {
      const q = e.outcome === "success" ? 1.0 : e.outcome === "partial" ? 0.5 : 0.0
      return q >= minQuality
    })
    .map(e => episodeToTrainingExample(e))

  const data = format === "openai"
    ? exportOpenAIJSONL(examples)
    : exportInstructionsJSON(examples)

  return {
    format,
    totalExamples: examples.length,
    qualityFilter: minQuality,
    data,
  }
}

/**
 * Prepare a combined fine-tuning dataset from both skills and episodes.
 */
export function prepareFineTuningDataset(
  skills: SkillRecord[],
  episodes: Episode[],
  format: "openai" | "instructions" = "openai",
  minSkillSuccessRate = 0.5,
  minEpisodeQuality = 0.0,
): TrainingDataset {
  const skillExamples = skills
    .filter(s => s.successRate >= minSkillSuccessRate)
    .map(s => skillToTrainingExample(s))

  const episodeExamples = episodes
    .filter(e => {
      const q = e.outcome === "success" ? 1.0 : e.outcome === "partial" ? 0.5 : 0.0
      return q >= minEpisodeQuality
    })
    .map(e => episodeToTrainingExample(e))

  const allExamples = [...skillExamples, ...episodeExamples]

  const data = format === "openai"
    ? exportOpenAIJSONL(allExamples)
    : exportInstructionsJSON(allExamples)

  return {
    format,
    totalExamples: allExamples.length,
    qualityFilter: Math.min(minSkillSuccessRate, minEpisodeQuality),
    data,
  }
}

/**
 * Save training data to a JSONL file on disk.
 * Returns the file path.
 */
export function saveTrainingDataToFile(
  dataset: TrainingDataset,
  outputPath: string,
): string {
  // Ensure parent directory exists
  const dir = dirname(outputPath)
  try { mkdirSync(dir, { recursive: true }) } catch {}

  const content = dataset.format === "openai" || dataset.format === "instructions"
    ? dataset.data + "\n"
    : dataset.data

  writeFileSync(outputPath, content, "utf-8")
  return outputPath
}

/**
 * Convert all skills to training examples, filtered by minimum success rate.
 */
export function skillsToTrainingData(
  skills: SkillRecord[],
  format: "openai" | "instructions" = "openai",
  minSuccessRate = 0.5,
): TrainingDataset {
  const examples = skills
    .filter(s => s.successRate >= minSuccessRate)
    .map(s => skillToTrainingExample(s))

  const data = format === "openai"
    ? exportOpenAIJSONL(examples)
    : exportInstructionsJSON(examples)

  return {
    format,
    totalExamples: examples.length,
    qualityFilter: minSuccessRate,
    data,
  }
}
