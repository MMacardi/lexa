"use client";

import { api } from "./api";

// The first five minutes, step by step (BACKLOG "The first five minutes"): where a
// visitor leaves before making an account. A random id kept in this browser and the
// name of each step, sent once — nothing else about the visitor. Signed in,
// "signed_in" carries the same id with the session, which ties the steps to the
// account. Backend: POST /api/public/funnel, the steps in services/analytics.ts.
export type FunnelStep =
  | "landing"
  | "start"
  | "goal"
  | "level"
  | "target"
  | "interests"
  | "check"
  | "daily"
  | "building"
  | "ready"
  | "lesson"
  | "quiz"
  | "learned"
  | "beta"
  | "login"
  | "signed_in";

const VISITOR_KEY = "onomika.visitor";
const SENT_KEY = "onomika.funnelSent";

function visitorId(create: boolean): string | null {
  try {
    let id = localStorage.getItem(VISITOR_KEY);
    if (!id && create) {
      id = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(36).padStart(2, "0")).join("");
      localStorage.setItem(VISITOR_KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}

/** A step reached. "signed_in" only counts for a browser that came through the steps. */
export function funnelStep(step: FunnelStep): void {
  const id = visitorId(step !== "signed_in");
  if (!id) return;
  try {
    const sent = new Set<string>(JSON.parse(localStorage.getItem(SENT_KEY) ?? "[]"));
    if (sent.has(step)) return;
    sent.add(step);
    localStorage.setItem(SENT_KEY, JSON.stringify([...sent]));
  } catch {
    return;
  }
  void api.funnelStep(id, step);
}
