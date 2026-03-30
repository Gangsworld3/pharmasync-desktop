import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import prismaPkg from "@prisma/client";
import { getDatabaseUrl } from "../services/desktop-runtime.js";

const { PrismaClient } = prismaPkg;

const globalForPrisma = globalThis;

process.env.DATABASE_URL = getDatabaseUrl();
const adapter = new PrismaBetterSqlite3(
  { url: process.env.DATABASE_URL },
  { timestampFormat: "unixepoch-ms" }
);

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    adapter,
    log: ["error", "warn"]
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
