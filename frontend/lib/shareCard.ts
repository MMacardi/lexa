// Render a word into a shareable square PNG (e.g. for stories) using canvas,
// then trigger a download. No external libraries.

interface CardData {
  word: string;
  phonetic?: string | null;
  partOfSpeech?: string | null;
  meaning?: string | null;
  example?: string | null;
  source?: string | null;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export function downloadShareCard(data: CardData) {
  const S = 1080;
  const canvas = document.createElement("canvas");
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // background
  ctx.fillStyle = "#f4f1ec";
  ctx.fillRect(0, 0, S, S);
  ctx.fillStyle = "#fcfbf8";
  ctx.fillRect(70, 70, S - 140, S - 140);

  const cx = S / 2;
  let yPos = 250;

  // part of speech
  if (data.partOfSpeech) {
    ctx.fillStyle = "#a89f8f";
    ctx.font = "600 30px Georgia, serif";
    ctx.textAlign = "center";
    ctx.fillText(data.partOfSpeech.toUpperCase(), cx, yPos);
    yPos += 70;
  }

  // word
  ctx.fillStyle = "#2e2a26";
  ctx.font = "600 110px Georgia, serif";
  ctx.textAlign = "center";
  ctx.fillText(data.word, cx, yPos + 70);
  yPos += 160;

  // phonetic
  if (data.phonetic) {
    ctx.fillStyle = "#a89f8f";
    ctx.font = "400 40px Georgia, serif";
    ctx.fillText(data.phonetic, cx, yPos);
    yPos += 70;
  }

  // meaning
  if (data.meaning) {
    ctx.fillStyle = "#3f5a4a";
    ctx.font = "600 52px Georgia, serif";
    for (const ln of wrap(ctx, data.meaning, S - 260)) {
      ctx.fillText(ln, cx, yPos);
      yPos += 64;
    }
    yPos += 30;
  }

  // example — clamped so it never collides with the footer
  if (data.example) {
    const lineH = 50;
    const footerTop = S - 165; // keep clear space for the brand block
    const maxLines = Math.max(0, Math.floor((footerTop - yPos) / lineH));
    if (maxLines > 0) {
      ctx.fillStyle = "#544e45";
      ctx.font = "italic 400 36px Georgia, serif";
      let lines = wrap(ctx, `“${data.example}”`, S - 300);
      if (lines.length > maxLines) {
        lines = lines.slice(0, maxLines);
        lines[maxLines - 1] = lines[maxLines - 1].replace(/[”"]?$/, "") + "…”";
      }
      for (const ln of lines) {
        ctx.fillText(ln, cx, yPos);
        yPos += lineH;
      }
    }
  }

  // footer brand (anchored to the bottom)
  ctx.fillStyle = "#7c9885";
  ctx.font = "600 42px Georgia, serif";
  ctx.fillText("Lexa", cx, S - 110);
  if (data.source) {
    ctx.fillStyle = "#a89f8f";
    ctx.font = "400 26px Georgia, serif";
    ctx.fillText(data.source, cx, S - 75);
  }

  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lexa-${data.word}.png`;
    a.click();
    URL.revokeObjectURL(url);
  });
}
