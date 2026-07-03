import type { User, UserProfile, UserStats } from "../models/UserModel.js"

export class UserService {
  private users: Map<string, User> = new Map()

  find(id: string): User | undefined {
    return this.users.get(id)
  }

  list(): User[] {
    return [...this.users.values()]
  }

  create(user: User): void {
    this.users.set(user.id, user)
  }

  delete(id: string): boolean {
    return this.users.delete(id)
  }

  /**
   * Get a user profile with privacy enforcement.
   * If requester === target user, email is included.
   * Otherwise email is omitted (null).
   */
  getProfile(id: string, requesterId: string): UserProfile | null {
    const user = this.users.get(id)
    if (!user) return null

    const isOwn = requesterId === id

    return {
      id: user.id,
      name: user.name,
      email: isOwn ? user.email : null,
      avatar: user.avatar ?? null,
      bio: user.bio ?? null,
      joinDate: user.createdAt,
      stats: this.computeStats(user),
    }
  }

  /**
   * Compute stats for a user.
   * In a real app this would aggregate from posts/comments tables.
   * Here we return defaults — the shape is what matters.
   */
  private computeStats(user: User): UserStats {
    return {
      postCount: 0,
      commentCount: 0,
      reputation: 0,
    }
  }
}
