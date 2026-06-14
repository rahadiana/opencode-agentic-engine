export interface AppConfig { key: string; value: string | number | boolean; type: "string" | "number" | "boolean" | "json"; description?: string; updatedAt: Date }
