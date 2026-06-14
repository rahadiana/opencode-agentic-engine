export interface Permission { id: string; name: string; resource: string; action: "create" | "read" | "update" | "delete" | "manage"; roles: string[] }
