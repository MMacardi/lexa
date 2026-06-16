import { PrismaClient } from "@prisma/client";

// A single shared PrismaClient for the whole process. Creating a new client per
// request would open a new connection pool each time and exhaust Postgres.
export const prisma = new PrismaClient();
