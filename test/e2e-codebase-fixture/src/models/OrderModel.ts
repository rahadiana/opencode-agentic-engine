export interface Order { id: string; userId: string; items: OrderItem[]; total: number; status: "pending" | "confirmed" | "shipped" | "delivered" | "cancelled"; createdAt: Date }
