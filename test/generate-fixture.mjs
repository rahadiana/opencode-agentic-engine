import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const BASE = "test/e2e-codebase-fixture"

const dirs = [
  "src/models", "src/services", "src/controllers", "src/middleware",
  "src/utils", "src/routes", "src/types", "src/config",
  "src/validators", "src/helpers", "src/adapters", "src/decorators",
  "src/errors", "src/events", "src/plugins",
  "tests/unit", "tests/integration",
]
for (const d of dirs) mkdirSync(join(BASE, d), { recursive: true })

function gen(subdir, name, content) {
  writeFileSync(join(BASE, subdir, name), content)
}

gen("", "package.json", JSON.stringify({
  name: "e2e-app", version: "1.0.0", type: "module",
  scripts: { build: "tsc", test: "echo tests ok" },
  dependencies: { express: "^4.18.0" },
  devDependencies: { "@types/node": "^20.0.0", typescript: "^5.3.0" },
}, null, 2) + "\n")

gen("", "tsconfig.json", JSON.stringify({
  compilerOptions: {
    target: "ES2022", module: "ESNext", moduleResolution: "bundler",
    strict: true, outDir: "./dist", rootDir: "./src", declaration: true,
    esModuleInterop: true, skipLibCheck: true,
  },
  include: ["src/**/*"],
  exclude: ["tests"],
}, null, 2) + "\n")

const files = [
  // MODELS
  ["src/models", "UserModel.ts", `export interface User { id: string; name: string; email: string; role: "admin" | "user"; createdAt: Date; updatedAt: Date }`],
  ["src/models", "SessionModel.ts", `export interface Session { id: string; userId: string; token: string; expiresAt: Date; createdAt: Date; refreshToken?: string }`],
  ["src/models", "ApiKeyModel.ts", `export interface ApiKey { id: string; userId: string; key: string; name: string; scopes: string[]; expiresAt?: Date; active: boolean }`],
  ["src/models", "ProductModel.ts", `export interface Product { id: string; name: string; slug: string; description: string; price: number; category: string; tags: string[]; stock: number; active: boolean }`],
  ["src/models", "OrderModel.ts", `export interface Order { id: string; userId: string; items: OrderItem[]; total: number; status: "pending" | "confirmed" | "shipped" | "delivered" | "cancelled"; createdAt: Date }`],
  ["src/models", "OrderItem.ts", `export interface OrderItem { productId: string; quantity: number; price: number; name: string }`],
  ["src/models", "FlagsModel.ts", `export interface FeatureFlag { id: string; name: string; enabled: boolean; targeting?: FlagTargeting; rolloutPercentage?: number }`],
  ["src/models", "FlagTargeting.ts", `export interface FlagTargeting { users?: string[]; groups?: string[]; environments?: string[] }`],
  ["src/models", "AuditLogModel.ts", `export interface AuditLog { id: string; userId: string; action: string; resource: string; details: string; timestamp: Date; ip?: string }`],
  ["src/models", "ConfigModel.ts", `export interface AppConfig { key: string; value: string | number | boolean; type: "string" | "number" | "boolean" | "json"; description?: string; updatedAt: Date }`],
  ["src/models", "NotificationModel.ts", `export interface Notification { id: string; userId: string; type: "email" | "sms" | "push"; title: string; body: string; read: boolean; createdAt: Date }`],
  ["src/models", "PermissionModel.ts", `export interface Permission { id: string; name: string; resource: string; action: "create" | "read" | "update" | "delete" | "manage"; roles: string[] }`],
  ["src/models", "RoleModel.ts", `export interface Role { id: string; name: string; description: string; permissions: string[]; parentRole?: string }`],
  ["src/models", "MetricsModel.ts", `export interface MetricPoint { name: string; value: number; labels: Record<string, string>; timestamp: Date }`],

  // SERVICES
  ["src/services", "UserService.ts", `export class UserService { private users: Map<string, import("../models/UserModel.js").User> = new Map(); find(id: string) { return this.users.get(id) } list(): import("../models/UserModel.js").User[] { return [...this.users.values()] } create(user: import("../models/UserModel.js").User) { this.users.set(user.id, user) } delete(id: string) { return this.users.delete(id) } }`],
  ["src/services", "AuthService.ts", `export class AuthService { login(email: string, password: string): string { return \`tok-\${Date.now()}\` } validate(token: string): string | null { return token ? "user-1" : null } logout(token: string): void {} }`],
  ["src/services", "SessionService.ts", `export class SessionService { validate(token: string): boolean { return !!token } refresh(refreshToken: string): string { return \`tok-\${Date.now()}\` } }`],
  ["src/services", "ApiKeyService.ts", `export class ApiKeyService { validate(key: string): boolean { return key.length > 8 } generate(userId: string): string { return \`ak-\${userId}-\${Date.now()}\` } }`],
  ["src/services", "ProductService.ts", `export class ProductService { private products = new Map<string, import("../models/ProductModel.js").Product>(); find(id: string) { return this.products.get(id) } search(query: string): import("../models/ProductModel.js").Product[] { return [...this.products.values()].filter(p => p.name.includes(query)) } }`],
  ["src/services", "OrderService.ts", `export class OrderService { private orders = new Map<string, import("../models/OrderModel.js").Order>(); create(userId: string, items: import("../models/OrderItem.js").OrderItem[]): import("../models/OrderModel.js").Order { return { id: \`ord-\${Date.now()}\`, userId, items, total: items.reduce((s, i) => s + i.price * i.quantity, 0), status: "pending", createdAt: new Date() } } }`],
  ["src/services", "CacheService.ts", `export class CacheService { private store = new Map<string, { value: unknown; ttl: number; expires: number }>(); get<T>(key: string): T | undefined { const entry = this.store.get(key); if (!entry || Date.now() > entry.expires) { this.store.delete(key); return undefined } return entry.value as T } set(key: string, value: unknown, ttlMs = 60000): void { this.store.set(key, { value, ttl: ttlMs, expires: Date.now() + ttlMs }) } invalidate(pattern: string): void { for (const key of this.store.keys()) { if (key.startsWith(pattern)) this.store.delete(key) } } }`],
  ["src/services", "NotificationService.ts", `export class NotificationService { private notifications: import("../models/NotificationModel.js").Notification[] = []; send(notif: import("../models/NotificationModel.js").Notification): void { this.notifications.push(notif) } list(userId: string): import("../models/NotificationModel.js").Notification[] { return this.notifications.filter(n => n.userId === userId) } }`],
  ["src/services", "FlagsService.ts", `export class FlagsService { private flags = new Map<string, import("../models/FlagsModel.js").FeatureFlag>(); evaluate(name: string, context?: Record<string, unknown>): boolean { return this.flags.get(name)?.enabled ?? false } toggle(name: string, enabled: boolean): void { const flag = this.flags.get(name); if (flag) flag.enabled = enabled } }`],
  ["src/services", "AuditService.ts", `export class AuditService { private logs: import("../models/AuditLogModel.js").AuditLog[] = []; record(log: import("../models/AuditLogModel.js").AuditLog): void { this.logs.push(log) } query(userId: string): import("../models/AuditLogModel.js").AuditLog[] { return this.logs.filter(l => l.userId === userId) } }`],
  ["src/services", "PermissionService.ts", `export class PermissionService { private permissions = new Map<string, import("../models/PermissionModel.js").Permission>(); hasPermission(userId: string, resource: string, action: string): boolean { return true } }`],

  // CONTROLLERS
  ["src/controllers", "AuthController.ts", `export class AuthController { constructor(private auth: import("../services/AuthService.js").AuthService) {} login(req: { body: { email: string; password: string } }): { token: string } { return { token: this.auth.login(req.body.email, req.body.password) } } }`],
  ["src/controllers", "UserController.ts", `export class UserController { constructor(private userService: import("../services/UserService.js").UserService) {} list() { return this.userService.list() } get(id: string) { return this.userService.find(id) } }`],
  ["src/controllers", "ProductController.ts", `export class ProductController { constructor(private productService: import("../services/ProductService.js").ProductService) {} search(query: string) { return this.productService.search(query) } }`],
  ["src/controllers", "OrderController.ts", `export class OrderController { constructor(private orderService: import("../services/OrderService.js").OrderService) {} create(userId: string, items: import("../models/OrderItem.js").OrderItem[]) { return this.orderService.create(userId, items) } }`],
  ["src/controllers", "AdminController.ts", `export class AdminController { constructor(private flags: import("../services/FlagsService.js").FlagsService) {} toggleFlag(name: string, enabled: boolean) { this.flags.toggle(name, enabled); return { ok: true } } }`],

  // MIDDLEWARE
  ["src/middleware", "AuthMiddleware.ts", `import type { AuthService } from "../services/AuthService.js"; export function authMiddleware(auth: AuthService) { return (req: { headers: Record<string, string>; user?: string }) => { const token = req.headers["authorization"]; if (!token) throw new Error("Unauthorized"); const user = auth.validate(token); if (!user) throw new Error("Invalid token"); req.user = user; } }`],
  ["src/middleware", "ApiKeyMiddleware.ts", `import type { ApiKeyService } from "../services/ApiKeyService.js"; export function apiKeyMiddleware(apiKey: ApiKeyService) { return (req: { headers: Record<string, string> }) => { const key = req.headers["x-api-key"]; if (!key || !apiKey.validate(key)) throw new Error("Invalid API key"); } }`],
  ["src/middleware", "ErrorHandler.ts", `export function errorHandler(err: Error, _req: unknown, res: { status: (code: number) => { json: (body: object) => void } }, _next: unknown) { console.error(err.message); res.status(500).json({ error: err.message }); }`],
  ["src/middleware", "LoggingMiddleware.ts", `export function loggingMiddleware() { return (req: { method: string; url: string }) => { console.log(\`[\${new Date().toISOString()}] \${req.method} \${req.url}\`); } }`],
  ["src/middleware", "RateLimitMiddleware.ts", `export class RateLimitMiddleware { private hits = new Map<string, number[]>(); check(ip: string): boolean { const now = Date.now(); const window = this.hits.get(ip) ?? []; const recent = window.filter(t => now - t < 60000); recent.push(now); this.hits.set(ip, recent); return recent.length <= 100 } }`],
  ["src/middleware", "ValidationMiddleware.ts", `export function validationMiddleware(schema: Record<string, string>) { return (req: { body: Record<string, unknown> }) => { for (const [field, type] of Object.entries(schema)) { if (typeof req.body[field] !== type) throw new Error(\`Invalid type for \${field}: expected \${type}\`) } } }`],

  // UTILS
  ["src/utils", "retry.ts", `export async function retry<T>(fn: () => Promise<T>, maxRetries = 3, delay = 1000): Promise<T> { for (let i = 0; i < maxRetries; i++) { try { return await fn() } catch (e) { if (i === maxRetries - 1) throw e; await new Promise(r => setTimeout(r, delay * Math.pow(2, i))) } } throw new Error("Retry failed") }`],
  ["src/utils", "validation.ts", `export function isEmail(v: string): boolean { return /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(v); } export function isPhone(v: string): boolean { return /^\\+?[\\d\\s-]{10,}$/.test(v); } export function notEmpty(v: string): boolean { return v.trim().length > 0 } export function minLength(n: number): (v: string) => boolean { return (v: string) => v.length >= n } export function maxLength(n: number): (v: string) => boolean { return (v: string) => v.length <= n }`],
  ["src/utils", "logger.ts", `export class Logger { private level: "debug" | "info" | "warn" | "error" = "info"; debug(msg: string, ...args: unknown[]) { if (this.level === "debug") console.log(\`[DEBUG] \${msg}\`, ...args) } info(msg: string, ...args: unknown[]) { console.log(\`[INFO] \${msg}\`, ...args) } warn(msg: string, ...args: unknown[]) { console.warn(\`[WARN] \${msg}\`, ...args) } error(msg: string, ...args: unknown[]) { console.error(\`[ERROR] \${msg}\`, ...args) } setLevel(l: typeof this.level) { this.level = l } }`],
  ["src/utils", "paginator.ts", `export function paginate<T>(items: T[], page: number, limit: number): { items: T[]; total: number; page: number; totalPages: number } { const start = (page - 1) * limit; return { items: items.slice(start, start + limit), total: items.length, page, totalPages: Math.ceil(items.length / limit) } }`],
  ["src/utils", "hash.ts", `export function hash(str: string): string { let h = 0; for (let i = 0; i < str.length; i++) { h = ((h << 5) - h) + str.charCodeAt(i); h |= 0 } return Math.abs(h).toString(16) }`],
  ["src/utils", "date.ts", `export function formatDate(d: Date): string { return d.toISOString().split("T")[0] } export function daysAgo(n: number): Date { const d = new Date(); d.setDate(d.getDate() - n); return d } export function isExpired(d: Date): boolean { return Date.now() > d.getTime() }`],

  // ROUTES
  ["src/routes", "auth.ts", `import type { AuthController } from "../controllers/AuthController.js"; export function registerAuthRoutes(ctrl: AuthController, router: { post: (path: string, handler: Function) => void }) { router.post("/auth/login", (req: unknown) => ctrl.login(req as any)); }`],
  ["src/routes", "users.ts", `import type { UserController } from "../controllers/UserController.js"; export function registerUserRoutes(ctrl: UserController, router: { get: (path: string, handler: Function) => void }) { router.get("/users", () => ctrl.list()); router.get("/users/:id", (req: { params: { id: string } }) => ctrl.get(req.params.id)); }`],
  ["src/routes", "products.ts", `import type { ProductController } from "../controllers/ProductController.js"; export function registerProductRoutes(ctrl: ProductController, router: { get: (path: string, handler: Function) => void }) { router.get("/products", (req: { query: { q: string } }) => ctrl.search(req.query.q)); }`],
  ["src/routes", "admin.ts", `import type { AdminController } from "../controllers/AdminController.js"; export function registerAdminRoutes(ctrl: AdminController, router: { post: (path: string, handler: Function) => void }) { router.post("/admin/flags/toggle", (req: { body: { name: string; enabled: boolean } }) => ctrl.toggleFlag(req.body.name, req.body.enabled)); }`],

  // TYPES
  ["src/types", "express.d.ts", `declare namespace Express { interface Request { user?: string; flags?: Record<string, boolean>; requestId?: string } }`],
  ["src/types", "env.d.ts", `declare namespace NodeJS { interface ProcessEnv { NODE_ENV?: string; PORT?: string; DB_URL?: string; REDIS_URL?: string; API_KEY?: string; LOG_LEVEL?: string } }`],

  // CONFIG
  ["src/config", "app.ts", `export const appConfig = { port: parseInt(process.env.PORT ?? "3000"), env: (process.env.NODE_ENV ?? "development"), logLevel: (process.env.LOG_LEVEL ?? "info"), isDev: process.env.NODE_ENV !== "production", isProd: process.env.NODE_ENV === "production" }`],
  ["src/config", "database.ts", `export const dbConfig = { url: process.env.DB_URL ?? "sqlite://:memory:", poolSize: parseInt(process.env.DB_POOL ?? "10"), timeout: 5000, retryAttempts: 3 }`],
  ["src/config", "cache.ts", `export const cacheConfig = { redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379", defaultTTL: 60000, maxEntries: 10000 }`],
  ["src/config", "auth.ts", `export const authConfig = { jwtSecret: process.env.JWT_SECRET ?? "dev-secret", jwtExpiry: "24h", apiKeyLength: 32, bcryptRounds: 10 }`],

  // VALIDATORS
  ["src/validators", "auth-validator.ts", `import { isEmail, notEmpty } from "../utils/validation.js"; export function validateLoginInput(email: string, password: string): string[] { const errors: string[] = []; if (!isEmail(email)) errors.push("Invalid email"); if (!notEmpty(password)) errors.push("Password required"); return errors }`],
  ["src/validators", "product-validator.ts", `import { notEmpty, minLength } from "../utils/validation.js"; export function validateProduct(data: { name: string; price: number; category: string }): string[] { const errors: string[] = []; if (!notEmpty(data.name)) errors.push("Name required"); if (data.price <= 0) errors.push("Invalid price"); if (!notEmpty(data.category)) errors.push("Category required"); return errors }`],

  // HELPERS
  ["src/helpers", "response.ts", `export function ok<T>(data: T): { success: true; data: T } { return { success: true, data } } export function fail(error: string, code = 400): { success: false; error: string; code: number } { return { success: false, error, code } }`],
  ["src/helpers", "pagination.ts", `export function paginatedResponse<T>(items: T[], total: number, page: number, limit: number) { return { items, total, page, limit, totalPages: Math.ceil(total / limit), hasNext: page * limit < total, hasPrev: page > 1 } }`],

  // ADAPTERS
  ["src/adapters", "express-adapter.ts", `import type { Request, Response } from "express"; export function adaptHandler(handler: (req: Request) => Promise<unknown>) { return async (req: Request, res: Response) => { try { const result = await handler(req); res.json(result) } catch (e) { res.status(500).json({ error: (e as Error).message }) } } }`],
  ["src/adapters", "async-handler.ts", `export function asyncHandler(fn: Function) { return (req: unknown, res: unknown, next: (err?: Error) => void) => { Promise.resolve(fn(req, res, next)).catch(next) } }`],

  // DECORATORS
  ["src/decorators", "injectable.ts", `export function Injectable(): ClassDecorator { return (target) => { Reflect.defineMetadata("injectable", true, target); return target } }`],
  ["src/decorators", "route.ts", `export function Get(path: string): MethodDecorator { return (target, key, _desc) => { Reflect.defineMetadata("route:method", "GET", target, key); Reflect.defineMetadata("route:path", path, target, key); } }`],
  ["src/decorators", "validate.ts", `export function Validate(schema: Record<string, string>): MethodDecorator { return (target, key, descriptor) => { const original = (descriptor as PropertyDescriptor).value; (descriptor as PropertyDescriptor).value = function (...args: unknown[]) { const [req] = args; if (req && (req as any).body) { } return original.apply(this, args) }; return descriptor } }`],

  // ERRORS
  ["src/errors", "app-error.ts", `export class AppError extends Error { constructor(message: string, public code: number = 500, public details?: unknown) { super(message); this.name = "AppError" } }`],
  ["src/errors", "not-found.ts", `export class NotFoundError extends AppError { constructor(resource: string, id: string) { super(\`\${resource} with id \${id} not found\`, 404); this.name = "NotFoundError" } }`],
  ["src/errors", "validation-error.ts", `export class ValidationError extends AppError { constructor(public errors: string[]) { super("Validation failed", 400, errors); this.name = "ValidationError" } }`],
  ["src/errors", "auth-error.ts", `export class AuthError extends AppError { constructor(message = "Unauthorized") { super(message, 401); this.name = "AuthError" } }`],

  // EVENTS
  ["src/events", "event-bus.ts", `type Handler = (payload: unknown) => void; export class EventBus { private handlers = new Map<string, Handler[]>(); on(event: string, handler: Handler): void { const list = this.handlers.get(event) ?? []; list.push(handler); this.handlers.set(event, list) } emit(event: string, payload: unknown): void { for (const h of this.handlers.get(event) ?? []) { try { h(payload) } catch (e) { console.error("Event handler error:", e) } } } off(event: string, handler: Handler): void { const list = this.handlers.get(event); if (list) this.handlers.set(event, list.filter(h => h !== handler)) } }`],
  ["src/events", "user-events.ts", `export const UserEvents = { CREATED: "user:created", UPDATED: "user:updated", DELETED: "user:deleted", LOGIN: "user:login", LOGOUT: "user:logout" } as const`],
  ["src/events", "order-events.ts", `export const OrderEvents = { CREATED: "order:created", CONFIRMED: "order:confirmed", SHIPPED: "order:shipped", DELIVERED: "order:delivered", CANCELLED: "order:cancelled" } as const`],

  // PLUGINS
  ["src/plugins", "plugin-manager.ts", `export interface Plugin { name: string; version: string; hooks: Record<string, Function>; activate(): void; deactivate(): void } export class PluginManager { private plugins = new Map<string, Plugin>(); register(plugin: Plugin): void { this.plugins.set(plugin.name, plugin); plugin.activate() } unregister(name: string): void { this.plugins.get(name)?.deactivate(); this.plugins.delete(name) } }`],
  ["src/plugins", "metrics-plugin.ts", `export const metricsPlugin = { name: "metrics", version: "1.0.0", hooks: { afterRequest: (req: unknown, res: unknown, duration: number) => { } }, activate() { console.log("Metrics plugin activated") }, deactivate() { console.log("Metrics plugin deactivated") } }`],

  // UNIT TESTS
  ["tests/unit", "UserService.test.ts", `import type { UserService } from "../../src/services/UserService.js"; export function testUserService(svc: UserService) { const user = { id: "1", name: "Test", email: "test@test.com", role: "user" as const, createdAt: new Date(), updatedAt: new Date() }; svc.create(user); console.assert(svc.find("1")?.name === "Test", "should find user") }`],
  ["tests/unit", "AuthService.test.ts", `import type { AuthService } from "../../src/services/AuthService.js"; export function testAuthService(auth: AuthService) { const token = auth.login("test@test.com", "pass"); console.assert(!!token, "should return token") }`],
  ["tests/unit", "CacheService.test.ts", `import { CacheService } from "../../src/services/CacheService.js"; export function testCache() { const cache = new CacheService(); cache.set("key", "value"); console.assert(cache.get("key") === "value", "should get value"); cache.invalidate("key"); console.assert(cache.get("key") === undefined, "should invalidate") }`],
  ["tests/unit", "FlagsService.test.ts", `import { FlagsService } from "../../src/services/FlagsService.js"; export function testFlags() { const flags = new FlagsService(); flags.toggle("feature-x", true); console.assert(flags.evaluate("feature-x"), "should evaluate true") }`],
  ["tests/unit", "Validation.test.ts", `import { isEmail, isPhone, notEmpty } from "../../src/utils/validation.js"; export function testValidation() { console.assert(isEmail("a@b.com"), "valid email"); console.assert(!isEmail("not-email"), "invalid email") }`],
  ["tests/unit", "Paginator.test.ts", `import { paginate } from "../../src/utils/paginator.js"; export function testPaginator() { const items = [1, 2, 3, 4, 5]; const p1 = paginate(items, 1, 2); console.assert(p1.items.length === 2, "first page") }`],
  ["tests/unit", "Retry.test.ts", `import { retry } from "../../src/utils/retry.js"; export async function testRetry() { let count = 0; const result = await retry(() => { count++; if (count < 3) throw new Error("fail"); return "ok" }, 3, 1); console.assert(result === "ok", "should succeed after retries") }`],

  // INTEGRATION TESTS
  ["tests/integration", "auth-flow.test.ts", `export async function testAuthFlow() { console.assert(true, "auth flow") }`],
  ["tests/integration", "order-flow.test.ts", `export async function testOrderFlow() { console.assert(true, "order flow") }`],
  ["tests/integration", "cache-flow.test.ts", `export async function testCacheFlow() { console.assert(true, "cache flow") }`],
  ["tests/integration", "api-key-flow.test.ts", `export async function testApiKeyFlow() { console.assert(true, "api key flow") }`],
]

for (const [dir, name, content] of files) {
  gen(dir, name, content + "\n")
}

console.log(`Generated ${files.length} files in ${BASE}`)
