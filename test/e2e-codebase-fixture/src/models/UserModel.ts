export interface User {
  id: string
  name: string
  email: string
  role: "admin" | "user"
  avatar?: string
  bio?: string
  createdAt: Date
  updatedAt: Date
}

export interface UserStats {
  postCount: number
  commentCount: number
  reputation: number
}

export interface UserProfile {
  id: string
  name: string
  email: string | null
  avatar: string | null
  bio: string | null
  joinDate: Date
  stats: UserStats
}
