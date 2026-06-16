// Cross-platform skill script: list a user's words via the Vocab Assistant REST API.
// Usage: node list-words.mjs "<telegramId>"
const API = process.env.VOCAB_API_URL || "http://localhost:3000";
const telegramId = (process.argv[2] || process.env.VOCAB_TELEGRAM_ID || "dev-user").trim();

try {
  const res = await fetch(`${API}/api/words?telegramId=${encodeURIComponent(telegramId)}`);
  if (!res.ok) {
    console.log(`Couldn't fetch words: ${res.status}`);
    process.exit(1);
  }
  const words = await res.json();
  if (!Array.isArray(words) || words.length === 0) {
    console.log("No saved words yet. Try: add resilience");
    process.exit(0);
  }
  const out = [`Your words (${words.length}):`];
  for (const w of words) out.push(`* ${w.word}${w.meaningZh ? " - " + w.meaningZh : ""}`);
  console.log(out.join("\n"));
} catch (e) {
  console.log(`Couldn't fetch words: ${e.message}`);
  process.exit(1);
}
