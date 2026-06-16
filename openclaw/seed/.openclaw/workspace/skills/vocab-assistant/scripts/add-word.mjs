// Cross-platform skill script: add a word via the Vocab Assistant REST API.
// Usage: node add-word.mjs "<word>" "<telegramId>"
const API = process.env.VOCAB_API_URL || "http://localhost:3000";
const word = (process.argv[2] || "").trim();
const telegramId = (process.argv[3] || process.env.VOCAB_TELEGRAM_ID || "dev-user").trim();

if (!word) {
  console.log('Usage: add-word.mjs "<word>" "<telegramId>"');
  process.exit(1);
}

try {
  const res = await fetch(`${API}/api/words`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ word, telegramId }),
  });
  if (!res.ok) {
    console.log(`Couldn't add "${word}": ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  const w = await res.json();
  const ex = (w.examples || [])[0];
  const lines = [];
  let header = w.word;
  if (w.phonetic) header += `  ${w.phonetic}`;
  if (w.partOfSpeech) header += `  (${w.partOfSpeech})`;
  lines.push(header);
  if (w.meaningZh) lines.push(w.meaningZh);
  if (ex) {
    lines.push("", ex.sentenceEn, ex.sentenceZh, `- ${ex.sourceName}: ${ex.sourceUrl}`);
  }
  if (w.collocations?.length) lines.push(`Collocations: ${w.collocations.join(", ")}`);
  if (w.synonyms?.length) lines.push(`Synonyms: ${w.synonyms.join(", ")}`);
  if (w.antonyms?.length) lines.push(`Antonyms: ${w.antonyms.join(", ")}`);
  console.log(lines.join("\n"));
} catch (e) {
  console.log(`Couldn't add "${word}": ${e.message}`);
  process.exit(1);
}
