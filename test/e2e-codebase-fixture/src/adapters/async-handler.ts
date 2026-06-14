export function asyncHandler(fn: Function) { return (req: unknown, res: unknown, next: (err?: Error) => void) => { Promise.resolve(fn(req, res, next)).catch(next) } }
