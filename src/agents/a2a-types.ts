/**
 * A2A (Agent-to-Agent) Protocol Types — Google A2A standard (April 2025).
 *
 * Implements the core types for agent discovery, task delegation, and
 * inter-agent communication following the A2A specification.
 *
 * References:
 *   - https://github.com/google/A2A (Agent-to-Agent Protocol)
 *   - A2A Card: agent discovery + capability advertisement
 *   - JSON-RPC 2.0 over HTTP for task lifecycle
 *
 * Integration with opencode-agentic-engine:
 *   - AgentCard.capabilities ← skill-store skills
 *   - Task execution ← AgentCoordinator.delegate()
 *   - Message parts ← inter-agent message bus
 */

// ── Agent Card (Discovery) ──────────────────────────────────

export interface AgentCardCapability {
  /** Capability identifier (e.g. "auth.login", "code.generate") */
  id: string
  /** Human-readable name */
  name: string
  /** Description of what this capability does */
  description: string
  /** Skill ID from skill-store (if mapped) */
  skillId?: string
  /** Estimated success rate (0-1) from historical data */
  estimatedSuccessRate?: number
}

export interface AgentCardAuthentication {
  /** Authentication scheme: "none" | "bearer" | "api-key" | "oauth2" */
  scheme: "none" | "bearer" | "api-key" | "oauth2"
  /** Credentials (never serialized to network — local only) */
  credentials?: string
}

export interface AgentCard {
  /** A2A protocol version (default "1.0") */
  protocolVersion: string
  /** Agent name */
  name: string
  /** Agent description */
  description: string
  /** Base URL for A2A endpoint */
  url: string
  /** List of capabilities this agent provides */
  capabilities: AgentCardCapability[]
  /** Optional authentication config */
  authentication?: AgentCardAuthentication
  /** Optional agent metadata */
  metadata?: Record<string, unknown>
}

// ── Task (Work Unit) ────────────────────────────────────────

export type TaskStatus = "submitted" | "working" | "input-required" | "completed" | "failed" | "canceled"

export interface TaskId {
  /** Unique identifier for this task */
  id: string
  /** Session identifier for multi-turn conversations */
  sessionId?: string
}

export interface TaskInput {
  /** List of messages comprising the task input */
  messages: A2AMessage[]
  /** Optional additional instructions */
  instructions?: string
}

export interface Task {
  id: TaskId
  status: TaskStatus
  input?: TaskInput
  /** Messages exchanged during task execution */
  messages: A2AMessage[]
  /** Output artifacts produced by the task */
  artifacts: Artifact[]
  /** Human-readable status description */
  statusDescription?: string
  /** When the task was created (ISO 8601) */
  createdAt?: string
  /** When the task was last updated (ISO 8601) */
  updatedAt?: string
}

// ── Message ─────────────────────────────────────────────────

export type MessageRole = "agent" | "user"

export interface A2AMessage {
  /** Message role */
  role: MessageRole
  /** Content parts (text, file, data) */
  parts: Part[]
  /** Message ID for threading */
  id?: string
  /** Timestamp (ISO 8601) */
  timestamp?: string
  /** Metadata */
  metadata?: Record<string, unknown>
}

// ── Part (Content Unit) ────────────────────────────────────

export interface TextPart {
  type: "text"
  text: string
}

export interface FilePart {
  type: "file"
  /** MIME type (e.g. "text/plain", "application/json") */
  mimeType: string
  /** File content as base64-encoded string */
  data: string
  /** Optional filename */
  name?: string
}

export interface DataPart {
  type: "data"
  /** Structured data (JSON-serializable) */
  data: Record<string, unknown>
}

export type Part = TextPart | FilePart | DataPart

// ── Artifact (Output) ──────────────────────────────────────

export interface Artifact {
  /** Artifact name */
  name: string
  /** Content parts */
  parts: Part[]
  /** Optional description */
  description?: string
  /** Artifact index in sequence (for append) */
  index?: number
  /** Whether this artifact appends to previous (streaming) */
  append?: boolean
  /** Timestamp (ISO 8601) */
  timestamp?: string
}

// ── JSON-RPC 2.0 ───────────────────────────────────────────

export interface JsonRpcRequest {
  jsonrpc: "2.0"
  id: string | number
  method: string
  params?: Record<string, unknown>
}

export interface JsonRpcError {
  code: number
  message: string
  data?: unknown
}

export interface JsonRpcResponse {
  jsonrpc: "2.0"
  id: string | number
  result?: unknown
  error?: JsonRpcError
}

// ── A2A Methods ────────────────────────────────────────────

/** agent/getCard request params */
export interface GetCardParams {
  /** Optional filter for specific capabilities */
  capabilityFilter?: string[]
}

/** tasks/send request params — send a task and wait for result */
export interface TaskSendParams {
  id: TaskId
  input: TaskInput
  /** Optional signal for task-level configuration */
  signal?: Record<string, unknown>
}

/** tasks/get request params — poll task status */
export interface TaskGetParams {
  id: TaskId
}

/** tasks/cancel request params */
export interface TaskCancelParams {
  id: TaskId
}

// ── A2A Method Names ───────────────────────────────────────

export const A2A_METHODS = {
  GET_CARD: "agent/getCard",
  TASK_SEND: "tasks/send",
  TASK_GET: "tasks/get",
  TASK_CANCEL: "tasks/cancel",
} as const

// ── Constants ──────────────────────────────────────────────

export const A2A_PROTOCOL_VERSION = "1.0"
export const A2A_CONTENT_TYPE = "application/json"
export const A2A_SSE_CONTENT_TYPE = "text/event-stream"

// ── Helper Functions ───────────────────────────────────────

export function createTaskId(prefix = "a2a"): TaskId {
  return {
    id: `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sessionId: `session-${Date.now()}`,
  }
}

export function createTextMessage(role: MessageRole, text: string): A2AMessage {
  return {
    role,
    parts: [{ type: "text" as const, text }],
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
  }
}

export function createJsonRpcRequest(method: string, params?: Record<string, unknown>, id?: string | number): JsonRpcRequest {
  return {
    jsonrpc: "2.0",
    id: id ?? Math.random().toString(36).slice(2, 8),
    method,
    params: params ?? {},
  }
}

export function createJsonRpcError(code: number, message: string, data?: unknown): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id: "",
    error: { code, message, data },
  }
}

export function createJsonRpcResult(id: string | number, result: unknown): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    result,
  }
}
