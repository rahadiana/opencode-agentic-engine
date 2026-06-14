export interface AuditLog { id: string; userId: string; action: string; resource: string; details: string; timestamp: Date; ip?: string }
