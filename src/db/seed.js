import "./init-sqlite.js";
import { prisma } from "./client.js";
import { bootstrapLocalDatabase } from "./bootstrap.js";

async function seed() {
  const summary = await bootstrapLocalDatabase();
  console.log("Local database ready:", summary);
}

seed()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
