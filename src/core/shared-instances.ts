/**
 * SharedInstances — replaces globalThis pollution for cross-module instance sharing.
 *
 * Instead of attaching instances to globalThis, we store them here and import
 * them in both the producer (src/index.ts) and consumers (tools, protocol-adapter).
 *
 * This is a controlled singleton registry — NOT global scope. Only module-level
 * exports that would otherwise require globalThis pollution go here.
 */
import type { SkillStore } from "../memory/skill-store.js"
import type { EpisodicStore } from "../memory/episodic-store.js"
import type { ConfigLoader } from "./config.js"
import type { A2AClient } from "../agents/a2a-client.js"
import type { A2AServer } from "../agents/a2a-server.js"

let _skillStore: SkillStore | null = null
let _episodicStore: EpisodicStore | null = null
let _configLoader: ConfigLoader | null = null
let _agenticKnowledge: unknown = null
let _a2aClient: A2AClient | null = null
let _a2aServer: A2AServer | null = null

export function setSkillStore(store: SkillStore): void { _skillStore = store }
export function getSkillStore(): SkillStore | null { return _skillStore }

export function setEpisodicStore(store: EpisodicStore): void { _episodicStore = store }
export function getEpisodicStore(): EpisodicStore | null { return _episodicStore }

export function setConfigLoader(loader: ConfigLoader): void { _configLoader = loader }
export function getConfigLoader(): ConfigLoader | null { return _configLoader }

export function setAgenticKnowledge(knowledge: unknown): void { _agenticKnowledge = knowledge }
export function getAgenticKnowledge(): unknown { return _agenticKnowledge }

export function setA2AClient(client: A2AClient | null): void { _a2aClient = client }
export function getA2AClient(): A2AClient | null { return _a2aClient }

export function setA2AServer(server: A2AServer | null): void { _a2aServer = server }
export function getA2AServer(): A2AServer | null { return _a2aServer }
