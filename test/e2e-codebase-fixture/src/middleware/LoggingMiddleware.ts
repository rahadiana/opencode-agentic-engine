export function loggingMiddleware() { return (req: { method: string; url: string }) => { console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`); } }
