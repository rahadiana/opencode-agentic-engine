export const cacheConfig = { redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379", defaultTTL: 60000, maxEntries: 10000 }
