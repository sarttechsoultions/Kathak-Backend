import { Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/prisma";
import process from "process";

async function main() {
  console.log("🌱 Seeding Admin User into PostgreSQL...");

  const adminEmail = "admin@kathakbyharshita.com";
  const adminPhone = "+919876543210";
  const rawPassword = "Admin@12345";

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
