// Owner tool: mint a batch of single-use closed-beta invite codes. Run inside the
// backend container:
//   docker exec onomika-backend node scripts/generate-invites.mjs 10 "TG group"
// arg1 = how many codes (default 10, capped at 500); arg2 = optional note label.
// Prints the codes one per line — copy them straight to your testers.
import { randomInt } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Unambiguous alphabet: no I, O, 0, 1 (easy to read aloud / retype from a message).
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const block = (n) => Array.from({ length: n }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
const makeCode = () => `ONM-${block(4)}-${block(4)}`;

const count = Math.max(1, Math.min(500, parseInt(process.argv[2] ?? "10", 10) || 10));
const note = (process.argv[3] ?? "").trim() || null;

// Generate locally-unique codes; skipDuplicates is a belt-and-braces guard against
// a (vanishingly unlikely) collision with an existing row.
const codes = new Set();
while (codes.size < count) codes.add(makeCode());

const created = await prisma.inviteCode.createMany({
  data: [...codes].map((code) => ({ code, note, createdBy: "generate-invites.mjs" })),
  skipDuplicates: true,
});

console.log(`${created.count} invite code(s)${note ? ` — ${note}` : ""}:`);
for (const code of codes) console.log(code);

await prisma.$disconnect();
