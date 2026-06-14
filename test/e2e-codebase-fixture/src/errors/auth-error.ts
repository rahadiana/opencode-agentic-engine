export class AuthError extends AppError { constructor(message = "Unauthorized") { super(message, 401); this.name = "AuthError" } }
