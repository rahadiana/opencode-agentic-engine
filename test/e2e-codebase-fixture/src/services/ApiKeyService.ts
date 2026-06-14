export class ApiKeyService { validate(key: string): boolean { return key.length > 8 } generate(userId: string): string { return `ak-${userId}-${Date.now()}` } }
