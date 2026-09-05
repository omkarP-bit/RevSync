import "dotenv/config";
import bcrypt from "bcryptjs";
import { query } from "./pool.js";

async function seed() {
  console.log("Seeding user accounts for all roles...");

  // Fetch all roles
  const rolesResult = await query("SELECT id, name FROM roles ORDER BY id ASC");
  const rolesMap = new Map<string, string>(rolesResult.rows.map((r) => [r.name, r.id]));

  const passwordHash = await bcrypt.hash("Password123!", 10);

  const usersToSeed = [
    {
      email: "admin@revsync.com",
      first_name: "System",
      last_name: "Admin",
      role_name: "Admin",
    },
    {
      email: "admin.user@revsync.com",
      first_name: "Admin",
      last_name: "User",
      role_name: "Admin",
    },
    {
      email: "manager@revsync.com",
      first_name: "Sarah",
      last_name: "Manager",
      role_name: "Sales Manager",
    },
    {
      email: "sales@revsync.com",
      first_name: "Alex",
      last_name: "Salesrep",
      role_name: "Sales Representative",
    },
    {
      email: "finance@revsync.com",
      first_name: "Fiona",
      last_name: "Finance",
      role_name: "Finance",
    },
    {
      email: "warehouse@revsync.com",
      first_name: "Will",
      last_name: "Warehouse",
      role_name: "Warehouse Manager",
    },
  ];

  for (const user of usersToSeed) {
    const roleId = rolesMap.get(user.role_name);
    if (!roleId) {
      console.error(`Role ${user.role_name} not found!`);
      continue;
    }

    await query(
      `INSERT INTO users (email, password_hash, first_name, last_name, role_id, is_active)
       VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT (email) DO UPDATE SET
         password_hash = EXCLUDED.password_hash,
         first_name = EXCLUDED.first_name,
         last_name = EXCLUDED.last_name,
         role_id = EXCLUDED.role_id,
         is_active = true`,
      [user.email, passwordHash, user.first_name, user.last_name, roleId]
    );

    console.log(`✓ Seeded user: ${user.email} (${user.role_name})`);
  }

  console.log("Seeding complete!");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seeding failed:", err);
  process.exit(1);
});
