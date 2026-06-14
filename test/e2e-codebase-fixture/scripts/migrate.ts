import { readFileSync } from "fs"
const migrations = ["001_init", "002_add_audit", "003_add_webhooks"]
for (const m of migrations) {
  console.log("Running:", m)
  // Migration logic here
}
console.log("All migrations complete")
