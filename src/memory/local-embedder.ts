/**
 * LocalEmbedder — stub untuk local embedding.
 *
 * @xenova/transformers sudah dihapus dari dependency.
 * Local embedding sekarang hanya fallback sparse TF-IDF.
 * Kalau mau full vector, set `embedding.endpoint` di config.json
 * untuk pake remote embedding via provider.
 */

export class LocalEmbedder {
  private _ready = false

  async init(): Promise<void> {
    this._ready = false
    // No-op — local embedding dihapus, pake remote endpoint aja
  }

  get ready(): boolean {
    return this._ready
  }

  get error(): string | null {
    return "Local embedding disabled. Set embedding.endpoint in .agentic/config.json for vector search."
  }

  async embed(_text: string): Promise<Float32Array | null> {
    return null
  }
}

export async function createEmbedder(): Promise<LocalEmbedder> {
  const embedder = new LocalEmbedder()
  await embedder.init()
  return embedder
}
