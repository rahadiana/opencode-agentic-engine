import { readFileSync } from "node:fs"

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
    if (!this.apiKey) throw new Error("OpenAI API key not configured for fine-tuning")

    const content = readFileSync(filePath, "utf-8")

    // Use multipart/form-data via fetch + FormData
    const formData = new FormData()
    const blob = new Blob([content], { type: "application/jsonl" })
    formData.append("file", blob, "training.jsonl")
    formData.append("purpose", "fine-tune")

    const resp = await fetch(`${this.baseURL}/v1/files`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: formData,
    })

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "unknown error")
      throw new Error(`File upload failed (${resp.status}): ${errText}`)
    }

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
    if (!this.apiKey) throw new Error("OpenAI API key not configured for fine-tuning")

    const body: Record<string, unknown> = {
      training_file: trainingFileId,
      model: options?.model ?? this.defaultModel,
    }

    if (options?.suffix) body.suffix = options.suffix
    if (options?.trainingEpochs) body.hyperparameters = { n_epochs: options.trainingEpochs }
    if (options?.batchSize) body.hyperparameters = { ...body.hyperparameters as Record<string, unknown>, batch_size: options.batchSize }
    if (options?.learningRateMultiplier) body.hyperparameters = { ...body.hyperparameters as Record<string, unknown>, learning_rate_multiplier: options.learningRateMultiplier }

    const resp = await fetch(`${this.baseURL}/v1/fine_tuning/jobs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    })

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "unknown error")
      throw new Error(`Create job failed (${resp.status}): ${errText}`)
    }

    const data = await resp.json() as Record<string, unknown>
    return this.parseJobResponse(data)
  }

  /**
   * Get fine-tuning job status.
   */
  async getJobStatus(jobId: string): Promise<FineTuningJob> {
    if (!this.apiKey) throw new Error("OpenAI API key not configured for fine-tuning")

    const resp = await fetch(`${this.baseURL}/v1/fine_tuning/jobs/${jobId}`, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    })

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "unknown error")
      throw new Error(`Get job status failed (${resp.status}): ${errText}`)
    }

    const data = await resp.json() as Record<string, unknown>
    return this.parseJobResponse(data)
  }

  /**
   * List fine-tuning jobs.
   */
  async listJobs(limit = 20): Promise<FineTuningJob[]> {
    if (!this.apiKey) throw new Error("OpenAI API key not configured for fine-tuning")

    const resp = await fetch(`${this.baseURL}/v1/fine_tuning/jobs?limit=${limit}`, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    })

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "unknown error")
      throw new Error(`List jobs failed (${resp.status}): ${errText}`)
    }

    const data = await resp.json() as { data?: Array<Record<string, unknown>> }
    return (data.data ?? []).map((j: Record<string, unknown>) => this.parseJobResponse(j))
  }

  /**
   * Cancel a fine-tuning job.
   */
  async cancelJob(jobId: string): Promise<FineTuningJob> {
    if (!this.apiKey) throw new Error("OpenAI API key not configured for fine-tuning")

    const resp = await fetch(`${this.baseURL}/v1/fine_tuning/jobs/${jobId}/cancel`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    })

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "unknown error")
      throw new Error(`Cancel job failed (${resp.status}): ${errText}`)
    }

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
    while (true) {
      const job = await this.getJobStatus(jobId)
      if (job.status === "succeeded" || job.status === "failed" || job.status === "cancelled") {
        return job
      }
      if (Date.now() - startTime > timeoutMs) {
        throw new Error(`Timed out waiting for job ${jobId} after ${timeoutMs}ms`)
      }
      await new Promise(r => setTimeout(r, pollIntervalMs))
    }
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
      error: (data.error as { message?: string })?.message,
      epochs: (data.hyperparameters as { n_epochs?: number })?.n_epochs,
    }
  }
}
