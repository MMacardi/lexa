// The card's one-line meaning (data/hsk-ru.jsonl) and its word page (data/hsk-pages.jsonl)
// in one order. The page's order was checked (the most common in modern Mandarin first,
// the 500 most polysemous read by hand); the one-line defaults were not, and 280 cards
// led with a rarer sense than their page (热 «нагревать; горячий», 地方 «местность;
// местный», 被 «одеяло; …»).
//
// Per word the check flags (check-word-pages.ts, "leads with a rarer sense"):
//   - most words: the card's parts (between ";") sorted by the page sense they open,
//     and if the page's first sense is still not on the card, and is read the card's
//     way, its first gloss goes in front;
//   - TRUST_CARD: read by hand the other way round — the card leads right and the
//     page's order is wrong (海 «океан» before «море», 不仅 «не просто»): the card
//     stays and the page's sense it opens with moves first;
//   - FIXED: the card's meaning was plain wrong (之所以 is not «поэтому»), written by hand.
// Every change was read by hand before it was written (1d's follow-up, 2026-09-29).
// The old meaning stays on the row ("o"), so a card that still carries it is moved to
// the new one (services/lookup.ts, `refreshDefaultMeanings`).
//   cd backend && npx tsx scripts/reorder-hsk-ru.ts          print what would change
//   cd backend && npx tsx scripts/reorder-hsk-ru.ts --write  and write both files
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const { hskPage, headGloss, readsAs } = await import("../src/services/wordPages.js");
const { HSK_VERSIONS, HSK_MAX_LEVEL, hskLevelWords } = await import("../src/services/hsk.js");
type WordPage = import("../src/services/wordPages.js").WordPage;

const WRITE = process.argv.includes("--write");
const ruFile = fileURLToPath(new URL("../data/hsk-ru.jsonl", import.meta.url));
const pagesFile = fileURLToPath(new URL("../data/hsk-pages.jsonl", import.meta.url));

const FIXED: Record<string, string> = {
  之所以: "причина того, что (之所以……是因为……)",
  炮: "пушка; петарда, фейерверк",
  球: "мяч; шар",
  合: "закрывать, соединять; подходить, соответствовать",
  西: "запад",
  行: "ладно, можно; идти; способный",
  会: "уметь; вероятно, будет; собрание",
  令: "приказывать; заставлять",
  刀: "нож",
};

const TRUST_CARD = new Set(
  "一块儿 一面 个别 同胞 大妈 摊儿 掉头 答应 退让 冲击 减压 海 海绵 钟 主人 天堂 屋子 不仅 不论 求 判 刨 垫底 填 展览 料理 无线电 机关 痴呆 积淀 纽带 美食 耕地".split(
    " ",
  ),
);

// The first gloss of a sense, not cutting inside brackets: «печатать (книги, журналы), …».
function firstGloss(m: string): string {
  let depth = 0;
  for (let i = 0; i < m.length; i++) {
    const ch = m[i];
    if (ch === "(" || ch === "（") depth++;
    else if (ch === ")" || ch === "）") depth = Math.max(0, depth - 1);
    else if (depth === 0 && (ch === "," || ch === "，" || ch === ";" || ch === "；")) return m.slice(0, i).trim();
  }
  return m.trim();
}

// Every gloss on a card, by its head: «убыток, дефицит» has «дефицит» too.
const glossHeads = (m: string) => new Set(m.split(/[;；,，]/).map((g) => headGloss(g)).filter(Boolean));

const reading = new Map<string, string>();
for (const v of HSK_VERSIONS)
  for (let n = 1; n <= HSK_MAX_LEVEL[v]; n++) for (const e of hskLevelWords(v, n)) if (!reading.has(e.word)) reading.set(e.word, e.pinyin);

const pageMoves = new Map<string, number>(); // word → index of the page sense to move first
let changed = 0;
const ruOut = readFileSync(ruFile, "utf8")
  .split("\n")
  .map((line) => {
    if (!line.trim()) return line;
    const row = JSON.parse(line) as { s?: string; m?: string; o?: string[] };
    if (!row.s || !row.m) return line;
    const page = hskPage(row.s, "ru");
    if (!page) return line;
    const pageHeads = page.s.map((s) => headGloss(s.m));
    // A part that lists two of the page's senses by comma (挣 «вырываться, зарабатывать»)
    // is two senses: split where a gloss opens another page sense, the rest stay with
    // the one before (课 «предмет, курс, урок» → «предмет, курс» + «урок»).
    const parts = [
      ...new Set(
        row.m
          .split(/[;；]/)
          .map((p) => p.trim())
          .filter(Boolean)
          .flatMap((p) => {
            const glosses = p.split(/[,，](?![^(（]*[)）])/).map((g) => g.trim()).filter(Boolean);
            const hits = new Set(glosses.map((g) => pageHeads.indexOf(headGloss(g))).filter((i) => i >= 0));
            if (TRUST_CARD.has(row.s) || hits.size < 2) return [p];
            const groups: string[][] = [];
            const opened = new Set<number>();
            for (const g of glosses) {
              const i = pageHeads.indexOf(headGloss(g));
              if (i >= 0 && !opened.has(i)) {
                opened.add(i);
                groups.push([g]);
              } else if (groups.length) groups[groups.length - 1].push(g);
              else groups.push([g]);
            }
            return groups.map((g) => g.join(", "));
          }),
      ),
    ];
    const first = headGloss(parts[0] ?? "");
    const wrongFirst =
      Boolean(first) && pageHeads[0] !== first && (pageHeads.includes(first) || parts.length !== row.m.split(/[;；]/).filter((p) => p.trim()).length);
    if (TRUST_CARD.has(row.s)) {
      if (wrongFirst) {
        // Keyed by the page's own word: 一块儿's page is kept under 一块.
        pageMoves.set(page.w, pageHeads.indexOf(first));
        console.log(`${row.s}  page: «${page.s[pageHeads.indexOf(first)].m}» moves before «${page.s[0].m}»`);
      }
      return line;
    }
    let next: string | null = FIXED[row.s] ?? null;
    if (!next && wrongFirst) {
      const at = (p: string) => {
        const i = pageHeads.indexOf(headGloss(p));
        return i < 0 ? Infinity : i;
      };
      const sorted = parts.map((p, i) => ({ p, i })).sort((a, b) => at(a.p) - at(b.p) || a.i - b.i).map((x) => x.p);
      const lead = page.s[0];
      const cardReading = reading.get(row.s);
      const leadGloss = firstGloss(lead.m);
      if (
        headGloss(sorted[0]) !== pageHeads[0] &&
        !glossHeads(sorted.join(";")).has(headGloss(leadGloss)) &&
        (!cardReading || !lead.r || readsAs(row.s, lead.r, cardReading))
      )
        sorted.unshift(leadGloss);
      next = sorted.join("; ");
    }
    if (!next || next === row.m) return line;
    changed++;
    console.log(`${row.s}  «${row.m}»  →  «${next}»`);
    return JSON.stringify({ ...row, m: next, o: [...new Set([...(row.o ?? []), row.m])] });
  });

let moved = 0;
const pagesOut = readFileSync(pagesFile, "utf8")
  .split("\n")
  .map((line) => {
    if (!line.trim()) return line;
    const p = JSON.parse(line) as WordPage;
    const i = p.w ? pageMoves.get(p.w) : undefined;
    if (i === undefined || i <= 0) return line;
    moved++;
    return JSON.stringify({ ...p, s: [p.s[i], ...p.s.filter((_, k) => k !== i)] });
  });

console.log(`\n${changed} card meanings changed; ${moved} pages reordered to their card`);
if (WRITE) {
  writeFileSync(ruFile, ruOut.join("\n"));
  writeFileSync(pagesFile, pagesOut.join("\n"));
  console.log(`wrote ${ruFile} and ${pagesFile}`);
}
