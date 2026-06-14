declare namespace Express { interface Request { user?: string; flags?: Record<string, boolean>; requestId?: string } }
