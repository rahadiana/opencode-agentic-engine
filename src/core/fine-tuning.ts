import { readFile } from "node:fs/promises"
import { ValidationError, LLMError } from "./errors.js"

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export interface FineTuningConfig {
  apiKey?: string
  baseURL?: string
  model?: string // base model to fine-tune, e.g. "gpt-4o-mini-2024-07-18"
  trainingEpochs?: number
  batchSize?: number
  learningRateMultiplier?: number
  suffix?: string // custom model name suffix
}

export interface FineTuningJob {
  id: string
  model: string
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled"
  trainingFile: string
  trainedModel?: string
  createdAt: string
  finishedAt?: string
  error?: string
  epochs?: number
}

export interface FineTuningFile {
  id: string
  filename: string
  bytes: number
  purpose: string
  status: string
  createdAt: string
}

// ──────────────────────────────────────────────
// Client
// ──────────────────────────────────────────────

export class FineTuningClient {
  private apiKey: string
  private baseURL: string
  private defaultModel: string

  constructor(config: FineTuningConfig) {
    this.apiKey = config.apiKey ?? process.env.OPENAI_API_KEY ?? ""
    this.baseURL = (config.baseURL ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com").replace(/\/+$/, "")
    this.defaultModel = config.model ?? "gpt-4o-mini-2024-07-18"
  }

  /**
   * Check if the client has an API key configured.
   */
  isConfigured(): boolean {
    return !!this.apiKey
  }

  /**
   * Upload a training file to OpenAI.
   * filePath: path to .jsonl file
   */
  async uploadFile(filePath: string): Promise<FineTuningFile> {
    if (!this.apiKey) throw new ValidationError("OpenAI API key not configured for fine-tuning")

    const content = await readFile(filePath, "utf-8")

    const formData = new FormData()
    const blob = new Blob([content], { type: "application/jsonl" })
    formData.append("file", blob, "training.jsonl")
    formData.append("purpose", "fine-tune")

    const resp = await this.fetchWithRetry(`${this.baseURL}/v1/files`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: formData,
    })

    const data = await resp.json() as Record<string, unknown>
    return {
      id: data.id as string,
      filename: data.filename as string,
      bytes: data.bytes as number,
      purpose: data.purpose as string,
      status: data.status as string,
      createdAt: data.created_at as string,
    }
  }

  /**
   * Create a fine-tuning job.
   */
  async createJob(
    trainingFileId: string,
    options?: Partial<FineTuningConfig>,
  ): Promise<FineTuningJob> {
    if (!this.apiKey) throw new ValidationError("OpenAI API key not configured for fine-tuning")

    const hyperparams: Record<string, unknown> = {}
    if (options?.trainingEpochs) hyperparams.n_epochs = options.trainingEpochs
    if (options?.batchSize) hyperparams.batch_size = options.batchSize
    if (options?.learningRateMultiplier) hyperparams.learning_rate_multiplier = options.learningRateMultiplier

    const body: Record<string, unknown> = {
      training_file: trainingFileId,
      model: options?.model ?? this.defaultModel,
    }
    if (options?.suffix) body.suffix = options.suffix
    if (Object.keys(hyperparams).length > 0) body.hyperparameters = hyperparams

    const resp = await this.fetchWithRetry(`${this.baseURL}/v1/fine_tuning/jobs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    })

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "unknown error")
      throw new LLMError(`Create job failed (${resp.status}): ${errText}`)
    }

    const data = await resp.json() as Record<string, unknown>
    return this.parseJobResponse(data)
  }

  /**
   * Get fine-tuning job status.
   */
  async getJobStatus(jobId: string): Promise<FineTuningJob> {
    if (!this.apiKey) throw new ValidationError("OpenAI API key not configured for fine-tuning")

    const resp = await this.fetchWithRetry(`${this.baseURL}/v1/fine_tuning/jobs/${jobId}`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    })

    const data = await resp.json() as Record<string, unknown>
    return this.parseJobResponse(data)
  }

  async listJobs(limit = 20): Promise<FineTuningJob[]> {
    if (!this.apiKey) throw new ValidationError("OpenAI API key not configured for fine-tuning")

    const resp = await this.fetchWithRetry(`${this.baseURL}/v1/fine_tuning/jobs?limit=${limit}`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    })

    const data = await resp.json() as { data?: Array<Record<string, unknown>> }
    return (data.data ?? []).map((j: Record<string, unknown>) => this.parseJobResponse(j))
  }

  async cancelJob(jobId: string): Promise<FineTuningJob> {
    if (!this.apiKey) throw new ValidationError("OpenAI API key not configured for fine-tuning")

    const resp = await this.fetchWithRetry(`${this.baseURL}/v1/fine_tuning/jobs/${jobId}/cancel`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}` },
    })

    const data = await resp.json() as Record<string, unknown>
    return this.parseJobResponse(data)
  }

  /**
   * Wait for a fine-tuning job to complete (polling).
   */
  async waitForJob(
    jobId: string,
    pollIntervalMs = 10000,
    timeoutMs = 3600000,
  ): Promise<FineTuningJob> {
    const startTime = Date.now()
    let attempt = 0
    while (true) {
      if (Date.now() - startTime > timeoutMs) {
        throw new LLMError(`Timed out waiting for job ${jobId} after ${timeoutMs}ms`)
      }

      const statusPromise = this.getJobStatus(jobId)
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 30_000)
      const job = await Promise.race([
        statusPromise,
        new Promise<never>((_, reject) => {
          controller.signal.addEventListener("abort", () => {
            reject(new Error(`getJobStatus timed out for job ${jobId}`))
          })
        }),
      ])
      clearTimeout(timeoutId)

      if (job.status === "succeeded" || job.status === "failed" || job.status === "cancelled") {
        return job
      }

      attempt++
      const interval = Math.min(pollIntervalMs * Math.pow(1.5, attempt), 60000)
      await new Promise(r => setTimeout(r, interval))
    }
  }

  private async fetchWithRetry(url: string, options: RequestInit, retries = 3): Promise<Response> {
    for (let i = 0; i < retries; i++) {
      try {
        const resp = await fetch(url, options)
        if (!resp.ok) {
          const errText = await resp.text().catch(() => "unknown error")
          if (i < retries - 1 && resp.status >= 429) {
            await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i)))
            continue
          }
          throw new LLMError(`Request failed (${resp.status}): ${errText}`)
        }
        return resp
      } catch (e) {
        if (i === retries - 1) throw e
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i)))
      }
    }
    throw new LLMError("Request failed after retries")
  }

  /**
   * Full pipeline: prepare file → upload → create job → wait → return result.
   */
  async fullPipeline(
    filePath: string,
    options?: Partial<FineTuningConfig>,
  ): Promise<{ file: FineTuningFile; job: FineTuningJob; result: FineTuningJob }> {
    const file = await this.uploadFile(filePath)
    const job = await this.createJob(file.id, options)
    const result = await this.waitForJob(job.id)
    return { file, job, result }
  }

  /**
   * Parse OpenAI API response into a FineTuningJob.
   */
  private parseJobResponse(data: Record<string, unknown>): FineTuningJob {
    return {
      id: data.id as string,
      model: data.model as string,
      status: (data.status ?? "queued") as FineTuningJob["status"],
      trainingFile: data.training_file as string,
      trainedModel: data.fine_tuned_model as string | undefined,
      createdAt: data.created_at as string,
      finishedAt: data.finished_at as string | undefined,
      error: data.error && typeof data.error === "object" ? (data.error as Record<string, unknown>)?.message as string | undefined : undefined,
      epochs: (data.hyperparameters as { n_epochs?: number })?.n_epochs,
    }
  }
}
