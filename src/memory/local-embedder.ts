type PipelineFn = (text: string, opts: { pooling: string; normalize: boolean }) => Promise<{ data: Float32Array; dims: number[] }>

export class LocalEmbedder {
  private piped: PipelineFn | null = null
  private initialized = false
  private initPromise: Promise<void> | null = null
  private initError: string | null = null

  async init(): Promise<void> {
    if (this.initialized) return
    if (this.initPromise) return this.initPromise

    this.initPromise = (async () => {
      try {
        const mod = await import("@xenova/transformers")
        this.piped = (await mod.pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", {
          quantized: true,
        })) as unknown as PipelineFn
        this.initialized = true
      } catch (e) {
        this.initialized = false
        this.initError = (e as Error).message
      }
    })()

    return this.initPromise
  }

  get ready(): boolean {
    return this.initialized
  }

  get error(): string | null {
    return this.initError
  }

  async embed(text: string): Promise<Float32Array | null> {
    if (!this.initialized) await this.init()
    if (!this.piped) return null

    try {
      const result = await this.piped(text.slice(0, 8192), { pooling: "mean", normalize: true })
      return result.data
    } catch {
      return null
    }
  }
}

export async function createEmbedder(): Promise<LocalEmbedder> {
  const embedder = new LocalEmbedder()
  await embedder.init()
  return embedder
}
