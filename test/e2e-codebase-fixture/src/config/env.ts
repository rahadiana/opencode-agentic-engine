import { defaultConfig } from "./default"
import type { Config } from "../types"
export function loadConfig(overrides?: Partial<Config>): Config {
  return { ...defaultConfig, ...overrides, jwtSecret: process.env.JWT_SECRET ?? defaultConfig.jwtSecret }
}
