export interface ApiKey { id: string; userId: string; key: string; name: string; scopes: string[]; expiresAt?: Date; active: boolean }
