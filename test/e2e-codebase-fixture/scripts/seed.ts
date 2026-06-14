const users = Array.from({ length: 100 }, (_, i) => ({
  id: "u-" + i,
  email: "user" + i + "@example.com",
  name: "User " + i,
  role: i === 0 ? "admin" : "viewer",
}))
console.log("Seeded", users.length, "users")
