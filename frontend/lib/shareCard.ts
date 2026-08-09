// Render a printable flashcard (front + back faces, side by side) into one PNG
// using canvas — no external libraries. The faces mirror the app's card layout,
// so a tutor/learner can print, cut and fold physical cards.

import type { Word } from "./api";
import type { CardField, CardLayout } from "./learnPrefs";

const FONT = "Georgia, 'Noto Sans SC', 'Noto Sans', system-ui, serif";

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(/\s+/);
    let line = "";
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (ctx.measureText(test).width > maxWidth && line) {
        out.push(line);
        line = w;
      } else {
        line = test;
      }
    }
    out.push(line);
  }
  return out;
}

interface Face {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Draw one card face (a list of fields) centered in the given rect.
function drawFace(
  ctx: CanvasRenderingContext2D,
  face: Face,
  fields: CardField[],
  word: Word,
  labels: Record<string, string>,
) {
  const pad = 54;
  const cx = face.x + face.w / 2;
  const maxW = face.w - pad * 2;
  const ex = word.examples[0];

  // Build a list of drawing ops first so we can vertically center the block.
  type Op = { lines: string[]; size: number; color: string; italic?: boolean; upper?: boolean; gap: number; label?: string };
  const ops: Op[] = [];
  const push = (text: string | null | undefined, size: number, color: string, opts: Partial<Op> = {}) => {
    if (!text || !text.trim()) return;
    ctx.font = `${opts.italic ? "italic " : ""}600 ${size}px ${FONT}`;
    const t = opts.upper ? text.toUpperCase() : text;
    ops.push({ lines: wrap(ctx, t, maxW), size, color, gap: Math.round(size * 0.35), ...opts });
  };
  const list = (items: string[], label: string, color: string) => {
    if (!items.length) return;
    ops.push({ lines: [], size: 22, color: "#a89f8f", gap: 6, label });
    push(items.join(",  "), 30, color);
  };

  for (const f of fields) {
    switch (f) {
      case "word": push(word.word, 84, "#2e2a26"); break;
      case "phonetic": push(word.phonetic, 34, "#a89f8f"); break;
      case "pos": push(word.partOfSpeech, 24, "#a89f8f", { upper: true }); break;
      case "meaning": push(word.meaningZh, 46, "#3f5a4a"); break;
      case "example": if (ex) push(`“${ex.sentenceEn}”`, 30, "#544e45", { italic: true }); break;
      case "exampleTr": if (ex?.sentenceZh) push(ex.sentenceZh, 28, "#7a7266"); break;
      case "synonyms": list(word.synonyms, labels.synonyms, "#3f5a4a"); break;
      case "antonyms": list(word.antonyms, labels.antonyms, "#9c5f4e"); break;
      case "collocations": list(word.collocations, labels.collocations, "#544e45"); break;
      case "notes": push(word.notes, 28, "#544e45"); break;
    }
  }

  // total height
  let total = 0;
  for (const op of ops) total += (op.label ? 30 : 0) + op.lines.length * (op.size + op.gap);
  let cy = face.y + Math.max(80, (face.h - total) / 2) + 20;

  for (const op of ops) {
    if (op.label) {
      ctx.font = `600 22px ${FONT}`;
      ctx.fillStyle = "#a89f8f";
      ctx.textAlign = "center";
      ctx.fillText(op.label.toUpperCase(), cx, cy);
      cy += 30;
    }
    ctx.font = `${op.italic ? "italic " : ""}600 ${op.size}px ${FONT}`;
    ctx.fillStyle = op.color;
    ctx.textAlign = "center";
    for (const ln of op.lines) {
      cy += op.size;
      ctx.fillText(ln, cx, cy);
      cy += op.gap;
    }
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Render the front + back faces of a card into a single landscape PNG data URL. */
export function renderPrintableCard(word: Word, layout: CardLayout, labels: Record<string, string>): string {
  const W = 1680;
  const H = 1040;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  ctx.fillStyle = "#efeae1"; // sheet
  ctx.fillRect(0, 0, W, H);

  const gap = 60;
  const cw = (W - gap * 3) / 2;
  const ch = H - 200;
  const faces: { rect: Face; fields: CardField[]; tag: string }[] = [
    { rect: { x: gap, y: 100, w: cw, h: ch }, fields: layout.front, tag: labels.front },
    { rect: { x: gap * 2 + cw, y: 100, w: cw, h: ch }, fields: layout.back, tag: labels.back },
  ];

  for (const f of faces) {
    // card panel
    ctx.save();
    ctx.shadowColor = "rgba(46,42,38,0.16)";
    ctx.shadowBlur = 40;
    ctx.shadowOffsetY = 16;
    ctx.fillStyle = "#fcfbf8";
    roundRect(ctx, f.rect.x, f.rect.y, f.rect.w, f.rect.h, 40);
    ctx.fill();
    ctx.restore();
    // sage top accent
    ctx.fillStyle = "#7c9885";
    roundRect(ctx, f.rect.x, f.rect.y, f.rect.w, 10, 6);
    ctx.fill();
    // face tag
    ctx.font = `600 22px ${FONT}`;
    ctx.fillStyle = "#c3bbaa";
    ctx.textAlign = "left";
    ctx.fillText(f.tag.toUpperCase(), f.rect.x + 30, f.rect.y + 50);

    drawFace(ctx, f.rect, f.fields, word, labels);
  }

  // brand
  ctx.font = `600 34px ${FONT}`;
  ctx.fillStyle = "#7c9885";
  ctx.textAlign = "center";
  ctx.fillText("Lexa", W / 2, H - 45);

  return canvas.toDataURL("image/png");
}

/** Download a rendered data URL as a file. */
export function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  a.click();
}
