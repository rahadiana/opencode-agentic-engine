import type { AuthService, TokenPair } from "../services/AuthService.js"

export interface LoginRequest {
  email: string
  password: string
}

export interface RefreshRequest {
  refreshToken: string
}

export class AuthController {
  constructor(private auth: AuthService) {}

  login(req: { body: LoginRequest }): TokenPair {
    return this.auth.login(req.body.email, req.body.password)
  }

  refresh(req: { body: RefreshRequest }): TokenPair {
    const result = this.auth.refreshToken(req.body.refreshToken)
    if (!result) {
      throw new Error("Invalid or expired refresh token")
    }
    return result
  }

  logout(req: { body: { refreshToken: string } }): { ok: boolean } {
    this.auth.logout(req.body.refreshToken)
    return { ok: true }
  }
}
