import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import { env } from "../lib/env.js";

export const WORD_TTS_MODEL = process.env.BAILIAN_WORD_TTS_MODEL || "sambert-zhijia-v1";
// Author-reviewed native synthesis settings; playback remains at 1×.
export const wordSpeechRate = (text: string) => [...text].length === 1 ? 1.25 : 1;

/** Sambert accepts the whole text in run-task and streams WAV bytes back. */
export async function wordWav(text: string): Promise<Buffer> {
  if (!env.BAILIAN_API_KEY) throw new Error("BAILIAN_API_KEY is not set — add it to backend/.env");
  const endpoint = `${new URL(env.BAILIAN_BASE_URL).origin.replace(/^http/, "ws")}/api-ws/v1/inference`;
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(endpoint, {
      headers: { Authorization: `Bearer ${env.BAILIAN_API_KEY}` },
      handshakeTimeout: 15_000,
      maxPayload: 2 * 1024 * 1024,
    });
    const taskId = randomUUID(), chunks: Buffer[] = [];
    let settled = false, bytes = 0;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ws.terminate();
      if (error) reject(error);
      else if (!bytes) reject(new Error("Word TTS returned no audio"));
      else resolve(Buffer.concat(chunks));
    };
    const timer = setTimeout(() => finish(new Error("Word TTS timed out")), 30_000);
    ws.on("open", () => {
      ws.send(JSON.stringify({
        header: { action: "run-task", task_id: taskId, streaming: "out" },
        payload: {
          task_group: "audio", task: "tts", function: "SpeechSynthesizer", model: WORD_TTS_MODEL,
          parameters: { text_type: "PlainText", format: "wav", sample_rate: 48000, volume: 50, rate: wordSpeechRate(text), pitch: 1 },
          input: { text },
        },
      }), error => { if (error) finish(error); });
    });
    ws.on("message", (data, binary) => {
      if (settled) return;
      if (binary) {
        const chunk = Buffer.from(data as Buffer);
        bytes += chunk.length;
        if (bytes > 2 * 1024 * 1024) finish(new Error("Word TTS audio too large"));
        else chunks.push(chunk);
        return;
      }
      try {
        const message = JSON.parse(data.toString());
        if (!message?.header || (message.header.task_id && message.header.task_id !== taskId)) throw new Error("Invalid word TTS response");
        if (message.header.event === "task-finished") finish();
        if (message.header.event === "task-failed") finish(new Error(`Word TTS failed: ${message.header.error_code ?? "unknown"}`));
      } catch (error) { finish(error instanceof Error ? error : new Error("Invalid word TTS response")); }
    });
    ws.on("error", finish);
    ws.on("close", () => { if (!settled) finish(new Error("Word TTS closed before completion")); });
  });
}
