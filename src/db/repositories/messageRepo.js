import { prisma } from "../client.js";

const activeOnly = { deletedAt: null };

export function listMessages() {
  return prisma.message.findMany({
    where: activeOnly,
    include: { client: true },
    orderBy: { createdAt: "desc" }
  });
}
