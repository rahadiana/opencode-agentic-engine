export class SessionService { validate(token: string): boolean { return !!token } refresh(refreshToken: string): string { return `tok-${Date.now()}` } }
