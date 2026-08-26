import { Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/prisma";
import { upsertAcademyCourses } from "../src/lib/academy-courses";
import { ensureHeroBanners } from "../src/lib/hero-banners";
import { ensureLeadPopup } from "../src/lib/lead-popup";
// use the global `process` provided by Node.js

async function seedAdmin() {
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

async function main() {
  await seedAdmin();
  console.log("🌱 Syncing academy courses into admin catalog...");
  const results = await upsertAcademyCourses();
  for (const result of results) {
    console.log(`  ${result.action === "created" ? "➕" : "♻️ "} ${result.slug} (${result.id})`);
  }
  console.log("✅ Academy courses saved.");
  console.log("🌱 Ensuring default hero banners...");
  await ensureHeroBanners();
  console.log("✅ Hero banners ready.");
  console.log("🌱 Ensuring lead popup settings...");
  await ensureLeadPopup();
  console.log("✅ Lead popup ready.");
}

main()
  .catch((e) => {
    console.error("❌ Seeding Error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
