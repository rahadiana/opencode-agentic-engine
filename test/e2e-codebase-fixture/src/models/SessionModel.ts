export interface Session { id: string; userId: string; token: string; expiresAt: Date; createdAt: Date; refreshToken?: string }
