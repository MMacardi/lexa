// Incremental extractor for one string value out of a streaming JSON reply.
//
// The chat endpoints ask the model for a JSON object whose FIRST key holds the
// conversational reply ("say" for the coach, "answer" for Mika). While the raw JSON
// arrives token-by-token we want to forward that text to the client immediately, so it
// types out live, even though the surrounding JSON (used/seeded/addWords/...) is still
// incomplete.
//
// createFieldExtractor(emit, field) returns { push(raw) }: call push() with the FULL
// accumulated raw buffer after every stream chunk. The extractor finds `"<field>":"`, decodes the JSON
// string value incrementally, and emits only the newly-decoded tail. A trailing partial
// escape (a lone `\` or `\u` with fewer than 4 hex digits) is held back until the next
// push so we never emit half an escape sequence. The full raw buffer is still parsed and
// schema-validated separately once the stream ends — this extractor only drives the live
// text deltas and never needs to produce valid JSON itself.
//
// Rescanning the value from its start on every push is O(n²), but n is ~1-3 KB here, so
// it is trivially cheap and keeps the logic stateless and robust to chunk boundaries.
//
// Emitted text goes through fixMixedScript (a stray Cyrillic "о" inside an English
// word, or the reverse). That needs whole words, so a word still arriving is held
// back until a non-letter or the closing quote follows it.

import { fixMixedScript, TRAILING_WORD } from "./scriptMix.js";

export interface FieldExtractor {
  push(raw: string): void;
}

export function createFieldExtractor(emit: (chunk: string) => void, field = "say"): FieldExtractor {
  const keyRe = new RegExp(`"${field}"\\s*:\\s*"`);
  let valueStart = -1; // index in raw of the first char of the string value
  let closed = false; // found the unescaped closing quote
  let emittedLen = 0; // how many decoded chars we have already emitted

  // Decode the JSON string value starting at `start`. Stops at the closing quote
  // (closed=true) or at the end of the available raw / a partial trailing escape
  // (closed=false), so the caller can resume on the next push.
  function decodeFrom(raw: string, start: number): { text: string; closed: boolean } {
    let out = "";
    let i = start;
    while (i < raw.length) {
      const ch = raw[i];
      if (ch === '"') return { text: out, closed: true };
      if (ch === "\\") {
        if (i + 1 >= raw.length) return { text: out, closed: false }; // lone trailing backslash
        const esc = raw[i + 1];
        switch (esc) {
          case '"': out += '"'; i += 2; break;
          case "\\": out += "\\"; i += 2; break;
          case "/": out += "/"; i += 2; break;
          case "b": out += "\b"; i += 2; break;
          case "f": out += "\f"; i += 2; break;
          case "n": out += "\n"; i += 2; break;
          case "r": out += "\r"; i += 2; break;
          case "t": out += "\t"; i += 2; break;
          case "u": {
            if (i + 5 >= raw.length) return { text: out, closed: false }; // partial \uXXXX
            const hex = raw.slice(i + 2, i + 6);
            if (/^[0-9a-fA-F]{4}$/.test(hex)) {
              out += String.fromCharCode(parseInt(hex, 16));
              i += 6;
            } else {
              // Malformed escape: emit literally and move on rather than stalling.
              out += "\\u" + hex;
              i += 6;
            }
            break;
          }
          default:
            // Unknown escape — be lenient, emit the escaped char itself.
            out += esc;
            i += 2;
            break;
        }
        continue;
      }
      out += ch;
      i += 1;
    }
    return { text: out, closed: false };
  }

  return {
    push(raw: string) {
      if (closed) return;
      if (valueStart < 0) {
        const m = keyRe.exec(raw);
        if (!m) return; // the key has not arrived yet — deltas simply start later
        valueStart = m.index + m[0].length;
      }
      const decoded = decodeFrom(raw, valueStart);
      closed = decoded.closed;
      const text = fixMixedScript(closed ? decoded.text : decoded.text.replace(TRAILING_WORD, ""));
      if (text.length > emittedLen) {
        const chunk = text.slice(emittedLen);
        emittedLen = text.length;
        emit(chunk);
      }
    },
  };
}
