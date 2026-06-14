export interface Notification { id: string; userId: string; type: "email" | "sms" | "push"; title: string; body: string; read: boolean; createdAt: Date }
