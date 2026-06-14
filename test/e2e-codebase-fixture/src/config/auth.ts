export const authConfig = { jwtSecret: process.env.JWT_SECRET ?? "dev-secret", jwtExpiry: "24h", apiKeyLength: 32, bcryptRounds: 10 }
