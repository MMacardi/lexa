// Download public native pronunciation references only; no DB or TTS calls.
// From backend: npx tsx scripts/inspect-native-words.ts
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const root = fileURLToPath(new URL("../../.playwright-cli/word-audio/native/", import.meta.url));
await fs.mkdir(root, { recursive: true });
const repository = "hugolpz/audio-cmn";
const headers = { "User-Agent": "Onomika pronunciation investigation" };
async function download(url: string) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Download ${response.status}: ${url}`);
  return Buffer.from(await response.arrayBuffer());
}
const oldManifest = JSON.parse(await fs.readFile(path.join(root, "manifest.json"), "utf8").catch(() => "null"));
const commit = oldManifest?.commit || "59dbafbda8b172ffc3b8b295cd5938ae1b3de803";
if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error("Expected pinned source commit");
const sourceBase = `https://raw.githubusercontent.com/${repository}/${commit}/`;
const readme = await download(`${sourceBase}README.md`);
await fs.writeFile(path.join(root, "SOURCE-README.md"), readme);
const texts = ["序", "顺", "味", "去", "顺序", "味道", "儿"];
const readings: Record<string, string> = { "序": "xu4", "顺": "shun4", "味": "wei4", "去": "qu4", "儿": "er2" };
const fixtures: { text: string; kind: string; speaker: string; file: string; url: string; sha256?: string; bytes?: number; error?: string }[] = [];
for (const [index, text] of texts.entries()) {
  const candidates = [
    { kind: "word", speaker: "Yue Tan", sourcePath: `96k/hsk/cmn-${text}.mp3`, file: `${index + 1}-N.mp3` },
    ...(readings[text] ? [{ kind: "syllable", speaker: "Chen Wang", sourcePath: `64k/syllabs/cmn-${readings[text]}.mp3`, file: `${index + 1}-P.mp3` }] : []),
  ];
  for (const candidate of candidates) {
    const { kind, speaker, file, sourcePath } = candidate;
    const url = `${sourceBase}${encodeURI(sourcePath)}`;
    const previous = oldManifest?.fixtures?.find((f: { url: string }) => f.url === url);
    if (previous?.error?.startsWith("Download 404:")) { fixtures.push(previous); continue; }
    try {
      let audio = previous?.sha256 ? await fs.readFile(path.join(root, file)).catch(() => null) : null;
      if (!audio || createHash("sha256").update(audio).digest("hex") !== previous.sha256) audio = await download(url);
      if (audio.length < 500 || (audio.toString("ascii", 0, 3) !== "ID3" && audio[0] !== 255)) throw new Error("Expected MP3");
      await fs.writeFile(path.join(root, file), audio);
      const row = { text, kind, speaker, file, url, sha256: createHash("sha256").update(audio).digest("hex"), bytes: audio.length };
      fixtures.push(row); console.log(JSON.stringify(row));
    } catch (error) {
      fixtures.push({ text, kind, speaker, file, url, error: error instanceof Error ? error.message : String(error) });
    }
  }
}
const manifest = { repository, commit, license: "CC BY-SA as stated by source README; version unspecified there; no production integration", processing: "Downloaded MP3 bytes unchanged", credits: "Speakers Yue Tan and Chen Wang; Hugo Lopez, PLIDAM, INALCO; Nicolas Vion", fixtures };
await fs.writeFile(path.join(root, "manifest.json"), JSON.stringify(manifest, null, 2));
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
await fs.writeFile(path.join(root, "index.html"), `<!doctype html><meta charset="utf-8"><title>Native pronunciation references</title>
<style>body{font:18px system-ui;max-width:1100px;margin:24px auto;padding:12px}.row{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:16px}article{padding:18px 0;border-bottom:1px solid #aaa}audio{width:100%}small{display:block;font-size:14px}</style>
<h1>Отдельные слова: записи носителей</h1><p>Начните с <b>1-P</b> (xù), затем сравните с 1-C. Записи самого иероглифа 序 в словарном наборе нет; 1-P — отдельный слог xu4. N — Yue Tan, запись слова; P — Chen Wang, запись слога с тоном. A/C — синтез Zhijia для сравнения. Везде воспроизведение 1×, без обрезки и изменения высоты тона. Это сравнение, не новые голоса приложения.</p>
<p>Источник: <a href="https://github.com/${repository}/tree/${commit}">Audio-cmn</a>, CC BY-SA (версия не указана в README). Голоса: Yue Tan, Chen Wang. Подготовка: Hugo Lopez, PLIDAM, INALCO; Nicolas Vion. <a href="SOURCE-README.md">Сведения источника</a>. Загруженные MP3 не изменены.</p>
${texts.map((text, index) => `<article><h2>${index + 1}. ${escape(text)} ${escape(readings[text] || "")}</h2><div class="row">${fixtures.filter(f => f.text === text && !f.error).map(f => `<label><b>${index + 1}-${f.kind === "word" ? "N" : "P"}</b><small>${escape(f.speaker)} · ${f.kind === "word" ? "слово" : "слог"} · <a href="${escape(f.url)}">источник</a></small><audio controls preload="metadata" src="${f.file}"></audio></label>`).join("")}${index < 6 ? `<label><b>${index + 1}-A</b><small>Zhijia, темп синтеза 1.0</small><audio controls preload="metadata" src="../engines/listen-F1-${escape(text)}.wav"></audio></label><label><b>${index + 1}-C</b><small>Zhijia, темп синтеза 1.25</small><audio controls preload="metadata" src="../engines/listen-H2-${escape(text)}.wav"></audio></label>` : ""}</div></article>`).join("\n")}
<script>document.addEventListener('play',e=>{document.querySelectorAll('audio').forEach(a=>{if(a!==e.target)a.pause()})},true)</script>`);
console.log(JSON.stringify({ commit, downloaded: fixtures.filter(f => !f.error).length, missing: fixtures.filter(f => f.error).map(f => ({ text: f.text, kind: f.kind, error: f.error })) }));
