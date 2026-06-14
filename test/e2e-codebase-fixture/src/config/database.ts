export const dbConfig = { url: process.env.DB_URL ?? "sqlite://:memory:", poolSize: parseInt(process.env.DB_POOL ?? "10"), timeout: 5000, retryAttempts: 3 }
