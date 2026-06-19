export type DomainName = string
import type { FormalContract } from "./formal-model.js"

export interface VerifierStrategy {
  name: string
  verify(context: { stepId: string; projectDir: string; output: string; filesModified: string[]; intent: string }): Promise<{ passed: boolean; output: string }>
}

export interface ErrorMatcher {
  name: string
  match(errorMessage: string): { matched: boolean; category: string; summary: string; likelyRootCause: string; suggestedFix: string; severity: "low" | "medium" | "high" | "critical" } | null
}

export interface DomainDecompositionRule {
  pattern: RegExp | string
  keywords: string[]
  template: (context: string) => Array<{ id: string; description: string; dependsOn: string[]; verificationCriteria: string[] }>
}

export interface DomainPack {
  name: DomainName
  description: string
  detect: (input: string) => number
  verifiers?: VerifierStrategy[]
  errorMatchers?: ErrorMatcher[]
  roles?: Array<{ role: string; name: string; prompt: string; tools: string[] }>
  skills?: Array<{ name: string; pattern: string; keywords: string[]; steps: string[] }>
  tools?: string[]
  fileExtensions?: string[]
  decompositionRules?: DomainDecompositionRule[]
  onLoad?: () => void
  /** Formal contract for pre/post-condition verification (G5 formal model) */
  formalContract?: FormalContract
}

export class DomainRegistry {
  private domains = new Map<DomainName, DomainPack>()
  private currentDomain: DomainName | null = null
  private activeVerifiers: VerifierStrategy[] = []
  private activeErrorMatchers: ErrorMatcher[] = []

  register(pack: DomainPack): void {
    this.domains.set(pack.name, pack)
  }

  unregister(name: DomainName): void {
    if (this.currentDomain === name) {
      this.currentDomain = null
      this.activeVerifiers = []
      this.activeErrorMatchers = []
    }
    this.domains.delete(name)
  }

  private static readonly MIN_CONFIDENCE = 0.15

  detect(input: string): DomainPack | null {
    let best: DomainPack | null = null
    let bestScore = 0
    for (const pack of this.domains.values()) {
      const score = pack.detect(input)
      if (score > bestScore && score >= DomainRegistry.MIN_CONFIDENCE) {
        bestScore = score
        best = pack
      }
    }
    return best
  }

  activate(name: DomainName): boolean {
    const pack = this.domains.get(name)
    if (!pack) return false
    this.currentDomain = name
    this.activeVerifiers = pack.verifiers ?? []
    this.activeErrorMatchers = pack.errorMatchers ?? []
    pack.onLoad?.()
    return true
  }

  activateFor(input: string): DomainPack | null {
    const pack = this.detect(input)
    if (pack) {
      const activated = this.activate(pack.name)
      return activated ? pack : null
    }
    return null
  }

  getCurrentDomain(): DomainName | null {
    return this.currentDomain
  }

  getCurrentPack(): DomainPack | null {
    return this.currentDomain ? this.domains.get(this.currentDomain) ?? null : null
  }

  getVerifiers(): VerifierStrategy[] {
    return this.activeVerifiers
  }

  getErrorMatchers(): ErrorMatcher[] {
    return this.activeErrorMatchers
  }

  getAll(): DomainPack[] {
    return [...this.domains.values()]
  }

  get(name: DomainName): DomainPack | undefined {
    return this.domains.get(name)
  }

  hasDomain(name: DomainName): boolean {
    return this.domains.has(name)
  }
}
