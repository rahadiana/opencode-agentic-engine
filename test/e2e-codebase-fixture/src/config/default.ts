import type { Config } from "../types"
export const defaultConfig: Config = {
  dbUrl: "postgres://localhost:5432/app",
  jwtSecret: "change-me-in-production",
  port: 3000,
  logLevel: "info",
}
