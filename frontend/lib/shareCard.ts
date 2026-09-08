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

type Block = { label?: string; text: string; size: number; color: string; italic?: boolean; upper?: boolean };

// Draw one card face (its fields), scaled down if needed so everything fits and
// nothing overlaps. Uses textBaseline="top" for predictable line stacking.
function drawFace(
  ctx: CanvasRenderingContext2D,
  face: Face,
  fields: CardField[],
  word: Word,
  labels: Record<string, string>,
) {
  const padX = 54;
  const padTop = 78;
  const padBottom = 40;
  const cx = face.x + face.w / 2;
  const maxW = face.w - padX * 2;
  const ex = word.examples[0];

  const blocks: Block[] = [];
  const add = (text: string | null | undefined, size: number, color: string, opts: Partial<Block> = {}) => {
    if (!text || !text.trim()) return;
    blocks.push({ text: opts.upper ? text.toUpperCase() : text, size, color, ...opts });
  };
  const addList = (items: string[], label: string, color: string) => {
    if (items.length) blocks.push({ label, text: items.join(",  "), size: 28, color });
  };

  for (const f of fields) {
    switch (f) {
      case "word": add(word.word, 82, "#2e2a26"); break;
      case "phonetic": add(word.phonetic, 34, "#a89f8f"); break;
      case "pos": add(word.partOfSpeech, 24, "#a89f8f", { upper: true }); break;
      case "meaning": add(word.meaningZh, 46, "#3f5a4a"); break;
      case "example": if (ex) add(`“${ex.sentenceEn}”`, 30, "#544e45", { italic: true }); break;
      case "exampleTr": if (ex?.sentenceZh) add(ex.sentenceZh, 28, "#7a7266"); break;
      case "synonyms": addList(word.synonyms, labels.synonyms, "#3f5a4a"); break;
      case "antonyms": addList(word.antonyms, labels.antonyms, "#9c5f4e"); break;
      case "collocations": addList(word.collocations, labels.collocations, "#544e45"); break;
      case "notes": add(word.notes, 28, "#544e45"); break;
    }
  }

  const availH = face.h - padTop - padBottom;
  const LABEL = 20; // label font px @ scale 1
  const BLOCK_GAP = 18; // space between fields @ scale 1

  // Measure the whole stack at a given scale.
  const measure = (scale: number) => {
    let h = 0;
    const laid: { b: Block; lines: string[]; lineH: number; labelH: number }[] = [];
    for (const b of blocks) {
      ctx.font = `${b.italic ? "italic " : ""}600 ${Math.round(b.size * scale)}px ${FONT}`;
      const lines = wrap(ctx, b.text, maxW);
      const lineH = Math.round(b.size * scale * 1.26);
      const labelH = b.label ? Math.round(LABEL * scale) + Math.round(8 * scale) : 0;
      laid.push({ b, lines, lineH, labelH });
      h += labelH + lines.length * lineH + Math.round(BLOCK_GAP * scale);
    }
    return { h, laid };
  };

  let scale = 1;
  let { h, laid } = measure(1);
  if (h > availH) {
    scale = Math.max(0.4, availH / h);
    ({ h, laid } = measure(scale));
  }

  // Clip to the card's content area so an over-long example (e.g. a full dialogue)
  // is cut at the card edge instead of spilling outside it.
  ctx.save();
  ctx.beginPath();
  ctx.rect(face.x, face.y + padTop - 22, face.w, availH + 22);
  ctx.clip();

  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  let cy = face.y + padTop + Math.max(0, (availH - h) / 2);
  for (const { b, lines, lineH } of laid) {
    if (b.label) {
      ctx.font = `600 ${Math.round(LABEL * scale)}px ${FONT}`;
      ctx.fillStyle = "#a89f8f";
      ctx.fillText(b.label.toUpperCase(), cx, cy);
      cy += Math.round(LABEL * scale) + Math.round(8 * scale);
    }
    ctx.font = `${b.italic ? "italic " : ""}600 ${Math.round(b.size * scale)}px ${FONT}`;
    ctx.fillStyle = b.color;
    for (const ln of lines) {
      ctx.fillText(ln, cx, cy);
      cy += lineH;
    }
    cy += Math.round(BLOCK_GAP * scale);
  }
  ctx.restore();
  ctx.textBaseline = "alphabetic"; // reset for other draws (tags, brand)
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
  ctx.fillText("Onomika", W / 2, H - 45);

  return canvas.toDataURL("image/png");
}

/** Download a rendered data URL as a file. */
export function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  a.click();
}
