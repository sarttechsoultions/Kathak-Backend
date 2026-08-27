import { PrismaClient } from "@prisma/client";
import { env } from "../config/env";

/** Stay under Supabase session-mode pool_size (15). Default Prisma pool is ~num_cpus*2+1. */
const CONNECTION_LIMIT = 5;

function withConnectionLimit(databaseUrl: string): string {
  try {
    const url = new URL(databaseUrl);
    if (!url.searchParams.has("connection_limit")) {
      url.searchParams.set("connection_limit", String(CONNECTION_LIMIT));
    }
    if (!url.searchParams.has("pool_timeout")) {
      url.searchParams.set("pool_timeout", "20");
    }
    return url.toString();
  } catch {
    const separator = databaseUrl.includes("?") ? "&" : "?";
    return `${databaseUrl}${separator}connection_limit=${CONNECTION_LIMIT}&pool_timeout=20`;
  }
}

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  prismaShutdownRegistered?: boolean;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: env.nodeEnv === "development" ? ["error", "warn"] : ["error"],
    datasources: {
      db: { url: withConnectionLimit(env.databaseUrl) },
    },
  });

globalForPrisma.prisma = prisma;

if (!globalForPrisma.prismaShutdownRegistered) {
  globalForPrisma.prismaShutdownRegistered = true;

  const disconnect = () => prisma.$disconnect();

  process.on("beforeExit", () => {
    void disconnect();
  });
  process.once("SIGINT", () => {
    void disconnect().finally(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    void disconnect().finally(() => process.exit(0));
  });
}
