import type { UserService } from "../services/UserService.js"
import type { UserProfile } from "../models/UserModel.js"
import type { User } from "../models/UserModel.js"

export class UserController {
  constructor(private userService: UserService) {}

  list(): User[] {
    return this.userService.list()
  }

  get(id: string): User | undefined {
    return this.userService.find(id)
  }

  getProfile(id: string, requesterId: string): UserProfile | null {
    return this.userService.getProfile(id, requesterId)
  }
}
