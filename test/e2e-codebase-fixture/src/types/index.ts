// src/types/index.ts — Core domain types
export interface User { id: string; email: string; name: string; role: UserRole; createdAt: Date }
export type UserRole = "admin" | "editor" | "viewer"
export interface Session { id: string; userId: string; token: string; expiresAt: Date }
export interface ApiError { code: string; message: string; status: number }
export interface Paginated<T> { data: T[]; total: number; page: number; limit: number }
export interface AuditLog { id: string; userId: string; action: string; resource: string; timestamp: Date }
export interface Config { dbUrl: string; jwtSecret: string; port: number; logLevel: string }
export interface WebhookPayload { event: string; payload: unknown; signature: string }
export type Result<T> = { ok: true; value: T } | { ok: false; error: ApiError }
