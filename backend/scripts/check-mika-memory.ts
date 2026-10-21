// Local-only lifecycle checks. Injected extraction makes race/retry evidence
// deterministic; the separate browser check exercises real Qwen personalization.
import assert from "node:assert/strict";
import { prisma } from "../src/services/db.js";
import { memorySnapshot, checkpointMemory, processMemoryUpdates } from "../src/services/mikaMemory.js";
import { getProfile, updateProfile } from "../src/services/coachMemory.js";
import { scheduleDeletion, cancelDeletion, deleteAccount } from "../src/services/accountData.js";

assert.match(process.env.DATABASE_URL ?? "", /(?:localhost:5433|@db:5432)\//, "Local Docker DB only");
const prefix = `memory-check-${Date.now()}`;
const ids = [prefix + "-a", prefix + "-b"];
type Turn = { role: "user" | "assistant"; content: string };
const turn = (text: string): Turn[] => [{ role: "user", content: text }, { role: "assistant", content: "Completed reply" }];
const ready = () => prisma.coachMemoryUpdate.updateMany({
  where: { memory: { user: { telegramId: { in: ids } } }, state: "pending" },
  data: { availableAt: new Date(0) },
});
const notes = async () => (await getProfile(ids[0], "zh")).notes;
const checkpoint = async (text: string, chat = "test-chat") => checkpointMemory(await memorySnapshot(ids[0], "zh"), turn(text), chat);
const pass = (label: string) => console.log(`PASS ${label}`);

try {
  await prisma.user.createMany({ data: ids.map((telegramId) => ({ telegramId, invited: true })) });
  await checkpoint("Китайский: предпочитаю короткие примеры про поезда.");
  const sameInput = turn("Китайский: предпочитаю короткие примеры про поезда.");
  sameInput[1].content = "Different wording after a retried request";
  await checkpointMemory(await memorySnapshot(ids[0], "zh"), sameInput, "test-chat");
  await checkpointMemory(await memorySnapshot(ids[0], "zh"), [{ role: "user", content: "Incomplete turn must not be learned" }]);
  assert.equal(await prisma.coachMemoryUpdate.count({ where: { memory: { user: { telegramId: ids[0] } } } }), 1);
  await ready();
  await processMemoryUpdates(async ({ statements }) => {
    assert.deepEqual(statements, ["Китайский: предпочитаю короткие примеры про поезда."]);
    return "Предпочитает короткие примеры про поезда.";
  });
  assert.match(await notes(), /поезда/);
  assert.equal((await getProfile(ids[1], "zh")).notes, "");
  assert.equal((await getProfile(ids[0], "en")).notes, "");
  assert.equal(await prisma.coachMemoryUpdate.count({ where: { transcript: { not: "" }, memory: { user: { telegramId: ids[0] } } } }), 0);
  pass("persisted completed turn; duplicate checkpoint; account/language isolation; transcript disposal");

  // Clear during extraction, then retry both the same save and an old ask snapshot.
  const old = await memorySnapshot(ids[0], "zh");
  await checkpoint("Я люблю чай."); await ready();
  await processMemoryUpdates(async () => {
    await updateProfile(ids[0], "zh", { notes: "" });
    return "Stale train and tea preferences";
  });
  assert.equal(await notes(), "");
  await checkpointMemory(old, turn("Another late reply"));
  await checkpoint("Китайский: предпочитаю короткие примеры про поезда.");
  await ready();
  assert.equal(await processMemoryUpdates(async () => { throw new Error("Cleared work must not run"); }), false);
  pass("clear invalidates in-flight extraction, late completed replies, duplicate saves and old history");

  await checkpoint("Я хочу больше примеров про самолёты."); await ready();
  await processMemoryUpdates(async () => {
    await updateProfile(ids[0], "zh", { notes: "Моя правка: короткие примеры про лодки." });
    return "Stale planes";
  });
  assert.equal(await notes(), "Моя правка: короткие примеры про лодки.");
  await checkpoint("Мне трудно различать второй и третий тон."); await ready();
  await processMemoryUpdates(async ({ pinned }) => {
    assert.match(pinned, /лодки/);
    return "Путает второй и третий тон.";
  });
  assert.match(await notes(), /^Моя правка: короткие примеры про лодки\.\nПутает/);
  pass("explicit edits beat in-flight summaries and remain pinned through future learning");

  // Two workers read the same prior summary. A newer one wins; the older retries
  // against that result instead of overwriting it.
  await checkpoint("Concurrent one"); await ready();
  let newer = false;
  await processMemoryUpdates(async () => {
    await checkpoint("Concurrent two"); await ready();
    await processMemoryUpdates(async () => { newer = true; return "NEWER"; });
    return "OLDER";
  });
  assert.ok(newer); assert.match(await notes(), /NEWER/); assert.doesNotMatch(await notes(), /OLDER/);
  await ready(); await processMemoryUpdates(async ({ existing }) => `${existing}; RETRIED`);
  assert.match(await notes(), /NEWER; RETRIED/);
  pass("concurrent summaries use compare-and-swap; conflict retries preserve newer notes");

  await checkpoint("Retryable extraction"); await ready();
  await processMemoryUpdates(async () => { throw new Error("intentional transient extraction failure"); });
  await ready(); await processMemoryUpdates(async () => "Recovered");
  assert.match(await notes(), /Recovered/);
  await checkpoint("Crash recovery"); await ready();
  await prisma.coachMemoryUpdate.updateMany({
    where: { state: "pending", memory: { user: { telegramId: ids[0] } } },
    data: { state: "dead-worker-lease", availableAt: new Date(0) },
  });
  await processMemoryUpdates(async () => "Lease recovered");
  assert.match(await notes(), /Lease recovered/);
  pass("retry after transient failure; expired worker lease survives process restart");

  await checkpointMemory(await memorySnapshot(ids[0], "zh"), [
    { role: "user", content: 'Reader passage: "I live in Paris"' },
    { role: "assistant", content: "Speculation: the learner lives in Paris and likes cars" },
    ...turn("Объясни слово 到达."),
  ], "reader-context-check");
  await ready();
  await processMemoryUpdates(async ({ existing, statements }) => {
    assert.deepEqual(statements, ["Объясни слово 到达."]);
    assert.doesNotMatch(JSON.stringify(statements), /Paris|cars/);
    return existing;
  });
  await checkpoint("Fail three times");
  for (let i = 0; i < 3; i++) {
    await ready();
    await processMemoryUpdates(async () => { throw new Error("intentional permanent extraction failure"); });
  }
  await ready();
  assert.equal(await processMemoryUpdates(async () => { throw new Error("No fourth retry"); }), false);
  pass("earlier Reader/assistant claims excluded; permanent failures stop after three attempts");

  await checkpoint("Delete pending"); await ready();
  const beforeDelete = await memorySnapshot(ids[0], "zh");
  await processMemoryUpdates(async () => {
    await scheduleDeletion(ids[0]);
    await cancelDeletion(ids[0]);
    return "Stale after deletion request";
  });
  assert.doesNotMatch(await notes(), /Stale after/);
  await checkpointMemory(beforeDelete, turn("Late after restore"));
  await ready(); await processMemoryUpdates(async () => { throw new Error("Cancelled deletion jobs must not extract"); });
  await checkpoint("Hard delete pending"); await ready();
  await processMemoryUpdates(async () => {
    await deleteAccount(ids[0]);
    return "Resurrection";
  });
  await checkpointMemory(beforeDelete, turn("Late after hard delete"));
  await updateProfile(ids[0], "zh", { notes: "Late explicit write" });
  assert.equal(await prisma.user.count({ where: { telegramId: ids[0] } }), 0);
  assert.equal(await prisma.coachMemoryUpdate.count({ where: { memoryId: beforeDelete!.id } }), 0);
  // Reusing the login identifier creates a different account and memory ID.
  await prisma.user.create({ data: { telegramId: ids[0] } });
  await checkpointMemory(beforeDelete, turn("Old account reply"));
  assert.equal(await notes(), "");
  pass("scheduled deletion/restore and hard deletion invalidate updates; cascades and no account resurrection");
} finally {
  for (const id of ids) await deleteAccount(id);
  await prisma.$disconnect();
}
