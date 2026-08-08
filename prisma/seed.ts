import { Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/prisma";
// use the global `process` provided by Node.js

async function main() {
  console.log("🌱 Seeding Admin User into PostgreSQL...");

  // Credentials must come from env — never hardcode a real admin password in
  // source, since seed.ts is committed to git and this becomes a permanent
  // leaked credential for anyone who reads the repo history.
  const adminEmail = process.env.SEED_ADMIN_EMAIL;
  const adminPhone = process.env.SEED_ADMIN_PHONE;
  const rawPassword = process.env.SEED_ADMIN_PASSWORD;

  if (!adminEmail || !adminPhone || !rawPassword) {
    throw new Error(
      "Missing SEED_ADMIN_EMAIL, SEED_ADMIN_PHONE, or SEED_ADMIN_PASSWORD env vars. " +
      "Set these (e.g. in a local .env, never committed) before running the seed script."
    );
  }

  if (rawPassword.length < 12) {
    throw new Error("SEED_ADMIN_PASSWORD must be at least 12 characters.");
  }

  // Check if admin already exists
  const existingAdmin = await prisma.user.findUnique({
    where: { email: adminEmail }
  });

  if (existingAdmin) {
    console.log("✅ Admin user already exists:", adminEmail);
    return;
  }

  // Hash Password
  const passwordHash = await bcrypt.hash(rawPassword, 10);

  // Create Super Admin User
  const admin = await prisma.user.create({
    data: {
      fullName: "Super Admin",
      email: adminEmail,
      phone: adminPhone,
      passwordHash: passwordHash,
      role: Role.ADMIN,
      country: "India",
      isActive: true
    }
  });

  console.log("🎉 Super Admin User created successfully!");
  console.log(`-------------------------------------------`);
  console.log(`📧 Email:    ${admin.email}`);
  console.log(`🔑 Password: ${rawPassword}`);
  console.log(`-------------------------------------------`);
}

main()
  .catch((e) => {
    console.error("❌ Seeding Error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
